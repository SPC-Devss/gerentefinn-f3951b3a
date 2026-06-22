INSERT INTO public.transactions (
  user_id, type, amount, description, category_id, account_id,
  occurred_at, source, installment_purchase_id, installment_number, installments_total
)
SELECT
  p.user_id,
  'expense'::tx_type,
  it.amount,
  p.description || ' (' || it.number || '/' || p.installments_count || ')',
  p.category_id,
  p.account_id,
  it.due_date,
  'installment',
  p.id,
  it.number,
  p.installments_count
FROM public.installment_purchases p
JOIN public.installment_items it ON it.purchase_id = p.id
WHERE NOT EXISTS (
  SELECT 1 FROM public.transactions t WHERE t.installment_purchase_id = p.id
);