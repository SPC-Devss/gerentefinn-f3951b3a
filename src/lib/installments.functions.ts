import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

function addMonths(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1 + n, 1));
  // clamp day to last day of target month
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(d, last));
  return date.toISOString().slice(0, 10);
}

export const listInstallments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
        year: z.string().regex(/^\d{4}$/).optional(),
        account_id: z.string().uuid().optional(),
      })
      .parse(i ?? {}),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;

    const [purchasesRes, itemsRes, accountsRes, categoriesRes] = await Promise.all([
      supabase
        .from("installment_purchases")
        .select("id,description,total_amount,installments_count,first_due_date,account_id,category_id,notes,created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false }),
      supabase
        .from("installment_items")
        .select("id,purchase_id,number,due_date,amount,paid,paid_at")
        .eq("user_id", userId)
        .order("due_date", { ascending: true }),
      supabase
        .from("accounts")
        .select("id,name,color,type,institution")
        .eq("user_id", userId)
        .eq("archived", false),
      supabase
        .from("categories")
        .select("id,name,icon")
        .or(`is_default.eq.true,user_id.eq.${userId}`),
    ]);

    if (purchasesRes.error) throw new Error(purchasesRes.error.message);
    if (itemsRes.error) throw new Error(itemsRes.error.message);

    const allItems = itemsRes.data ?? [];
    const allPurchases = purchasesRes.data ?? [];

    // Apply filters to items for aggregations & visible items
    const filteredItems = allItems.filter((it) => {
      const p = allPurchases.find((pp) => pp.id === it.purchase_id);
      if (!p) return false;
      if (data.account_id && p.account_id !== data.account_id) return false;
      if (data.year && !it.due_date.startsWith(data.year)) return false;
      if (data.month && !it.due_date.startsWith(data.month)) return false;
      return true;
    });

    const visiblePurchaseIds = new Set(filteredItems.map((i) => i.purchase_id));
    const purchases = allPurchases
      .filter((p) => visiblePurchaseIds.has(p.id))
      .map((p) => {
        const items = allItems.filter((i) => i.purchase_id === p.id);
        const paidCount = items.filter((i) => i.paid).length;
        const remaining = items.filter((i) => !i.paid).reduce((s, i) => s + Number(i.amount), 0);
        const lastUnpaid = items.filter((i) => !i.paid).sort((a, b) => b.due_date.localeCompare(a.due_date))[0];
        const account = accountsRes.data?.find((a) => a.id === p.account_id) ?? null;
        const category = categoriesRes.data?.find((c) => c.id === p.category_id) ?? null;
        return {
          ...p,
          paid_count: paidCount,
          remaining_amount: remaining,
          last_due_date: lastUnpaid?.due_date ?? items[items.length - 1]?.due_date ?? p.first_due_date,
          account,
          category,
          items,
        };
      });

    // Total committed = unpaid items (filtered)
    const totalCommitted = filteredItems.filter((i) => !i.paid).reduce((s, i) => s + Number(i.amount), 0);

    // Future commitment grouped by month (next 12 months from today)
    const today = new Date().toISOString().slice(0, 10);
    const byMonthMap: Record<string, number> = {};
    for (const it of filteredItems) {
      if (it.paid) continue;
      if (it.due_date < today.slice(0, 7) + "-01") continue;
      const m = it.due_date.slice(0, 7);
      byMonthMap[m] = (byMonthMap[m] ?? 0) + Number(it.amount);
    }
    const byMonth = Object.entries(byMonthMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(0, 12)
      .map(([month, amount]) => ({ month, amount }));

    return {
      purchases,
      totalCommitted,
      byMonth,
      accounts: accountsRes.data ?? [],
      categories: categoriesRes.data ?? [],
    };
  });

const purchaseInput = z.object({
  description: z.string().min(1).max(200),
  total_amount: z.number().positive(),
  installments_count: z.number().int().min(1).max(360),
  first_due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  account_id: z.string().uuid().nullable().optional(),
  category_id: z.string().uuid().nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
});

type ParcelaCalc = { number: number; due_date: string; amount: number };

function calcularParcelas(total: number, count: number, firstDue: string, startNumber = 1): ParcelaCalc[] {
  const each = Math.round((total / count) * 100) / 100;
  const out: ParcelaCalc[] = [];
  let acc = 0;
  for (let i = 0; i < count; i++) {
    const n = startNumber + i;
    const amount = i === count - 1 ? Math.round((total - acc) * 100) / 100 : each;
    acc += each;
    out.push({ number: n, due_date: addMonths(firstDue, n - 1), amount });
  }
  return out;
}

async function inserirParcelasComoTransactions(
  supabase: import("@supabase/supabase-js").SupabaseClient,
  args: {
    userId: string;
    purchaseId: string;
    description: string;
    account_id: string | null;
    category_id: string | null;
    installments_total: number;
    parcelas: ParcelaCalc[];
  },
) {
  const rows = args.parcelas.map((p) => ({
    user_id: args.userId,
    type: "expense" as const,
    amount: p.amount,
    description: `${args.description} (${p.number}/${args.installments_total})`,
    category_id: args.category_id,
    account_id: args.account_id,
    occurred_at: p.due_date,
    source: "installment",
    installment_purchase_id: args.purchaseId,
    installment_number: p.number,
    installments_total: args.installments_total,
  }));
  const { error } = await supabase.from("transactions").insert(rows);
  if (error) throw new Error(error.message);
}

