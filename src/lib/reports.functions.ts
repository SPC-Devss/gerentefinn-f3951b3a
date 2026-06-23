import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const inputSchema = z.object({
  from: z.string(), // YYYY-MM-DD
  to: z.string(),
});

export const getReport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => inputSchema.parse(i))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { data: txs, error } = await supabase
      .from("transactions")
      .select("id,type,amount,description,occurred_at,categories(name),accounts(name)")
      .eq("user_id", userId)
      .gte("occurred_at", data.from)
      .lte("occurred_at", data.to)
      .order("occurred_at", { ascending: true });
    if (error) throw new Error(error.message);

    let income = 0,
      expense = 0;
    const byCategory: Record<string, { income: number; expense: number }> = {};
    const byMonth: Record<string, { income: number; expense: number }> = {};

    for (const t of txs ?? []) {
      const v = Number(t.amount);
      const month = (t.occurred_at as string).slice(0, 7);
      const catName = (t.categories as { name?: string } | null)?.name ?? "Sem categoria";

      if (!byMonth[month]) byMonth[month] = { income: 0, expense: 0 };
      if (!byCategory[catName]) byCategory[catName] = { income: 0, expense: 0 };

      if (t.type === "income") {
        income += v;
        byMonth[month].income += v;
        byCategory[catName].income += v;
      } else if (t.type === "expense") {
        expense += v;
        byMonth[month].expense += v;
        byCategory[catName].expense += v;
      }
    }

    return {
      totals: { income, expense, balance: income - expense, count: txs?.length ?? 0 },
      byCategory: Object.entries(byCategory)
        .map(([name, v]) => ({ name, ...v }))
        .sort((a, b) => b.expense - a.expense),
      byMonth: Object.entries(byMonth)
        .map(([month, v]) => ({ month, ...v }))
        .sort((a, b) => a.month.localeCompare(b.month)),
      transactions: txs ?? [],
    };
  });

export const exportReportCsv = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => inputSchema.parse(i))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { data: txs, error } = await supabase
      .from("transactions")
      .select("type,amount,description,occurred_at,categories(name),accounts(name)")
      .eq("user_id", userId)
      .gte("occurred_at", data.from)
      .lte("occurred_at", data.to)
      .order("occurred_at", { ascending: true });
    if (error) throw new Error(error.message);

    const sanitizeCsvCell = (value: string): string =>
      /^[=+\-@\t\r]/.test(value) ? "'" + value : value;

    const rows = [["Data", "Tipo", "Descrição", "Categoria", "Conta", "Valor"]];
    for (const t of txs ?? []) {
      rows.push([
        t.occurred_at as string,
        t.type === "income" ? "Receita" : "Despesa",
        sanitizeCsvCell(t.description ?? "").replace(/"/g, '""'),
        sanitizeCsvCell((t.categories as { name?: string } | null)?.name ?? ""),
        sanitizeCsvCell((t.accounts as { name?: string } | null)?.name ?? ""),
        Number(t.amount).toFixed(2),
      ]);
    }
    const csv = rows.map((r) => r.map((c) => `"${c}"`).join(";")).join("\n");
    return { csv, filename: `relatorio_${data.from}_${data.to}.csv` };
  });
