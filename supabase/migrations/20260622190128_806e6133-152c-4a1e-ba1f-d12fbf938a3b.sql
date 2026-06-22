ALTER TABLE public.transactions
  ADD COLUMN installment_purchase_id uuid REFERENCES public.installment_purchases(id) ON DELETE CASCADE,
  ADD COLUMN installment_number smallint,
  ADD COLUMN installments_total smallint;

CREATE INDEX IF NOT EXISTS idx_transactions_installment_purchase
  ON public.transactions(installment_purchase_id)
  WHERE installment_purchase_id IS NOT NULL;