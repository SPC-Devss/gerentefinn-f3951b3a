import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { generateObject, generateText } from "ai";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";

// Schema permissivo: aceita variações comuns que a IA pode devolver
const ParsedTx = z.object({
  type: z.enum(["expense", "income"]),
  amount: z.number().positive(),
  description: z.string().min(1).max(200),
  occurred_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  suggested_category: z.string().max(60).optional().nullable(),
});

const ParsedResult = z.object({
  transactions: z.array(ParsedTx).max(500),
});

type ParsedTxT = z.infer<typeof ParsedTx>;

// Coerção tolerante: aceita variações de campos vindas do modelo
function coerceTx(raw: unknown): ParsedTxT | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  // type
  let type = String(r.type ?? r.kind ?? "").toLowerCase();
  if (["debit", "debito", "débito", "expense", "gasto", "saida", "saída"].includes(type)) type = "expense";
  else if (["credit", "credito", "crédito", "income", "receita", "entrada"].includes(type)) type = "income";
  if (type !== "expense" && type !== "income") {
    // tenta inferir pelo sinal do valor
    const v = Number(r.amount ?? r.value ?? r.valor);
    if (!Number.isFinite(v)) return null;
    type = v < 0 ? "expense" : "income";
  }

  // amount
  let amount = Number(r.amount ?? r.value ?? r.valor);
  if (typeof r.amount === "string") {
    amount = Number(String(r.amount).replace(/\./g, "").replace(",", "."));
  }
  if (!Number.isFinite(amount)) return null;
  amount = Math.abs(amount);
  if (amount <= 0) return null;

  // description
  const description = String(r.description ?? r.desc ?? r.descricao ?? r.descrição ?? r.memo ?? "").trim().slice(0, 200);
  if (!description) return null;

  // date
  let occurred_at = String(r.occurred_at ?? r.date ?? r.data ?? "").trim();
  // tenta normalizar dd/mm/yyyy
  const br = occurred_at.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) occurred_at = `${br[3]}-${br[2]}-${br[1]}`;
  // tenta extrair YYYY-MM-DD do início
  const iso = occurred_at.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) occurred_at = iso[1];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(occurred_at)) return null;

  const cat = r.suggested_category ?? r.category ?? r.categoria;
  const suggested_category = cat ? String(cat).slice(0, 60) : null;

  return { type: type as "expense" | "income", amount, description, occurred_at, suggested_category };
}

function tryExtractJson(text: string): unknown | null {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  try { return JSON.parse(cleaned); } catch { /* ignore */ }
  // tenta achar primeiro [ ... ] ou { ... }
  const m = cleaned.match(/[\[{][\s\S]*[\]}]/);
  if (m) {
    try { return JSON.parse(m[0]); } catch { /* ignore */ }
  }
  return null;
}

