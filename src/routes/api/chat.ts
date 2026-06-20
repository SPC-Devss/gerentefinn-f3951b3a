import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import {
  convertToModelMessages,
  streamText,
  stepCountIs,
  tool,
  type UIMessage,
} from "ai";
import { z } from "zod";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";

type ChatBody = { messages?: UIMessage[]; threadId?: string };

const SYSTEM_PROMPT = `Você é Finn, um agente financeiro pessoal brasileiro, amigável e direto. Você ajuda o usuário a organizar a vida financeira conversando em português, sem jargão.

Como agir:
- Quando o usuário mencionar um gasto, receita, salário, compra, pagamento ou transferência, registre IMEDIATAMENTE usando record_transaction. Se ele citar uma conta ("no Nubank", "no cartão Itaú"), passe account_name.
- Identifique: valor (em reais), tipo (income/expense/transfer), descrição curta, categoria mais provável e data (se não falar, use hoje).
- Categorias podem ser criadas com create_category quando o usuário pedir.
- Contas e cartões: use create_account / list_accounts.
- Metas: create_goal, update_goal_progress, list_goals.
- Recorrências (mensalidades, assinaturas, salário fixo): create_recurrence, list_recurrences.
- Resumo / saldo / "quanto gastei": get_summary ou list_recent.
- ANTI-DUPLICIDADE: se record_transaction retornar { ok: false, duplicate: true }, NÃO insira de novo. Mostre os dados do lançamento existente e pergunte em UMA frase se o usuário confirma o registro mesmo assim. Só chame record_transaction novamente, com confirm_duplicate: true, depois do "sim" explícito do usuário.
- Após qualquer ação, confirme em UMA frase curta. Pode adicionar um insight relevante.
- Nunca julgue. Máximo 1 emoji por mensagem. Nunca peça desculpas.
- Datas no formato YYYY-MM-DD. Hoje é ${new Date().toISOString().slice(0, 10)}.`;


