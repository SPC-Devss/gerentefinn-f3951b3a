DELETE FROM public.accounts WHERE user_id NOT IN (SELECT id FROM auth.users);
DELETE FROM public.goals WHERE user_id NOT IN (SELECT id FROM auth.users);
DELETE FROM public.recurrences WHERE user_id NOT IN (SELECT id FROM auth.users);
DELETE FROM public.budgets WHERE user_id NOT IN (SELECT id FROM auth.users);
DELETE FROM public.credit_card_invoices WHERE user_id NOT IN (SELECT id FROM auth.users);
DELETE FROM public.installment_purchases WHERE user_id NOT IN (SELECT id FROM auth.users);
DELETE FROM public.installment_items WHERE user_id NOT IN (SELECT id FROM auth.users);

ALTER TABLE public.accounts              ADD CONSTRAINT accounts_user_id_fkey              FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.goals                 ADD CONSTRAINT goals_user_id_fkey                 FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.recurrences           ADD CONSTRAINT recurrences_user_id_fkey           FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.budgets               ADD CONSTRAINT budgets_user_id_fkey               FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.credit_card_invoices  ADD CONSTRAINT credit_card_invoices_user_id_fkey  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.installment_purchases ADD CONSTRAINT installment_purchases_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.installment_items     ADD CONSTRAINT installment_items_user_id_fkey     FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION public.account_balances(_user_id uuid)
RETURNS TABLE(account_id uuid, balance numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT account_id,
         SUM(CASE WHEN type='income' THEN amount
                  WHEN type='expense' THEN -amount
                  ELSE 0 END) AS balance
  FROM public.transactions
  WHERE user_id = _user_id AND account_id IS NOT NULL
  GROUP BY account_id;
$$;
GRANT EXECUTE ON FUNCTION public.account_balances(uuid) TO authenticated;