import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

type AccountLite = {
  id: string;
  name: string;
  color: string | null;
  institution: string | null;
  closing_day: number | null;
  due_day: number | null;
};

function lastDayOfMonth(year: number, monthIdx0: number): number {
  return new Date(Date.UTC(year, monthIdx0 + 1, 0)).getUTCDate();
}

function isoDate(year: number, monthIdx0: number, day: number): string {
  const d = new Date(Date.UTC(year, monthIdx0, day));
  return d.toISOString().slice(0, 10);
}

/**
 * Replicates assign_transaction_to_invoice() in TS for projection:
 * Given an account and a due date of an installment item, returns the
 * reference_month / closing_date / due_date of the invoice it would belong to.
 */
function computeInvoiceWindow(acc: AccountLite, occurredAt: string) {
  const [y, m, d] = occurredAt.split("-").map(Number);
  const monthIdx0 = m - 1;
  let closingY = y;
  let closingM = monthIdx0;
  let closingD: number;

  if (acc.closing_day == null) {
    closingD = lastDayOfMonth(y, monthIdx0);
  } else {
    const lastInMonth = lastDayOfMonth(y, monthIdx0);
    closingD = Math.min(acc.closing_day, lastInMonth);
    if (d > closingD) {
      // shift one month forward
      const next = new Date(Date.UTC(y, monthIdx0 + 1, 1));
      closingY = next.getUTCFullYear();
      closingM = next.getUTCMonth();
      closingD = Math.min(acc.closing_day, lastDayOfMonth(closingY, closingM));
    }
  }

  const closing_date = isoDate(closingY, closingM, closingD);
  const reference_month = isoDate(closingY, closingM, 1);

  let dueY: number;
  let dueM: number;
  let dueD: number;
  if (acc.due_day == null) {
    const baseClosing = new Date(Date.UTC(closingY, closingM, closingD));
    baseClosing.setUTCDate(baseClosing.getUTCDate() + 10);
    dueY = baseClosing.getUTCFullYear();
    dueM = baseClosing.getUTCMonth();
    dueD = baseClosing.getUTCDate();
  } else {
    const dueBase = new Date(Date.UTC(closingY, closingM + 1, 1));
    dueY = dueBase.getUTCFullYear();
    dueM = dueBase.getUTCMonth();
    dueD = Math.min(acc.due_day, lastDayOfMonth(dueY, dueM));
  }
  const due_date = isoDate(dueY, dueM, dueD);

  return { reference_month, closing_date, due_date };
}

