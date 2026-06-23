import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/**
 * Resumo gerencial de um cartão de crédito para um mês de referência:
 * - spentCash: compras à vista no cartão na fatura
 * - spentInstallments: parcelas que caem nesta fatura
 * - currentInvoice: total atual da fatura (cash + parcelas, líquido de estornos)
 * - alreadyPaid: total de pagamentos já registrados explicitamente apontando para esta fatura (`paid_invoice_id`)
 * - committedFuture: compromissos futuros já fechados (parcelas com vencimento após o fim do mês de referência)
 * - usagePct: percentual de uso do limite (`currentInvoice / credit_limit * 100`)
 */
export const getCreditCardSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        accountId: z.string().uuid(),
        referenceMonth: z
          .string()
          .regex(/^\d{4}-\d{2}$/)
          .optional(),
      })
      .parse(i),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const ref = data.referenceMonth ?? new Date().toISOString().slice(0, 7);
    const [yStr, mStr] = ref.split("-");
    const refStart = `${ref}-01`;
    const endOfMonth = new Date(Date.UTC(Number(yStr), Number(mStr), 0))
      .toISOString()
      .slice(0, 10);

    const { data: acc, error: accErr } = await supabase
      .from("accounts")
      .select("id,name,type,credit_limit,color")
      .eq("id", data.accountId)
      .eq("user_id", userId)
      .single();
    if (accErr) throw new Error(accErr.message);
    if (!acc || acc.type !== "credit_card") {
      throw new Error("Conta não é cartão de crédito");
    }

    const { data: inv } = await supabase
      .from("credit_card_invoices")
      .select("id,total_amount,closing_date,due_date,reference_month,status")
      .eq("user_id", userId)
      .eq("account_id", data.accountId)
      .eq("reference_month", refStart)
      .maybeSingle();

    let spentCash = 0;
    let spentInstallments = 0;
    if (inv?.id) {
      const { data: txs } = await supabase
        .from("transactions")
        .select("amount,type,installments_total")
        .eq("user_id", userId)
        .eq("invoice_id", inv.id);
      for (const t of txs ?? []) {
        const sign = t.type === "expense" ? 1 : -1;
        const v = Number(t.amount) * sign;
        if (!t.installments_total || t.installments_total <= 1) spentCash += v;
        else spentInstallments += v;
      }
    }
    const currentInvoice = spentCash + spentInstallments;

    let alreadyPaid = 0;
    if (inv?.id) {
      const { data: pays } = await supabase
        .from("transactions")
        .select("amount,type,account_id")
        .eq("user_id", userId)
        .eq("paid_invoice_id", inv.id);
      // Considera apenas a perna que sai da conta de origem (expense) ou
      // pagamentos lançados diretamente como expense; ignora a perna `income`
      // do destino para evitar dupla contagem.
      for (const t of pays ?? []) {
        if (t.type === "expense") alreadyPaid += Number(t.amount);
      }
    }

    const { data: fut } = await supabase
      .from("transactions")
      .select("amount")
      .eq("user_id", userId)
      .eq("account_id", data.accountId)
      .eq("type", "expense")
      .not("installment_purchase_id", "is", null)
      .gt("occurred_at", endOfMonth);
    const committedFuture = (fut ?? []).reduce((s, t) => s + Number(t.amount), 0);

    const limit = acc.credit_limit != null ? Number(acc.credit_limit) : null;
    const usagePct =
      limit && limit > 0 ? Math.max(0, (currentInvoice / limit) * 100) : null;

    return {
      accountId: acc.id,
      accountName: acc.name,
      accountColor: acc.color,
      creditLimit: limit,
      referenceMonth: refStart,
      invoiceId: inv?.id ?? null,
      invoiceDueDate: inv?.due_date ?? null,
      invoiceClosingDate: inv?.closing_date ?? null,
      invoiceStatus: inv?.status ?? null,
      spentCash,
      spentInstallments,
      currentInvoice,
      alreadyPaid,
      committedFuture,
      usagePct,
    };
  });
