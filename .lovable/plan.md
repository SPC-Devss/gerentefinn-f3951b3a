# Plano: Segurança estrutural, LGPD e performance

## 1. Migration — FKs com CASCADE em `user_id`

Nova migration adicionando `FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE` nas tabelas que hoje têm a coluna solta:

- `accounts`, `goals`, `recurrences`, `budgets`, `credit_card_invoices`, `installment_purchases`, `installment_items`

Para cada uma:
```sql
ALTER TABLE public.<t>
  ADD CONSTRAINT <t>_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
```

Por consistência, também adicionar a mesma FK CASCADE em `transactions`, `messages`, `threads` e `categories` (todas com `user_id` mas sem FK declarada). `categories.user_id` é nullable (categorias globais) — manter nullable e usar CASCADE apenas quando preenchido (CASCADE em coluna nullable funciona normalmente, linhas globais não são afetadas).

A migration também cria uma RPC agregada usada pelo passo 3:
```sql
CREATE OR REPLACE FUNCTION public.account_balances(_user_id uuid)
RETURNS TABLE(account_id uuid, balance numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT account_id,
         SUM(CASE WHEN type='income' THEN amount
                  WHEN type='expense' THEN -amount
                  ELSE 0 END) AS balance
  FROM public.transactions
  WHERE user_id = _user_id AND account_id IS NOT NULL
  GROUP BY account_id;
$$;
GRANT EXECUTE ON FUNCTION public.account_balances(uuid) TO authenticated;
```

## 2. `deleteMyAccount` — limpeza LGPD completa

Atualizar `src/lib/profile.functions.ts` para incluir as tabelas extras na limpeza explícita antes de remover o usuário do `auth`:

Lista final (ordem segura para evitar conflitos de FK):
`installment_items` → `installment_purchases` → `credit_card_invoices` → `budgets` → `messages` → `threads` → `transactions` → `recurrences` → `goals` → `accounts` → `categories` → `profiles` → `auth.admin.deleteUser`.

Mesmo com o CASCADE da etapa 1 cobrindo o caso, a remoção explícita garante limpeza auditável e independência de futuras mudanças no schema.

## 3. `listAccounts` — saldo agregado no Postgres

Em `src/lib/accounts.functions.ts`, substituir o `SELECT account_id,type,amount` por uma chamada à RPC `account_balances`:

```ts
const { data: balRows } = await supabase.rpc("account_balances", { _user_id: userId });
const balances = Object.fromEntries((balRows ?? []).map(r => [r.account_id, Number(r.balance)]));
```

Mantém o shape de retorno (`{ ...account, balance }`) — nenhum consumidor precisa mudar. Elimina o transporte de N transações por requisição.

## Detalhes técnicos

- Tipos do Supabase (`src/integrations/supabase/types.ts`) são regenerados após a migration; só então o código do passo 3 que usa `supabase.rpc("account_balances", ...)` será aplicado.
- Nenhuma mudança de RLS é necessária: as FKs respeitam o owner via `auth.users(id)` e a RPC é `SECURITY DEFINER` filtrada por `_user_id` (será chamada com `userId` do contexto autenticado).
- Nenhuma migração de dados — apenas DDL aditivo. Caso já existam linhas com `user_id` órfão (sem usuário correspondente em `auth.users`), o `ADD CONSTRAINT` falhará; nesse caso, removo as linhas órfãs no início da migration com `DELETE ... WHERE user_id NOT IN (SELECT id FROM auth.users)`.