export const listInvoices = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const today = new Date();
    const horizonEnd = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 12, 28))
      .toISOString()
      .slice(0, 10);

    const [invoicesRes, accountsRes, purchasesRes, itemsRes] = await Promise.all([
      supabase
        .from("credit_card_invoices")
        .select(
          "id,account_id,reference_month,closing_date,due_date,total_amount,status,paid_at",
        )
        .eq("user_id", userId)
        .order("due_date", { ascending: false }),
      supabase
        .from("accounts")
        .select("id,name,color,institution,type,closing_day,due_day,archived")
        .eq("user_id", userId)
        .eq("archived", false)
        .eq("type", "credit_card"),
      supabase
        .from("installment_purchases")
        .select("id,account_id")
        .eq("user_id", userId),
      supabase
        .from("installment_items")
        .select("id,purchase_id,due_date,amount,paid")
        .eq("user_id", userId)
        .lte("due_date", horizonEnd),
    ]);

    if (invoicesRes.error) throw new Error(invoicesRes.error.message);
    if (accountsRes.error) throw new Error(accountsRes.error.message);
    if (purchasesRes.error) throw new Error(purchasesRes.error.message);
    if (itemsRes.error) throw new Error(itemsRes.error.message);

    const accountsById = new Map<string, AccountLite>();
    for (const a of accountsRes.data ?? []) {
      accountsById.set(a.id, a as AccountLite);
    }

    const realInvoices = (invoicesRes.data ?? []).map((inv) => {
      const acc = inv.account_id ? accountsById.get(inv.account_id) : undefined;
      return {
        ...inv,
        accounts: acc
          ? { name: acc.name, color: acc.color, institution: acc.institution }
          : null,
        projected: false as const,
      };
    });

    const purchaseAccount = new Map<string, string>();
    for (const p of purchasesRes.data ?? []) {
      if (p.account_id) purchaseAccount.set(p.id, p.account_id);
    }

    // Bucket installment items by (account_id, reference_month)
    const buckets = new Map<
      string,
      {
        account_id: string;
        reference_month: string;
        closing_date: string;
        due_date: string;
        total_amount: number;
      }
    >();

    const todayIso = today.toISOString().slice(0, 10);
    for (const it of itemsRes.data ?? []) {
      const accId = purchaseAccount.get(it.purchase_id);
      if (!accId) continue;
      const acc = accountsById.get(accId);
      if (!acc) continue;
      const win = computeInvoiceWindow(acc, it.due_date);
      // Only project future months (closing in the future)
      if (win.closing_date < todayIso) continue;
      const key = `${accId}|${win.reference_month}`;
      const existing = buckets.get(key);
      const amt = Number(it.amount) || 0;
      if (existing) {
        existing.total_amount += amt;
      } else {
        buckets.set(key, {
          account_id: accId,
          reference_month: win.reference_month,
          closing_date: win.closing_date,
          due_date: win.due_date,
          total_amount: amt,
        });
      }
    }

    // Drop projections that already have a physical invoice
    const realKey = new Set(
      realInvoices.map((r) => `${r.account_id}|${r.reference_month.slice(0, 10)}`),
    );
    const projected = Array.from(buckets.values())
      .filter((b) => !realKey.has(`${b.account_id}|${b.reference_month}`))
      .map((b, idx) => {
        const acc = accountsById.get(b.account_id);
        return {
          id: `projected-${b.account_id}-${b.reference_month}-${idx}`,
          account_id: b.account_id,
          reference_month: b.reference_month,
          closing_date: b.closing_date,
          due_date: b.due_date,
          total_amount: b.total_amount,
          status: "open" as const,
          paid_at: null as string | null,
          accounts: acc
            ? { name: acc.name, color: acc.color, institution: acc.institution }
            : null,
          projected: true as const,
        };
      });

    const all = [...realInvoices, ...projected].sort((a, b) =>
      a.due_date < b.due_date ? 1 : -1,
    );
    return all;
  });

export const getInvoiceDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string() }).parse(i))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    if (data.id.startsWith("projected-")) {
      return { invoice: null, transactions: [] as never[], projected: true as const };
    }
    const [{ data: invoice, error: e1 }, { data: txs, error: e2 }] = await Promise.all([
      supabase
        .from("credit_card_invoices")
        .select(
          "id,account_id,reference_month,closing_date,due_date,total_amount,status,paid_at",
        )
        .eq("id", data.id)
        .eq("user_id", userId)
        .single(),
      supabase
        .from("transactions")
        .select("id,amount,description,occurred_at,type,categories(name,icon)")
        .eq("invoice_id", data.id)
        .eq("user_id", userId)
        .order("occurred_at", { ascending: false }),
    ]);
    if (e1) throw new Error(e1.message);
    if (e2) throw new Error(e2.message);
    let accounts: { name: string; color: string | null; institution: string | null } | null = null;
    if (invoice?.account_id) {
      const { data: acc } = await supabase
        .from("accounts")
        .select("name,color,institution")
        .eq("id", invoice.account_id)
        .eq("user_id", userId)
        .maybeSingle();
      if (acc) accounts = acc;
    }
    return {
      invoice: invoice ? { ...invoice, accounts } : null,
      transactions: txs ?? [],
      projected: false as const,
    };
  });

export const markInvoicePaid = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid(), paid: z.boolean() }).parse(i))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("credit_card_invoices")
      .update({ status: data.paid ? "paid" : "open", paid_at: data.paid ? new Date().toISOString() : null })
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
