import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const deleteMyAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    // Order respects FK dependencies (children before parents).
    const userTables = [
      "installment_items",
      "installment_purchases",
      "credit_card_invoices",
      "budgets",
      "messages",
      "threads",
      "transactions",
      "recurrences",
      "goals",
      "accounts",
      "categories",
    ] as const;
    for (const t of userTables) {
      const { error } = await supabaseAdmin.from(t).delete().eq("user_id", userId);
      if (error) throw new Error(`Falha ao limpar ${t}: ${error.message}`);
    }
    const { error: profErr } = await supabaseAdmin.from("profiles").delete().eq("id", userId);
    if (profErr) throw new Error(`Falha ao limpar profiles: ${profErr.message}`);
    const { error: authErr } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (authErr) throw new Error(authErr.message);
    return { ok: true };
  });