export const parseStatement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        text: z.string().min(1).max(200_000),
        format: z.enum(["ofx", "csv", "pdf"]),
        is_credit_card: z.boolean().default(false),
      })
      .parse(i),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY ausente");

    const { data: cats } = await supabase
      .from("categories")
      .select("name")
      .or(`is_default.eq.true,user_id.eq.${userId}`);
    const catNames = (cats ?? []).map((c) => c.name);

    const gateway = createLovableAiGatewayProvider(apiKey);
    const model = gateway("google/gemini-2.5-flash");

    const today = new Date().toISOString().slice(0, 10);
    const system = `Você extrai movimentações financeiras de extratos bancários e faturas de cartão brasileiros e retorna ESTRITAMENTE no schema solicitado.

REGRAS OBRIGATÓRIAS:
- Retorne SOMENTE um objeto { "transactions": [...] } seguindo exatamente o schema. Não invente campos. Não aninhe objetos extras.
- Cada item DEVE ter: type ("expense" | "income"), amount (number positivo), description (string), occurred_at (string "YYYY-MM-DD").
- suggested_category é opcional: use string da lista ou null. Nunca use objetos.
- amount sempre POSITIVO em reais (sem sinal, sem "R$", sem separador de milhar).
- type: "expense" para gastos/débitos/compras; "income" para créditos/receitas/estornos/pagamentos recebidos.
${data.is_credit_card ? '- Este arquivo é uma FATURA DE CARTÃO: todas as compras são "expense"; pagamentos da fatura e estornos são "income".' : ""}
- occurred_at sempre no formato YYYY-MM-DD. Se faltar o ano, use ${today.slice(0, 4)}.
- description: limpa, curta, sem códigos de transação longos.
- suggested_category: escolha um de [${catNames.join(", ")}] OU null. Nunca invente categoria nova.
- Ignore saldos, totais, cabeçalhos e linhas vazias.
- Se não houver transações, retorne { "transactions": [] }.`;

    const userPrompt = `Formato: ${data.format.toUpperCase()}\n\nConteúdo:\n${data.text.slice(0, 180_000)}`;

    // 1) Tentativa principal: generateObject com schema
    try {
      const { object } = await generateObject({
        model,
        schema: ParsedResult,
        system,
        prompt: userPrompt,
      });
      return object;
    } catch (err) {
      console.warn("[parseStatement] generateObject falhou, tentando fallback generateText:", (err as Error)?.message);
    }

    // 2) Fallback: generateText pedindo JSON puro + coerção tolerante
    try {
      const { text } = await generateText({
        model,
        system: `${system}\n\nResponda APENAS com JSON válido no formato: {"transactions":[...]} sem markdown, sem comentários, sem texto fora do JSON.`,
        prompt: userPrompt,
      });

      const parsed = tryExtractJson(text);
      const rawList: unknown[] = Array.isArray(parsed)
        ? parsed
        : Array.isArray((parsed as { transactions?: unknown[] })?.transactions)
          ? (parsed as { transactions: unknown[] }).transactions
          : [];

      const transactions = rawList
        .map(coerceTx)
        .filter((t): t is ParsedTxT => t !== null)
        .slice(0, 500);

      return { transactions };
    } catch (err) {
      console.error("[parseStatement] fallback também falhou:", err);
      throw new Error(
        "Não consegui ler este arquivo automaticamente. Tente outro formato (OFX costuma funcionar melhor) ou um arquivo menor.",
      );
    }
  });