export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.LOVABLE_API_KEY;
        if (!apiKey) return new Response("Missing LOVABLE_API_KEY", { status: 500 });

        const authHeader = request.headers.get("authorization");
        if (!authHeader?.startsWith("Bearer ")) {
          return new Response("Unauthorized", { status: 401 });
        }
        const token = authHeader.slice(7);

        const SUPABASE_URL = process.env.SUPABASE_URL!;
        const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY!;
        const sb = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
          global: { headers: { Authorization: `Bearer ${token}` } },
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const { data: userData, error: userErr } = await sb.auth.getUser(token);
        if (userErr || !userData.user) return new Response("Unauthorized", { status: 401 });
        const userId = userData.user.id;

        const body = (await request.json()) as ChatBody;
        if (!Array.isArray(body.messages)) return new Response("messages required", { status: 400 });
        if (!body.threadId) return new Response("threadId required", { status: 400 });
        const threadId = body.threadId;

        // verify thread ownership
        const { data: thread } = await sb
          .from("threads")
          .select("id")
          .eq("id", threadId)
          .eq("user_id", userId)
          .maybeSingle();
        if (!thread) return new Response("Thread not found", { status: 404 });

        // Persist the latest user message (last one in array)
        const last = body.messages[body.messages.length - 1];
        if (last?.role === "user") {
          await sb.from("messages").insert({
            thread_id: threadId,
            user_id: userId,
            role: "user",
            parts: last.parts as unknown as object,
          });
          // Bump thread updated_at
          await sb.from("threads").update({ updated_at: new Date().toISOString() }).eq("id", threadId);
        }

        // Fetch categories for the tool
        const { data: cats } = await sb
          .from("categories")
          .select("id,name")
          .or(`is_default.eq.true,user_id.eq.${userId}`);
        const catList = cats ?? [];
        const catNames = catList.map((c) => c.name);

        const gateway = createLovableAiGatewayProvider(apiKey);
        const model = gateway("google/gemini-3-flash-preview");

        // Fetch accounts for record_transaction account resolution
        const { data: accs } = await sb
          .from("accounts")
          .select("id,name,type")
          .eq("user_id", userId)
          .eq("archived", false);
        const accList = accs ?? [];

        const ACCOUNT_TYPES = ["checking", "savings", "cash", "credit_card", "investment"] as const;
        const FREQ = ["weekly", "monthly", "yearly"] as const;

        const tools = {
          record_transaction: tool({
            description:
              "Registra uma movimentação financeira (despesa, receita ou transferência). Faz checagem de duplicidade pelo conjunto (conta, data, tipo, valor). Se duplicidade for detectada e confirm_duplicate não for true, retorna ok:false e duplicate:true com o lançamento existente, sem inserir.",
            inputSchema: z.object({
              type: z.enum(["expense", "income", "transfer"]),
              amount: z.number().positive(),
              description: z.string().min(1).max(200),
              category: z.enum(catNames as [string, ...string[]]).optional(),
              account_name: z.string().optional().describe("Nome da conta/cartão, se citado"),
              occurred_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
              confirm_duplicate: z
                .boolean()
                .optional()
                .describe("Passe true SOMENTE após o usuário confirmar explicitamente que quer registrar mesmo sendo duplicado."),
            }),
            execute: async ({ type, amount, description, category, account_name, occurred_at, confirm_duplicate }) => {
              const cat = category ? catList.find((c) => c.name === category) : null;
              const acc = account_name
                ? accList.find((a) => a.name.toLowerCase().includes(account_name.toLowerCase()))
                : null;

              // Anti-duplicidade
              if (!confirm_duplicate && acc?.id) {
                const { data: dups } = await sb
                  .from("transactions")
                  .select("id,description,occurred_at,amount,type")
                  .eq("user_id", userId)
                  .eq("account_id", acc.id)
                  .eq("type", type)
                  .eq("occurred_at", occurred_at)
                  .eq("amount", amount)
                  .limit(1);
                if (dups && dups.length > 0) {
                  return {
                    ok: false,
                    duplicate: true,
                    existing: dups[0],
                    message:
                      "Já existe um lançamento idêntico nesta conta, data, tipo e valor. Pergunte ao usuário se deseja registrar mesmo assim.",
                  };
                }
              }

              const { data, error } = await sb
                .from("transactions")
                .insert({
                  user_id: userId,
                  type,
                  amount,
                  description,
                  category_id: cat?.id ?? null,
                  account_id: acc?.id ?? null,
                  occurred_at,
                  source: "chat",
                })
                .select("id,type,amount,description,occurred_at")
                .single();
              if (error) return { ok: false, error: error.message };
              return { ok: true, transaction: data, category: cat?.name ?? "Outros", account: acc?.name ?? null };
            },
          }),

          list_recent: tool({
            description: "Lista as últimas movimentações.",
            inputSchema: z.object({ limit: z.number().int().min(1).max(50).default(10) }),
            execute: async ({ limit }) => {
              const { data, error } = await sb
                .from("transactions")
                .select("type,amount,description,occurred_at,categories(name),accounts(name)")
                .eq("user_id", userId)
                .order("occurred_at", { ascending: false })
                .limit(limit);
              if (error) return { ok: false, error: error.message };
              return { ok: true, items: data };
            },
          }),
          get_summary: tool({
            description: "Resumo do mês: receitas, despesas, saldo, por categoria.",
            inputSchema: z.object({}),
            execute: async () => {
              const now = new Date();
              const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
              const { data, error } = await sb
                .from("transactions")
                .select("type,amount,categories(name)")
                .eq("user_id", userId)
                .gte("occurred_at", start);
              if (error) return { ok: false, error: error.message };
              let income = 0, expense = 0;
              const byCat: Record<string, number> = {};
              for (const t of data ?? []) {
                const v = Number(t.amount);
                if (t.type === "income") income += v;
                else if (t.type === "expense") {
                  expense += v;
                  const cn = (t.categories as { name?: string } | null)?.name ?? "Outros";
                  byCat[cn] = (byCat[cn] ?? 0) + v;
                }
              }
              return { ok: true, month_to_date: { income, expense, balance: income - expense, by_category: byCat } };
            },
          }),
          create_account: tool({
            description: "Cria uma nova conta bancária ou cartão de crédito.",
            inputSchema: z.object({
              name: z.string().min(1).max(60),
              type: z.enum(ACCOUNT_TYPES),
              institution: z.string().max(60).optional(),
              credit_limit: z.number().nonnegative().optional(),
              closing_day: z.number().int().min(1).max(31).optional(),
              due_day: z.number().int().min(1).max(31).optional(),
            }),
            execute: async (input) => {
              const { data, error } = await sb.from("accounts").insert({ ...input, user_id: userId }).select("id,name,type").single();
              if (error) return { ok: false, error: error.message };
              return { ok: true, account: data };
            },
          }),
          list_accounts: tool({
            description: "Lista as contas e cartões do usuário.",
            inputSchema: z.object({}),
            execute: async () => {
              const { data, error } = await sb
                .from("accounts").select("id,name,type,institution,archived").eq("user_id", userId).eq("archived", false);
              if (error) return { ok: false, error: error.message };
              return { ok: true, accounts: data };
            },
          }),
          create_category: tool({
            description: "Cria uma categoria customizada.",
            inputSchema: z.object({ name: z.string().min(1).max(40), icon: z.string().optional() }),
            execute: async ({ name, icon }) => {
              const { data, error } = await sb
                .from("categories").insert({ name, icon: icon ?? null, user_id: userId, is_default: false })
                .select("id,name").single();
              if (error) return { ok: false, error: error.message };
              return { ok: true, category: data };
            },
          }),
          create_goal: tool({
            description: "Cria uma meta financeira.",
            inputSchema: z.object({
              name: z.string().min(1).max(100),
              target_amount: z.number().positive(),
              current_amount: z.number().nonnegative().default(0),
              deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
            }),
            execute: async (input) => {
              const { data, error } = await sb.from("goals").insert({ ...input, user_id: userId }).select("id,name,target_amount").single();
              if (error) return { ok: false, error: error.message };
              return { ok: true, goal: data };
            },
          }),
          update_goal_progress: tool({
            description: "Adiciona (ou subtrai, com valor negativo) progresso a uma meta pelo nome.",
            inputSchema: z.object({ name: z.string().min(1), amount: z.number() }),
            execute: async ({ name, amount }) => {
              const { data: g } = await sb.from("goals").select("id,current_amount,target_amount").eq("user_id", userId).ilike("name", `%${name}%`).maybeSingle();
              if (!g) return { ok: false, error: "Meta não encontrada" };
              const next = Math.max(0, Number(g.current_amount) + amount);
              const status = next >= Number(g.target_amount) ? "completed" : "active";
              const { error } = await sb.from("goals").update({ current_amount: next, status }).eq("id", g.id).eq("user_id", userId);
              if (error) return { ok: false, error: error.message };
              return { ok: true, current_amount: next, status };
            },
          }),
          list_goals: tool({
            description: "Lista metas do usuário.",
            inputSchema: z.object({}),
            execute: async () => {
              const { data, error } = await sb.from("goals").select("id,name,target_amount,current_amount,status,deadline").eq("user_id", userId);
              if (error) return { ok: false, error: error.message };
              return { ok: true, goals: data };
            },
          }),
          create_recurrence: tool({
            description: "Cria uma recorrência (assinatura, salário fixo, conta mensal).",
            inputSchema: z.object({
              description: z.string().min(1).max(120),
              type: z.enum(["income", "expense"]),
              amount: z.number().positive(),
              frequency: z.enum(FREQ).default("monthly"),
              day_of_month: z.number().int().min(1).max(31).optional(),
              next_run_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
              account_name: z.string().optional(),
              category: z.enum(catNames as [string, ...string[]]).optional(),
            }),
            execute: async ({ account_name, category, ...rest }) => {
              const cat = category ? catList.find((c) => c.name === category) : null;
              const acc = account_name ? accList.find((a) => a.name.toLowerCase().includes(account_name.toLowerCase())) : null;
              const { data, error } = await sb.from("recurrences")
                .insert({ ...rest, user_id: userId, category_id: cat?.id ?? null, account_id: acc?.id ?? null })
                .select("id,description").single();
              if (error) return { ok: false, error: error.message };
              return { ok: true, recurrence: data };
            },
          }),
          list_recurrences: tool({
            description: "Lista recorrências ativas.",
            inputSchema: z.object({}),
            execute: async () => {
              const { data, error } = await sb.from("recurrences")
                .select("id,description,type,amount,frequency,next_run_at,active")
                .eq("user_id", userId).eq("active", true);
              if (error) return { ok: false, error: error.message };
              return { ok: true, recurrences: data };
            },
          }),
        };

        const result = streamText({
          model,
          system: SYSTEM_PROMPT,
          tools,
          stopWhen: stepCountIs(50),
          messages: await convertToModelMessages(body.messages),
        });

        return result.toUIMessageStreamResponse({
          originalMessages: body.messages,
          onFinish: async ({ messages }) => {
            // Save new assistant messages (everything after originalMessages length)
            const newOnes = messages.slice(body.messages!.length);
            if (newOnes.length === 0) return;
            const rows = newOnes.map((m) => ({
              thread_id: threadId,
              user_id: userId,
              role: m.role,
              parts: m.parts as unknown as object,
            }));
            const { error } = await sb.from("messages").insert(rows);
            if (error) console.error("[chat] failed to save assistant messages:", error.message);
            await sb.from("threads").update({ updated_at: new Date().toISOString() }).eq("id", threadId);

            // Auto-title on first turn if still default
            const { data: t } = await sb.from("threads").select("title").eq("id", threadId).single();
            if (t?.title === "Nova conversa") {
              const firstUserText = body.messages![0]?.parts
                ?.map((p) => (p.type === "text" ? p.text : ""))
                .join(" ")
                .trim()
                .slice(0, 60);
              if (firstUserText) {
                await sb.from("threads").update({ title: firstUserText }).eq("id", threadId);
              }
            }
          },
        });
      },
    },
  },
});
