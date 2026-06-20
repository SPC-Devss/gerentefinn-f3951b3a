CREATE OR REPLACE FUNCTION public.account_balances(_user_id uuid)
RETURNS TABLE(account_id uuid, balance numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT account_id,
         SUM(CASE WHEN type='income' THEN amount
                  WHEN type='expense' THEN -amount
                  ELSE 0 END) AS balance
  FROM public.transactions
  WHERE user_id = _user_id AND account_id IS NOT NULL
  GROUP BY account_id;
$$;