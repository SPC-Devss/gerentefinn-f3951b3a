import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const ACCOUNT_TYPES = ["checking", "savings", "cash", "credit_card", "investment"] as const;

export const listAccounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: accounts, error } = await supabase
      .from("accounts")
      .select("id,name,type,institution,color,closing_day,due_day,credit_limit,archived,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);

    // Compute balance per account
    const { data: txs } = await supabase
      .from("transactions")
      .select("account_id,type,amount")
      .eq("user_id", userId);
    const balances: Record<string, number> = {};
    for (const t of txs ?? []) {
      if (!t.account_id) continue;
      const v = Number(t.amount);
      balances[t.account_id] = (balances[t.account_id] ?? 0) + (t.type === "income" ? v : t.type === "expense" ? -v : 0);
    }
    return (accounts ?? []).map((a) => ({ ...a, balance: balances[a.id] ?? 0 }));
  });

export const createAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        name: z.string().min(1).max(60),
        type: z.enum(ACCOUNT_TYPES),
        institution: z.string().max(60).optional().nullable(),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#4f46e5"),
        closing_day: z.number().int().min(1).max(31).optional().nullable(),
        due_day: z.number().int().min(1).max(31).optional().nullable(),
        credit_limit: z.number().nonnegative().optional().nullable(),
      })
      .parse(i),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("accounts")
      .insert({ ...data, user_id: userId })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const updateAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        name: z.string().min(1).max(60),
        type: z.enum(ACCOUNT_TYPES),
        institution: z.string().max(60).optional().nullable(),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        closing_day: z.number().int().min(1).max(31).optional().nullable(),
        due_day: z.number().int().min(1).max(31).optional().nullable(),
        credit_limit: z.number().nonnegative().optional().nullable(),
      })
      .parse(i),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { id, ...patch } = data;
    const { error } = await supabase
      .from("accounts")
      .update(patch)
      .eq("id", id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const archiveAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid(), archived: z.boolean() }).parse(i))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("accounts")
      .update({ archived: data.archived })
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("accounts").delete().eq("id", data.id).eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
