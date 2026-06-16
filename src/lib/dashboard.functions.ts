import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const PERIODS = ["month", "3m", "year", "all", "custom_month", "custom_year"] as const;
export type DashboardPeriod = (typeof PERIODS)[number];

const inputSchema = z.object({
  period: z.enum(PERIODS).default("month"),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional().nullable(),
  year: z.string().regex(/^\d{4}$/).optional().nullable(),
  accountId: z.string().uuid().optional().nullable(),
  categoryId: z.string().uuid().optional().nullable(),
  accountKind: z.enum(["all", "credit_card", "cash_like"]).default("all"),
});

function rangeFor(
  period: DashboardPeriod,
  month?: string | null,
  year?: string | null,
): { start: string | null; end: string | null } {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  if (period === "custom_month" && month) {
    const [y, m] = month.split("-").map(Number);
    const last = new Date(y, m, 0).getDate();
    return { start: `${month}-01`, end: `${month}-${pad(last)}` };
  }
  if (period === "custom_year" && year) {
    return { start: `${year}-01-01`, end: `${year}-12-31` };
  }
  if (period === "month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
  }
  if (period === "3m") {
    const start = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    return { start: start.toISOString().slice(0, 10), end: null };
  }
  if (period === "year") return { start: `${now.getFullYear()}-01-01`, end: null };
  return { start: null, end: null };
}

function bucketFor(period: DashboardPeriod, date: string): string {
  if (period === "month" || period === "3m" || period === "custom_month") return date;
  return date.slice(0, 7);
}

export const getDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => inputSchema.parse(i ?? {}))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { period, accountId, categoryId, accountKind } = data;

    {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin.rpc("materialize_due_recurrences", { _user_id: userId });
    }

    const { start: periodStart, end: periodEnd } = rangeFor(period, data.month, data.year);

    // Resolve account filter based on kind
    let resolvedAccountIds: string[] | null = null;
    if (accountKind !== "all" || accountId) {
      const { data: accs } = await supabase
        .from("accounts")
        .select("id,type")
        .eq("user_id", userId);
      let filtered = accs ?? [];
      if (accountKind === "credit_card") filtered = filtered.filter((a) => a.type === "credit_card");
      else if (accountKind === "cash_like") filtered = filtered.filter((a) => a.type !== "credit_card");
      if (accountId) filtered = filtered.filter((a) => a.id === accountId);
      resolvedAccountIds = filtered.map((a) => a.id);
    }

    const acctIds = resolvedAccountIds;
    const baseTx = () => {
      let q = supabase.from("transactions").select("type,amount,recurrence_id,categories(name,icon)").eq("user_id", userId);
      if (periodStart) q = q.gte("occurred_at", periodStart);
      if (periodEnd) q = q.lte("occurred_at", periodEnd);
      if (acctIds) q = q.in("account_id", acctIds.length ? acctIds : ["00000000-0000-0000-0000-000000000000"]);
      if (categoryId) q = q.eq("category_id", categoryId);
      return q;
    };
    const baseSeries = () => {
      let q = supabase.from("transactions").select("type,amount,occurred_at").eq("user_id", userId);
      if (periodStart) q = q.gte("occurred_at", periodStart);
      if (periodEnd) q = q.lte("occurred_at", periodEnd);
      if (acctIds) q = q.in("account_id", acctIds.length ? acctIds : ["00000000-0000-0000-0000-000000000000"]);
      if (categoryId) q = q.eq("category_id", categoryId);
      return q.order("occurred_at", { ascending: true });
    };
    const baseRecent = () => {
      let q = supabase
        .from("transactions")
        .select("id,type,amount,description,occurred_at,categories(name,icon)")
        .eq("user_id", userId);
      if (periodStart) q = q.gte("occurred_at", periodStart);
      if (periodEnd) q = q.lte("occurred_at", periodEnd);
      if (acctIds) q = q.in("account_id", acctIds.length ? acctIds : ["00000000-0000-0000-0000-000000000000"]);
      if (categoryId) q = q.eq("category_id", categoryId);
      return q.order("occurred_at", { ascending: false }).order("created_at", { ascending: false }).limit(10);
    };

    // Installment items for the period (unpaid → committed)
    let instQ = supabase
      .from("installment_items")
      .select("amount,paid,due_date,purchase_id")
      .eq("user_id", userId)
      .eq("paid", false);
    if (periodStart) instQ = instQ.gte("due_date", periodStart);
    if (periodEnd) instQ = instQ.lte("due_date", periodEnd);

    const [{ data: periodTxs }, { data: dayTxs }, { data: recentTxs }, { data: goalsData }, { data: instItems }] = await Promise.all([
      baseTx(),
      baseSeries(),
      baseRecent(),
      supabase
        .from("goals")
        .select("id,name,target_amount,current_amount,status,deadline")
        .eq("user_id", userId)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(4),
      instQ,
    ]);

    let income = 0, expense = 0, fixedExpense = 0, variableExpense = 0;
    const byCategory: Record<string, number> = {};
    for (const t of periodTxs ?? []) {
      const v = Number(t.amount);
      if (t.type === "income") income += v;
      else if (t.type === "expense") {
        expense += v;
        if (t.recurrence_id) fixedExpense += v;
        else variableExpense += v;
        const cn = (t.categories as { name?: string } | null)?.name ?? "Outros";
        byCategory[cn] = (byCategory[cn] ?? 0) + v;
      }
    }
    const byCategoryArr = Object.entries(byCategory)
      .map(([name, amount]) => ({ name, amount }))
      .sort((a, b) => b.amount - a.amount);

    const seriesMap: Record<string, { date: string; income: number; expense: number }> = {};
    for (const t of dayTxs ?? []) {
      const key = bucketFor(period, t.occurred_at as string);
      if (!seriesMap[key]) seriesMap[key] = { date: key, income: 0, expense: 0 };
      const v = Number(t.amount);
      if (t.type === "income") seriesMap[key].income += v;
      else if (t.type === "expense") seriesMap[key].expense += v;
    }
    const series = Object.values(seriesMap).sort((a, b) => a.date.localeCompare(b.date));

    const totalCommitted = (instItems ?? []).reduce((s, i) => s + Number(i.amount), 0);

    return {
      period,
      month: { income, expense, balance: income - expense },
      expenseBreakdown: { fixed: fixedExpense, variable: variableExpense },
      installmentsCommitted: totalCommitted,
      byCategory: byCategoryArr,
      series,
      recent: recentTxs ?? [],
      goals: goalsData ?? [],
    };
  });
