import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const listTransactions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("transactions")
      .select("id,type,amount,description,occurred_at,category_id,account_id,categories(name,icon),accounts(name,color,type)")
      .eq("user_id", userId)
      .order("occurred_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const summaryServerFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from("transactions")
      .select("type,amount")
      .eq("user_id", userId)
      .gte("occurred_at", start);
    if (error) throw new Error(error.message);
    let income = 0, expense = 0;
    for (const t of data ?? []) {
      const v = Number(t.amount);
      if (t.type === "income") income += v;
      else if (t.type === "expense") expense += v;
    }
    return { income, expense, balance: income - expense };
  });

export const createTransaction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      type: z.enum(["income", "expense", "transfer"]),
      amount: z.number().positive(),
      description: z.string().min(1).max(200),
      occurred_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      category_id: z.string().uuid().nullable().optional(),
      account_id: z.string().uuid().nullable().optional(),
      force: z.boolean().optional(),
    }).parse(i),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;

    // Anti-duplicidade: mesmo account_id + occurred_at + type + amount
    if (!data.force && data.account_id) {
      const { data: dups, error: dupErr } = await supabase
        .from("transactions")
        .select("id,description,occurred_at,amount,type,account_id")
        .eq("user_id", userId)
        .eq("account_id", data.account_id)
        .eq("type", data.type)
        .eq("occurred_at", data.occurred_at)
        .eq("amount", data.amount)
        .limit(1);
      if (dupErr) throw new Error(dupErr.message);
      if (dups && dups.length > 0) {
        return { ok: false as const, duplicate: true as const, existing: dups[0] };
      }
    }

    const { data: row, error } = await supabase
      .from("transactions")
      .insert({
        user_id: userId,
        type: data.type,
        amount: data.amount,
        description: data.description,
        occurred_at: data.occurred_at,
        category_id: data.category_id ?? null,
        account_id: data.account_id ?? null,
        source: "manual",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { ok: true as const, duplicate: false as const, id: row.id as string };
  });


export const updateTransaction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      id: z.string().uuid(),
      type: z.enum(["income", "expense", "transfer"]).optional(),
      amount: z.number().positive().optional(),
      description: z.string().min(1).max(200).optional(),
      occurred_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      category_id: z.string().uuid().nullable().optional(),
      account_id: z.string().uuid().nullable().optional(),
    }).parse(i),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { id, ...patch } = data;
    const { error } = await supabase.from("transactions").update(patch).eq("id", id).eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteTransaction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("transactions").delete().eq("id", data.id).eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteTransactionsBulk = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ ids: z.array(z.string().uuid()).min(1).max(500) }).parse(i))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("transactions").delete().in("id", data.ids).eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true, count: data.ids.length };
  });