export const bulkImportTransactions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        account_id: z.string().uuid().optional().nullable(),
        transactions: z
          .array(
            z.object({
              type: z.enum(["expense", "income"]),
              amount: z.number().positive(),
              description: z.string().min(1).max(200),
              occurred_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
              category_name: z.string().max(60).optional().nullable(),
              extras: z
                .object({
                  kind: z.enum(["single", "recurring", "installment"]).default("single"),
                  frequency: z.enum(["weekly", "monthly", "yearly"]).default("monthly"),
                  installments_count: z.number().int().min(2).max(360).default(2),
                })
                .optional(),
            }),
          )
          .min(1)
          .max(500),
        force: z.boolean().optional(),
        skip_indices: z.array(z.number().int().nonnegative()).optional(),
      })
      .parse(i),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;

    const { data: cats } = await supabase
      .from("categories")
      .select("id,name")
      .or(`is_default.eq.true,user_id.eq.${userId}`);
    const catMap = new Map<string, string>();
    for (const c of cats ?? []) catMap.set(c.name.toLowerCase(), c.id);

    const accountId = data.account_id ?? null;
    const skip = new Set(data.skip_indices ?? []);

    // Anti-duplicidade compartilhada
    type DuplicateInfo = {
      index: number;
      candidate: { description: string; amount: number; occurred_at: string; type: "expense" | "income" };
      existing: { id: string; description: string | null; occurred_at: string; amount: number; type: string };
    };
    let duplicates: DuplicateInfo[] = [];

    if (!data.force) {
      const { findPossibleDuplicates } = await import("@/lib/duplicates.server");
      const candidates = data.transactions.map((t) => ({
        account_id: accountId,
        type: t.type as "income" | "expense" | "transfer",
        amount: t.amount,
        occurred_at: t.occurred_at,
        description: t.description,
      }));
      const matches = await findPossibleDuplicates(supabase, userId, candidates);
      duplicates = matches
        .filter((m) => !skip.has(m.index))
        .map((m) => ({
          index: m.index,
          candidate: {
            description: data.transactions[m.index].description,
            amount: data.transactions[m.index].amount,
            occurred_at: data.transactions[m.index].occurred_at,
            type: data.transactions[m.index].type,
          },
          existing: {
            id: m.existing.id,
            description: m.existing.description,
            occurred_at: m.existing.occurred_at,
            amount: Number(m.existing.amount),
            type: m.existing.type,
          },
        }));

      if (duplicates.length > 0) {
        return { ok: false as const, duplicate: true as const, duplicates, inserted: 0 };
      }
    }

    // Particiona por kind dos extras
    const singles: typeof data.transactions = [];
    const recurrings: typeof data.transactions = [];
    const installments: typeof data.transactions = [];
    data.transactions.forEach((t, idx) => {
      if (skip.has(idx)) return;
      const kind = t.extras?.kind ?? "single";
      if (kind === "recurring") recurrings.push(t);
      else if (kind === "installment") installments.push(t);
      else singles.push(t);
    });

    let inserted = 0;

    // 1) Inserir singles em transactions
    if (singles.length > 0) {
      const rows = singles.map((t) => ({
        user_id: userId,
        type: t.type,
        amount: t.amount,
        description: t.description,
        occurred_at: t.occurred_at,
        account_id: accountId,
        category_id: t.category_name ? catMap.get(t.category_name.toLowerCase()) ?? null : null,
        source: "import" as const,
      }));
      const { error } = await supabase.from("transactions").insert(rows);
      if (error) throw new Error(error.message);
      inserted += rows.length;
    }

    // 2) Recorrentes: insere a transação E cria a recorrência (próxima ocorrência)
    if (recurrings.length > 0) {
      for (const t of recurrings) {
        const categoryId = t.category_name ? catMap.get(t.category_name.toLowerCase()) ?? null : null;
        const freq = t.extras?.frequency ?? "monthly";
        // Cria a recorrência primeiro com next_run_at = próxima ocorrência depois do lançamento atual
        const nextRun = nextOccurrence(t.occurred_at, freq);
        const { data: rec, error: recErr } = await supabase
          .from("recurrences")
          .insert({
            user_id: userId,
            description: t.description,
            type: t.type,
            amount: t.amount,
            frequency: freq,
            next_run_at: nextRun,
            category_id: categoryId,
            account_id: accountId,
          })
          .select("id")
          .single();
        if (recErr) throw new Error(recErr.message);
        // Insere o lançamento atual vinculado à recorrência
        const { error: txErr } = await supabase.from("transactions").insert({
          user_id: userId,
          type: t.type,
          amount: t.amount,
          description: t.description,
          occurred_at: t.occurred_at,
          account_id: accountId,
          category_id: categoryId,
          source: "import",
          recurrence_id: rec.id,
        });
        if (txErr) throw new Error(txErr.message);
        inserted++;
      }
    }

    // 3) Parceladas: cria installment_purchase + items (sem inserir em transactions)
    if (installments.length > 0) {
      for (const t of installments) {
        const categoryId = t.category_name ? catMap.get(t.category_name.toLowerCase()) ?? null : null;
        const count = t.extras?.installments_count ?? 2;
        const { data: purchase, error: e1 } = await supabase
          .from("installment_purchases")
          .insert({
            user_id: userId,
            description: t.description,
            total_amount: t.amount,
            installments_count: count,
            first_due_date: t.occurred_at,
            account_id: accountId,
            category_id: categoryId,
          })
          .select("id")
          .single();
        if (e1) throw new Error(e1.message);
        const each = Math.round((t.amount / count) * 100) / 100;
        const items: { purchase_id: string; user_id: string; number: number; due_date: string; amount: number }[] = [];
        let acc = 0;
        for (let n = 1; n <= count; n++) {
          const amount = n === count ? Math.round((t.amount - acc) * 100) / 100 : each;
          acc += each;
          items.push({
            purchase_id: purchase.id,
            user_id: userId,
            number: n,
            due_date: addMonthsIso(t.occurred_at, n - 1),
            amount,
          });
        }
        const { error: e2 } = await supabase.from("installment_items").insert(items);
        if (e2) throw new Error(e2.message);
        inserted++;
      }
    }

    return { ok: true as const, duplicate: false as const, inserted, duplicates: [] };
  });

function addMonthsIso(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
  dt.setUTCDate(Math.min(d, last));
  return dt.toISOString().slice(0, 10);
}

function nextOccurrence(iso: string, freq: "weekly" | "monthly" | "yearly"): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (freq === "weekly") {
    const dt = new Date(Date.UTC(y, m - 1, d + 7));
    return dt.toISOString().slice(0, 10);
  }
  if (freq === "yearly") {
    const dt = new Date(Date.UTC(y + 1, m - 1, d));
    return dt.toISOString().slice(0, 10);
  }
  return addMonthsIso(iso, 1);
}

