
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS transfer_id uuid,
  ADD COLUMN IF NOT EXISTS paid_invoice_id uuid REFERENCES public.credit_card_invoices(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_transfer ON public.transactions(transfer_id) WHERE transfer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_paid_invoice ON public.transactions(paid_invoice_id) WHERE paid_invoice_id IS NOT NULL;

-- Atualiza trigger para excluir transferências e pagamentos de fatura
CREATE OR REPLACE FUNCTION public.assign_transaction_to_invoice()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- Transferências nunca entram em fatura
  IF NEW.type = 'transfer' THEN
    NEW.invoice_id := NULL;
    RETURN NEW;
  END IF;

  -- Entradas (income) descritas como pagamento de fatura não devem ser vinculadas como movimento da fatura
  IF NEW.type = 'income' AND NEW.description ILIKE '%PAGAMENTO DE FATURA%' THEN
    NEW.invoice_id := NULL;
    RETURN NEW;
  END IF;

  IF NEW.account_id IS NULL THEN
    NEW.invoice_id := NULL;
    RETURN NEW;
  END IF;

  SELECT * INTO acc FROM public.accounts WHERE id = NEW.account_id;
  IF NOT FOUND OR acc.type <> 'credit_card' THEN
    NEW.invoice_id := NULL;
    RETURN NEW;
  END IF;

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
$function$;

-- Backfill: coletar faturas afetadas, limpar vínculo e recomputar totais
DO $$
DECLARE
  affected uuid[];
  inv uuid;
BEGIN
  SELECT COALESCE(array_agg(DISTINCT invoice_id), ARRAY[]::uuid[])
  INTO affected
  FROM public.transactions
  WHERE type = 'income'
    AND description ILIKE '%PAGAMENTO DE FATURA%'
    AND invoice_id IS NOT NULL;

  UPDATE public.transactions
  SET invoice_id = NULL
  WHERE type = 'income'
    AND description ILIKE '%PAGAMENTO DE FATURA%'
    AND invoice_id IS NOT NULL;

  IF array_length(affected, 1) IS NOT NULL THEN
    FOREACH inv IN ARRAY affected LOOP
      PERFORM public.recompute_invoice_total(inv);
    END LOOP;
  END IF;
END $$;
