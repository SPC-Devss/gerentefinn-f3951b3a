CREATE OR REPLACE FUNCTION public.recompute_invoice_total(_invoice_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.credit_card_invoices i
  SET total_amount = COALESCE((
    SELECT SUM(CASE WHEN type = 'expense' THEN amount ELSE -amount END)
    FROM public.transactions
    WHERE invoice_id = _invoice_id
  ), 0)
  WHERE i.id = _invoice_id;
$$;

CREATE OR REPLACE FUNCTION public.assign_transaction_to_invoice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  acc record;
  ref_month date;
  closing date;
  due date;
  inv_id uuid;
  closing_month_last int;
  due_month_last int;
  due_base date;
BEGIN
  IF NEW.account_id IS NULL THEN
    NEW.invoice_id := NULL;
    RETURN NEW;
  END IF;

  SELECT * INTO acc FROM public.accounts WHERE id = NEW.account_id;
  IF NOT FOUND OR acc.type <> 'credit_card' THEN
    NEW.invoice_id := NULL;
    RETURN NEW;
  END IF;

  -- Closing date for this transaction, clamped to last day of month
  IF acc.closing_day IS NULL THEN
    ref_month := date_trunc('month', NEW.occurred_at)::date;
    closing := (ref_month + INTERVAL '1 month - 1 day')::date;
  ELSE
    closing_month_last := EXTRACT(day FROM (date_trunc('month', NEW.occurred_at) + INTERVAL '1 month - 1 day'))::int;
    closing := make_date(
      EXTRACT(year FROM NEW.occurred_at)::int,
      EXTRACT(month FROM NEW.occurred_at)::int,
      LEAST(acc.closing_day, closing_month_last)
    );
    IF NEW.occurred_at > closing THEN
      closing := (closing + INTERVAL '1 month')::date;
    END IF;
    ref_month := date_trunc('month', closing)::date;
  END IF;

  -- Due date, clamped to last day of the due month (no hardcoded 28)
  IF acc.due_day IS NULL THEN
    due := (closing + INTERVAL '10 days')::date;
  ELSE
    due_base := (closing + INTERVAL '1 month')::date;
    due_month_last := EXTRACT(day FROM (date_trunc('month', due_base) + INTERVAL '1 month - 1 day'))::int;
    due := make_date(
      EXTRACT(year FROM due_base)::int,
      EXTRACT(month FROM due_base)::int,
      LEAST(acc.due_day, due_month_last)
    );
  END IF;

  INSERT INTO public.credit_card_invoices (user_id, account_id, reference_month, closing_date, due_date)
  VALUES (NEW.user_id, NEW.account_id, ref_month, closing, due)
  ON CONFLICT (account_id, reference_month) DO UPDATE
    SET closing_date = EXCLUDED.closing_date, due_date = EXCLUDED.due_date
  RETURNING id INTO inv_id;

  NEW.invoice_id := inv_id;
  RETURN NEW;
END;
$$;