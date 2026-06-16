
-- Revoke EXECUTE on SECURITY DEFINER functions from public/anon/authenticated.
-- Trigger-only functions: never called via API.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.touch_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_recompute_invoice() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.assign_transaction_to_invoice() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.recompute_invoice_total(uuid) FROM PUBLIC, anon, authenticated;

-- RPC functions: called from server functions; route through service_role only.
REVOKE EXECUTE ON FUNCTION public.forecast_cashflow(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.materialize_due_recurrences(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.forecast_cashflow(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.materialize_due_recurrences(uuid) TO service_role;

-- Remove auth.uid() guards inside these two RPCs since they are no longer
-- callable by signed-in users; the calling server function already validated
-- the user via requireSupabaseAuth before invoking via the admin client.
CREATE OR REPLACE FUNCTION public.forecast_cashflow(_user_id uuid, _days integer)
 RETURNS TABLE(day date, projected_balance numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  start_balance numeric;
BEGIN
  SELECT COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE -amount END), 0)
  INTO start_balance
  FROM public.transactions
  WHERE user_id = _user_id AND occurred_at <= CURRENT_DATE;

  RETURN QUERY
  WITH days AS (
    SELECT generate_series(CURRENT_DATE, CURRENT_DATE + (_days || ' days')::interval, '1 day')::date AS d
  ),
  future AS (
    SELECT due_date AS d, -total_amount AS delta
    FROM public.credit_card_invoices
    WHERE user_id = _user_id AND status <> 'paid' AND due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + (_days || ' days')::interval
    UNION ALL
    SELECT next_run_at AS d, CASE WHEN type = 'income' THEN amount ELSE -amount END AS delta
    FROM public.recurrences
    WHERE user_id = _user_id AND active = true AND next_run_at BETWEEN CURRENT_DATE AND CURRENT_DATE + (_days || ' days')::interval
  )
  SELECT d.d,
    start_balance + COALESCE((SELECT SUM(delta) FROM future f WHERE f.d <= d.d), 0) AS projected_balance
  FROM days d
  ORDER BY d.d;
END;
$function$;

CREATE OR REPLACE FUNCTION public.materialize_due_recurrences(_user_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  inserted integer := 0;
  next_date date;
BEGIN
  FOR r IN
    SELECT * FROM public.recurrences
    WHERE user_id = _user_id AND active = true AND next_run_at <= CURRENT_DATE
  LOOP
    WHILE r.next_run_at <= CURRENT_DATE LOOP
      INSERT INTO public.transactions
        (user_id, type, amount, description, category_id, account_id, occurred_at, source, recurrence_id)
      VALUES
        (r.user_id, r.type, r.amount, r.description, r.category_id, r.account_id, r.next_run_at, 'recurrence', r.id);
      inserted := inserted + 1;

      next_date := CASE r.frequency
        WHEN 'weekly'  THEN r.next_run_at + INTERVAL '7 days'
        WHEN 'monthly' THEN (r.next_run_at + INTERVAL '1 month')::date
        WHEN 'yearly'  THEN (r.next_run_at + INTERVAL '1 year')::date
      END;
      r.next_run_at := next_date;
    END LOOP;
    UPDATE public.recurrences SET next_run_at = r.next_run_at WHERE id = r.id;
  END LOOP;
  RETURN inserted;
END;
$function$;

-- Re-revoke after CREATE OR REPLACE (Postgres re-grants default EXECUTE to PUBLIC).
REVOKE EXECUTE ON FUNCTION public.forecast_cashflow(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.materialize_due_recurrences(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.forecast_cashflow(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.materialize_due_recurrences(uuid) TO service_role;
