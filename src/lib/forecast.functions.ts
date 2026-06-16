import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const getCashflowForecast = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ days: z.number().int().min(7).max(180).default(30) }).parse(i ?? {}))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: series, error } = await supabaseAdmin.rpc("forecast_cashflow", {
      _user_id: userId,
      _days: data.days,
    });
    if (error) throw new Error(error.message);

    const today = new Date().toISOString().slice(0, 10);
    const horizon = new Date(Date.now() + data.days * 86400000).toISOString().slice(0, 10);

    const [{ data: invoices }, { data: recurrences }] = await Promise.all([
      supabase
        .from("credit_card_invoices")
        .select("id,due_date,total_amount,status,accounts(name)")
        .eq("user_id", userId)
        .neq("status", "paid")
        .gte("due_date", today)
        .lte("due_date", horizon)
        .order("due_date", { ascending: true }),
      supabase
        .from("recurrences")
        .select("id,description,amount,type,next_run_at,frequency")
        .eq("user_id", userId)
        .eq("active", true)
        .gte("next_run_at", today)
        .lte("next_run_at", horizon)
        .order("next_run_at", { ascending: true }),
    ]);

    return {
      series: (series ?? []) as Array<{ day: string; projected_balance: number }>,
      upcomingInvoices: invoices ?? [],
      upcomingRecurrences: recurrences ?? [],
    };
  });
