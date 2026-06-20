DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'credit_card_invoices_account_id_fkey'
      AND conrelid = 'public.credit_card_invoices'::regclass
  ) THEN
    DELETE FROM public.credit_card_invoices i
    WHERE i.account_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.accounts a WHERE a.id = i.account_id);
    ALTER TABLE public.credit_card_invoices
      ADD CONSTRAINT credit_card_invoices_account_id_fkey
      FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;
  END IF;
END $$;
NOTIFY pgrst, 'reload schema';