export const createInstallmentPurchase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => purchaseInput.parse(i))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { data: purchase, error: e1 } = await supabase
      .from("installment_purchases")
      .insert({
        user_id: userId,
        description: data.description,
        total_amount: data.total_amount,
        installments_count: data.installments_count,
        first_due_date: data.first_due_date,
        account_id: data.account_id ?? null,
        category_id: data.category_id ?? null,
        notes: data.notes ?? null,
      })
      .select("id")
      .single();
    if (e1) throw new Error(e1.message);

    const parcelas = calcularParcelas(data.total_amount, data.installments_count, data.first_due_date);

    const items = parcelas.map((p) => ({
      purchase_id: purchase.id,
      user_id: userId,
      number: p.number,
      due_date: p.due_date,
      amount: p.amount,
    }));
    const { error: e2 } = await supabase.from("installment_items").insert(items);
    if (e2) throw new Error(e2.message);

    await inserirParcelasComoTransactions(supabase, {
      userId,
      purchaseId: purchase.id,
      description: data.description,
      account_id: data.account_id ?? null,
      category_id: data.category_id ?? null,
      installments_total: data.installments_count,
      parcelas,
    });

    return { id: purchase.id };
  });

export const updateInstallmentPurchase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => purchaseInput.extend({ id: z.string().uuid(), regenerate: z.boolean().optional() }).parse(i))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { id, regenerate, ...patch } = data;
    const { error } = await supabase
      .from("installment_purchases")
      .update({
        description: patch.description,
        total_amount: patch.total_amount,
        installments_count: patch.installments_count,
        first_due_date: patch.first_due_date,
        account_id: patch.account_id ?? null,
        category_id: patch.category_id ?? null,
        notes: patch.notes ?? null,
      })
      .eq("id", id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);

    if (regenerate) {
      const { data: full } = await supabase
        .from("installment_items")
        .select("id,number,paid,amount,due_date")
        .eq("purchase_id", id)
        .eq("user_id", userId);
      const paidItems = (full ?? []).filter((i) => i.paid);
      const paidNumbers = paidItems.map((i) => i.number);
      const paidAmount = paidItems.reduce((s, i) => s + Number(i.amount), 0);

      await supabase.from("installment_items").delete().eq("purchase_id", id).eq("user_id", userId).eq("paid", false);

      const startNumber = (paidNumbers.length > 0 ? Math.max(...paidNumbers) : 0) + 1;
      await supabase
        .from("transactions")
        .delete()
        .eq("user_id", userId)
        .eq("installment_purchase_id", id)
        .gte("installment_number", startNumber);

      const remainingCount = patch.installments_count - paidNumbers.length;
      if (remainingCount > 0) {
        const remainingAmount = patch.total_amount - paidAmount;
        const parcelas = calcularParcelas(remainingAmount, remainingCount, patch.first_due_date, startNumber);

        const items = parcelas.map((p) => ({
          purchase_id: id,
          user_id: userId,
          number: p.number,
          due_date: p.due_date,
          amount: p.amount,
        }));
        const { error: insErr } = await supabase.from("installment_items").insert(items);
        if (insErr) throw new Error(insErr.message);

        await inserirParcelasComoTransactions(supabase, {
          userId,
          purchaseId: id,
          description: patch.description,
          account_id: patch.account_id ?? null,
          category_id: patch.category_id ?? null,
          installments_total: patch.installments_count,
          parcelas,
        });
      }
    }
    return { ok: true };
  });

export const deleteInstallmentPurchase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("installment_purchases").delete().eq("id", data.id).eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const toggleInstallmentItemPaid = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid(), paid: z.boolean() }).parse(i))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("installment_items")
      .update({ paid: data.paid, paid_at: data.paid ? new Date().toISOString() : null })
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Converte um lançamento avulso existente numa compra parcelada:
 * 1. Cria a installment_purchase + items (mesma lógica de createInstallmentPurchase)
 * 2. Remove o lançamento original
 */
export const convertTransactionToInstallment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      transaction_id: z.string().uuid(),
      installments_count: z.number().int().min(2).max(360),
    }).parse(i),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { data: tx, error: txErr } = await supabase
      .from("transactions")
      .select("id,description,amount,occurred_at,account_id,category_id,type")
      .eq("id", data.transaction_id)
      .eq("user_id", userId)
      .single();
    if (txErr) throw new Error(txErr.message);
    if (!tx) throw new Error("Lançamento não encontrado");
    if (tx.type !== "expense") throw new Error("Só despesas podem virar parcelamento");
    if (!tx.account_id) throw new Error("Lançamento precisa estar vinculado a um cartão");

    const { data: purchase, error: e1 } = await supabase
      .from("installment_purchases")
      .insert({
        user_id: userId,
        description: tx.description,
        total_amount: Number(tx.amount),
        installments_count: data.installments_count,
        first_due_date: tx.occurred_at,
        account_id: tx.account_id,
        category_id: tx.category_id ?? null,
      })
      .select("id")
      .single();
    if (e1) throw new Error(e1.message);

    const parcelas = calcularParcelas(Number(tx.amount), data.installments_count, tx.occurred_at);

    const items = parcelas.map((p) => ({
      purchase_id: purchase.id,
      user_id: userId,
      number: p.number,
      due_date: p.due_date,
      amount: p.amount,
    }));
    const { error: e2 } = await supabase.from("installment_items").insert(items);
    if (e2) throw new Error(e2.message);

    // Remove o lançamento original ANTES de inserir as parcelas (evita dupla contagem)
    const { error: e3 } = await supabase
      .from("transactions")
      .delete()
      .eq("id", data.transaction_id)
      .eq("user_id", userId);
    if (e3) throw new Error(e3.message);

    await inserirParcelasComoTransactions(supabase, {
      userId,
      purchaseId: purchase.id,
      description: tx.description,
      account_id: tx.account_id,
      category_id: tx.category_id ?? null,
      installments_total: data.installments_count,
      parcelas,
    });

    return { ok: true, purchase_id: purchase.id };
  });
