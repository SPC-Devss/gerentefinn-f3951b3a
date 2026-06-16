import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const FREQ = ["weekly", "monthly", "yearly"] as const;

export const listRecurrences = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("recurrences")
      .select(
        "id,description,type,amount,frequency,day_of_month,next_run_at,active,category_id,account_id,categories(name),accounts(name,color)",
      )
      .eq("user_id", userId)
      .order("next_run_at", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const createRecurrence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        description: z.string().min(1).max(120),
        type: z.enum(["income", "expense"]),
        amount: z.number().positive(),
        frequency: z.enum(FREQ).default("monthly"),
        day_of_month: z.number().int().min(1).max(31).optional().nullable(),
        next_run_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        category_id: z.string().uuid().optional().nullable(),
        account_id: z.string().uuid().optional().nullable(),
      })
      .parse(i),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("recurrences")
      .insert({ ...data, user_id: userId })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const toggleRecurrence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid(), active: z.boolean() }).parse(i))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("recurrences")
      .update({ active: data.active })
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteRecurrence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("recurrences").delete().eq("id", data.id).eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const materializeDue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc("materialize_due_recurrences", { _user_id: userId });
    if (error) throw new Error(error.message);
    return { inserted: data ?? 0 };
  });
