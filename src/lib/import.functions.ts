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

    const rows = data.transactions.map((t) => ({
      user_id: userId,
      type: t.type,
      amount: t.amount,
      description: t.description,
      occurred_at: t.occurred_at,
      account_id: accountId,
      category_id: t.category_name ? catMap.get(t.category_name.toLowerCase()) ?? null : null,
      source: "import" as const,
    }));

    // Anti-duplicidade: só faz sentido quando há conta vinculada.
    type DuplicateInfo = {
      index: number;
      candidate: { description: string; amount: number; occurred_at: string; type: "expense" | "income" };
      existing: { id: string; description: string | null; occurred_at: string; amount: number; type: string };
    };
    let duplicates: DuplicateInfo[] = [];

    if (!data.force && accountId) {
      const dates = Array.from(new Set(rows.map((r) => r.occurred_at)));
      const { data: existing, error: exErr } = await supabase
        .from("transactions")
        .select("id,description,occurred_at,amount,type,account_id")
        .eq("user_id", userId)
        .eq("account_id", accountId)
        .in("occurred_at", dates);
      if (exErr) throw new Error(exErr.message);
      const existingArr = existing ?? [];

      rows.forEach((r, idx) => {
        if (skip.has(idx)) return;
        const match = existingArr.find(
          (e) =>
            e.type === r.type &&
            e.occurred_at === r.occurred_at &&
            Number(e.amount) === Number(r.amount),
        );
        if (match) {
          duplicates.push({
            index: idx,
            candidate: {
              description: r.description,
              amount: r.amount,
              occurred_at: r.occurred_at,
              type: r.type,
            },
            existing: {
              id: match.id as string,
              description: (match.description as string | null) ?? null,
              occurred_at: match.occurred_at as string,
              amount: Number(match.amount),
              type: match.type as string,
            },
          });
        }
      });

      if (duplicates.length > 0) {
        return { ok: false as const, duplicate: true as const, duplicates, inserted: 0 };
      }
    }

    const toInsert = rows.filter((_, idx) => !skip.has(idx));
    if (toInsert.length === 0) {
      return { ok: true as const, duplicate: false as const, inserted: 0, duplicates: [] };
    }
    const { error } = await supabase.from("transactions").insert(toInsert);
    if (error) throw new Error(error.message);
    return { ok: true as const, duplicate: false as const, inserted: toInsert.length, duplicates: [] };
  });

