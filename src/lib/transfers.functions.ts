import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/**
 * Cria uma transferência entre duas contas como duas linhas em `transactions`,
 * vinculadas pelo mesmo `transfer_id`. A perna de origem é despesa, a de destino
 * é entrada. O trigger de fatura ignora qualquer linha com `transfer_id`.
 *
 * Para pagamento de fatura de cartão, basta passar `paid_invoice_id` apontando
 * para a fatura amortizada — ele é registrado na perna de destino (entrada).
 */
export const createTransfer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        from_account_id: z.string().uuid(),
        to_account_id: z.string().uuid(),
        amount: z.number().positive(),
        description: z.string().min(1).max(200),
        occurred_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        category_id: z.string().uuid().nullable().optional(),
        paid_invoice_id: z.string().uuid().nullable().optional(),
      })
      .refine((d) => d.from_account_id !== d.to_account_id, {
        message: "A conta de origem deve ser diferente da conta de destino",
        path: ["to_account_id"],
      })
      .parse(i),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const transfer_id = crypto.randomUUID();

    const rows = [
      {
        user_id: userId,
        type: "expense" as const,
        amount: data.amount,
        description: data.description,
        occurred_at: data.occurred_at,
        category_id: data.category_id ?? null,
        account_id: data.from_account_id,
        source: "manual",
        transfer_id,
        paid_invoice_id: data.paid_invoice_id ?? null,
      },
      {
        user_id: userId,
        type: "income" as const,
        amount: data.amount,
        description: data.description,
        occurred_at: data.occurred_at,
        category_id: data.category_id ?? null,
        account_id: data.to_account_id,
        source: "manual",
        transfer_id,
        paid_invoice_id: data.paid_invoice_id ?? null,
      },
    ];

    const { error } = await supabase.from("transactions").insert(rows);
    if (error) throw new Error(error.message);
    return { ok: true, transfer_id };
  });

/**
 * Exclui as duas pernas da transferência ao mesmo tempo.
 */
export const deleteTransfer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ transfer_id: z.string().uuid() }).parse(i))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("transactions")
      .delete()
      .eq("transfer_id", data.transfer_id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
