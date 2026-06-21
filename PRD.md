# PRD — Finn (Gerente Financeiro Pessoal)

> Documento de requisitos e arquitetura para replicar o produto **Finn** em
> outra plataforma de vibe coding (Cursor, Bolt, v0, Replit Agent, Windsurf
> etc.), usando **Supabase externo** (conta própria do usuário, criada em
> [supabase.com](https://supabase.com)) e uma stack moderna React +
> TanStack Start. Em pt-BR. Autossuficiente: não depende de nenhum recurso
> proprietário de plataforma de hospedagem.

---

## 1. Visão geral do produto

- **Nome interno do repositório/projeto:** Conversa Financeira.
- **Nome do produto (visível ao usuário):** **Finn**.
- **Problema:** o usuário tem várias contas bancárias e cartões de crédito
  espalhados em apps separados, sem visão única do presente nem do futuro
  da sua vida financeira.
- **Solução:** um app pessoal que centraliza contas, cartões, faturas,
  recorrências, parcelamentos, orçamentos e metas, com três pontos de
  entrada de lançamentos (chat IA, importação de extratos, manual).
- **Público:** uma única pessoa gerenciando suas próprias finanças
  (mononusuário por instância — não é multi-tenant corporativo).
- **Princípios de produto (nesta ordem):**
  1. **Confiabilidade dos números > estética.** Um saldo errado é pior
     que uma tela feia.
  2. **pt-BR puro** em toda a UI.
  3. **Tema único escuro** ("vidro fosco"). Não introduzir modo claro.
  4. **Mobile-first**, responsivo.
  5. **Atomicidade** em operações com múltiplas escritas relacionadas.

---

## 2. Escopo funcional

| Módulo | Resumo |
| --- | --- |
| Auth | Email/senha + Google OAuth. Usuário único por instância. |
| Dashboard | Saldos por conta, totais do mês, próximas faturas, próximas recorrências, previsão de fluxo. |
| Contas | CRUD de contas (`checking`, `savings`, `cash`, `credit_card`, `investment`). Cartões guardam `closing_day`, `due_day`, `limit_amount`. |
| Lançamentos | CRUD de `transactions`. Três pontos de entrada: chat, importação, manual. |
| Recorrências | Molde + materialização automática quando a data chega. |
| Parcelamentos | Compras parceladas em sistema paralelo (`installment_purchases` + `installment_items`). |
| Faturas de cartão | Geradas automaticamente por trigger ao inserir/editar transação em conta `credit_card`. |
| Categorias | Hierarquia simples + ícone (texto curto OU imagem base64). |
| Orçamentos | Limite por categoria por período. |
| Metas | Valor-alvo + valor atual + data-alvo. |
| Relatórios | Despesa/receita por categoria, por conta, por período. |
| Forecast | Projeção de saldo diário N dias à frente (RPC `forecast_cashflow`). |
| Chat IA | Persistente (`threads`/`messages`), com tools que registram lançamentos. |
| Detecção de duplicidade | Compartilhada entre os 3 canais (Levenshtein + janela ±1 dia). |
| Página `/trust` | Texto público de segurança/privacidade. |

---

## 3. Stack técnica

- **Framework:** TanStack Start v1 (React 19, SSR, Server Functions).
- **Build:** Vite 7, TypeScript estrito (`strict: true`, sem `any`).
- **Roteamento:** TanStack Router (file-based em `src/routes/`).
- **Estado servidor:** TanStack Query (sempre via `useSuspenseQuery` +
  `ensureQueryData` no loader; nunca `useEffect + fetch`).
- **UI:** Tailwind CSS v4 (config via `@import` em `src/styles.css`,
  sem `tailwind.config.js`), shadcn/ui + Radix Primitives, lucide-react,
  Recharts.
- **Validação:** Zod em TODA Server Function.
- **PDF:** `pdfjs-dist` (parser de fatura).
- **Runtime de servidor sugerido:** Cloudflare Workers (edge). Alternativas:
  Vercel Edge/Node, Netlify Functions, Node tradicional. Evite libs
  Node-only (sharp, canvas, child_process).
- **Banco/Auth:** Supabase externo (ver §4).

---

## 4. Supabase externo (sem Lovable Cloud)

### 4.1 Criar o projeto
1. Conta em [supabase.com](https://supabase.com) → New Project.
2. Em **Authentication → Providers:** habilitar Email; habilitar Google
   (criar OAuth client no Google Cloud Console, copiar Client ID/Secret).
3. Em **Authentication → URL Configuration:** definir Site URL e Redirect
   URLs (`http://localhost:3000`, domínio de produção).
4. Em **Project Settings → API:** copiar `URL`, `anon/publishable key` e
   `service_role key`.

### 4.2 Variáveis de ambiente
Arquivo `.env` (não commitar):

| Variável | Visibilidade | Uso |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | client | Cliente browser |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | client | Cliente browser |
| `SUPABASE_URL` | server | Server functions (publishable + admin) |
| `SUPABASE_PUBLISHABLE_KEY` | server | Cliente server publishable + middleware auth |
| `SUPABASE_SERVICE_ROLE_KEY` | server **somente** | Cliente admin (RPC privilegiada, Auth Admin) |

> **NUNCA** prefixar a service role com `VITE_`. **NUNCA** importar o
> cliente admin em código que roda no browser.

### 4.3 Três clientes
- `src/integrations/supabase/client.ts` — browser, publishable, persiste
  sessão em `localStorage`.
- `src/integrations/supabase/client.server.ts` — service role, RLS
  bypassada. Importar **dentro de handlers** com `await import(...)`.
- `src/integrations/supabase/auth-middleware.ts` — middleware
  `requireSupabaseAuth` para `createServerFn` que precisa do usuário logado.

### 4.4 Migrations
Usar Supabase CLI (`supabase init`, `supabase link`, `supabase db push`).
Arquivos em `supabase/migrations/*.sql` numerados por timestamp. Ordem
importa — uma migration posterior pode alterar GRANTs/colunas de uma
tabela criada antes.

---

## 5. Modelagem de dados (DDL resumida)

> Toda tabela com dados do usuário segue obrigatoriamente:
> ```sql
> user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
> ```
> RLS habilitada, policy `auth.uid() = user_id`, e GRANTs explícitos
> (PostgREST não concede por padrão no schema `public`):
> ```sql
> GRANT SELECT, INSERT, UPDATE, DELETE ON public.<t> TO authenticated;
> GRANT ALL ON public.<t> TO service_role;
> ```

### 5.1 Tabelas
- **profiles** (`id` = `auth.users.id`, `display_name`, `avatar_url`).
- **accounts** (`type` ∈ {checking, savings, cash, credit_card,
  investment}, `name`, `institution`, `initial_balance`, `closing_day`,
  `due_day`, `limit_amount`, `currency`, `archived`).
- **categories** (`name`, `kind` ∈ {income, expense}, `icon` TEXT — aceita
  emoji curto OU base64 de imagem; **sem limite de caracteres baixo**).
- **transactions** (`type` ∈ {income, expense}, `amount numeric(14,2) > 0`,
  `description`, `category_id`, `account_id`, `occurred_at date`,
  `source` ∈ {manual, chat, import, recurrence}, `recurrence_id`,
  `invoice_id` — preenchido por trigger).
- **recurrences** (`type`, `amount`, `description`, `category_id`,
  `account_id`, `frequency` ∈ {weekly, monthly, yearly}, `next_run_at`,
  `active`).
- **installment_purchases** (`account_id`, `description`, `total_amount`,
  `installments_count`, `first_due_date`, `category_id`).
- **installment_items** (`purchase_id`, `seq`, `due_date`, `amount`,
  `status` ∈ {pending, paid}).
- **credit_card_invoices** (`account_id`, `reference_month date`,
  `closing_date`, `due_date`, `total_amount`, `status` ∈ {open, closed,
  paid}, UNIQUE `(account_id, reference_month)`).
- **budgets** (`category_id`, `period_start`, `period_end`, `limit_amount`).
- **goals** (`name`, `target_amount`, `current_amount`, `target_date`).
- **threads** (`title`, `last_message_at`).
- **messages** (`thread_id`, `role` ∈ {user, assistant, tool}, `content`,
  `tool_calls jsonb`).

### 5.2 Funções e triggers obrigatórios
- `handle_new_user()` (trigger em `auth.users`) — cria `profiles`.
- `touch_updated_at()` — trigger genérico para `updated_at`.
- `assign_transaction_to_invoice()` — BEFORE INSERT/UPDATE em
  `transactions`; calcula `invoice_id` quando a conta for cartão.
- `recompute_invoice_total(_invoice_id)` — `SUM(CASE WHEN type='expense'
  THEN amount ELSE -amount END)` (estornos abatem).
- `trg_recompute_invoice` — chama o recálculo em INSERT/UPDATE/DELETE,
  inclusive na fatura ANTIGA quando `invoice_id` muda.
- `materialize_due_recurrences(_user_id)` — materializa recorrências
  vencidas em `transactions`, avança `next_run_at`. `SECURITY DEFINER` +
  `REVOKE EXECUTE ... FROM PUBLIC` + `GRANT EXECUTE ... TO service_role`
  (reaplicar após cada `CREATE OR REPLACE`).
- `forecast_cashflow(_user_id, _days)` — ver §6.8.
- `account_balances(_user_id)` — ver §6.3.

---

## 6. Modelo financeiro — fórmulas, regime de caixa vs. competência e cálculos

Esta é a seção mais sensível do PRD. Cálculo errado aqui = produto
quebrado. Leia inteira antes de implementar.

### 6.1 Tipos de conta e o que cada uma representa

| `type` | Representa | Tem "saldo"? |
| --- | --- | --- |
| `checking`, `savings`, `cash`, `investment` | Dinheiro real disponível | Sim — regime de caixa puro |
| `credit_card` | Limite + faturas em aberto/fechadas | **Não** no sentido tradicional — ver §6.4 |

### 6.2 Lançamentos — convenções de sinal
- `amount` é **sempre positivo**. O sentido vem de `type`.
- Fórmula canônica do delta de uma transação:
  ```text
  signed = (type == 'income') ? +amount : -amount
  ```
- **Estornos/reembolsos** em cartão são lançados como `income` na mesma
  conta de cartão (não como `expense` negativa). Isso entra no recálculo
  de fatura como abatimento — ver §6.4.

### 6.3 Saldo de conta (regime de caixa)
RPC `account_balances(_user_id)` retorna saldo por conta:
```sql
SELECT account_id,
       SUM(CASE WHEN type='income'  THEN amount
                WHEN type='expense' THEN -amount END) AS balance
FROM transactions
WHERE user_id = _user_id AND account_id IS NOT NULL
GROUP BY account_id;
```
Notas:
- Considera **todas** as datas (passadas e futuras de `occurred_at`).
  Para "saldo disponível hoje" filtre `occurred_at <= CURRENT_DATE`;
  para "saldo projetado" não filtre.
- Cartão de crédito também aparece nesse SUM, mas o número resultante
  **não é "dinheiro disponível"** — é o saldo da fatura em curso. A UI
  deve tratá-lo como tal (ex.: mostrar "fatura aberta: R$X" em vez de
  "saldo: R$X").

### 6.4 Faturas de cartão (regime de competência)
Cada `transaction` em conta `credit_card` é vinculada a UMA fatura via
trigger `assign_transaction_to_invoice` (BEFORE INSERT/UPDATE).

**Regra de competência (qual fatura recebe a despesa):**
```text
last_day_of_month(d)         = último dia real do mês de d
closing_day_clamped(month)   = LEAST(account.closing_day, last_day_of_month(month))
closing_this_month           = make_date(year(d), month(d), closing_day_clamped(month(d)))

se occurred_at <= closing_this_month:
    closing_date = closing_this_month
senão:
    closing_date = closing_this_month + 1 mês  (com mesmo clamp)

reference_month = date_trunc('month', closing_date)
```

**Vencimento da fatura:**
```text
due_base       = closing_date + 1 mês
due_day_clamped = LEAST(account.due_day, last_day_of_month(due_base))
due_date       = make_date(year(due_base), month(due_base), due_day_clamped)
```

> ⚠️ **Bug histórico a NÃO repetir:** versões antigas usavam
> `LEAST(due_day, 28)`, travando vencimento em 28 em meses de 30/31 dias.
> Use sempre o último dia REAL do mês.

Chave única: `(account_id, reference_month)`.

**Total da fatura** (`recompute_invoice_total`):
```sql
SUM(CASE WHEN type='expense' THEN amount ELSE -amount END)
```
ou seja: estornos lançados como `income` **abatem** o total.

> ⚠️ **Bug histórico a NÃO repetir:** somar só `expense` ignora estornos
> e infla a fatura. Use a expressão acima.

Trigger `trg_recompute_invoice`:
- INSERT/UPDATE: recalcula a fatura nova.
- DELETE: recalcula a fatura antiga.
- UPDATE de `invoice_id`: recalcula **ambas** (antiga e nova).

### 6.5 Pagamento de fatura — a ponte competência → caixa
Modelagem:
1. O usuário cria um lançamento `expense` na **conta corrente** (caixa)
   com o valor pago.
2. A fatura é marcada `status='paid'` (competência).

**Não criar** um lançamento `income` no cartão para "zerar" a fatura.
Isso distorceria o histórico (somaria com os estornos reais) e duplicaria
contabilidade.

> A despesa "real" para orçamento/relatório é a transação original do
> cartão (na data da compra). O pagamento da fatura é só movimentação
> entre caixa e dívida — não conta como nova despesa.

### 6.6 Recorrências
- A tabela `recurrences` é só o "molde" — **não impacta saldo nem fatura
  por si só.**
- RPC `materialize_due_recurrences(_user_id)`:
  - Para cada recorrência ativa com `next_run_at <= CURRENT_DATE`,
    insere uma linha em `transactions` com `source='recurrence'` e
    `recurrence_id` preenchido.
  - Avança `next_run_at` somando 7 dias / 1 mês / 1 ano conforme
    `frequency`. Loop até `next_run_at > CURRENT_DATE` (idempotente para
    múltiplas execuções no mesmo dia).
- Materialização deve ser chamada:
  - No login (server fn no `_authenticated` layout); e/ou
  - Por um cron externo apontando para endpoint `/api/public/cron/*`
    com header secreto.
- Quando materializadas, contam normalmente em `account_balances` e
  faturas (se a conta for cartão).

### 6.7 Parcelamentos — sistema PARALELO
Hoje, `installment_purchases` + `installment_items` **não geram linhas em
`transactions`**. Consequências:
- **Não aparecem** em `account_balances`.
- **Não entram** automaticamente em `credit_card_invoices` via trigger.
- Para o usuário ver "quanto a compra parcelada X vai pesar no mês M", a
  UI consulta `installment_items` diretamente e agrega por
  `due_date` no mês.

**Fórmula da parcela** (centavos exatos):
```text
n              = installments_count
base           = round(total_amount / n, 2)
parcelas[0..n-2] = base
parcelas[n-1]    = total_amount − sum(parcelas[0..n-2])
```
Isso garante que `sum(parcelas) == total_amount` mesmo quando
`total_amount / n` não fecha em centavos (ex.: 100,00 / 3).

Conversão de parcelamento em despesas reais é operação separada
(opcional) — não acontece automaticamente.

> ⚠️ **Decisão de modelagem:** se você decidir unificar parcelamentos com
> `transactions` (cada item vira uma transação), isso muda saldo,
> relatórios e faturas. Trate como mudança grande e planeje antes.

### 6.8 Previsão de fluxo de caixa
RPC `forecast_cashflow(_user_id, _days)`:
```text
start_balance = SUM(signed) de transactions onde occurred_at <= hoje

para cada dia D em [hoje, hoje + _days]:
    delta_D =
        − total_amount de credit_card_invoices com due_date = D e status <> 'paid'
        + signed de recurrences com next_run_at = D

    projected_balance[D] = start_balance + SUM(delta de hoje até D)
```
- A fatura SAI do caixa no `due_date` (modela o débito automático).
- Recorrências previstas entram com seu sinal.
- **Limitação atual a documentar:** parcelamentos **não** entram na
  previsão (ver §6.7).

### 6.9 Relatórios e categorias
- **Despesa por categoria em [início, fim]:**
  ```sql
  SELECT category_id, SUM(amount)
  FROM transactions
  WHERE user_id = $1 AND type='expense'
    AND occurred_at BETWEEN $2 AND $3
  GROUP BY category_id;
  ```
- **Orçamento:** `consumo_categoria / budgets.limit_amount` no período.
- **Metas:** `progresso = current_amount / target_amount`. Aporte para
  meta PODE (decisão do produto) ser refletido como `expense` em conta
  caixa + `income` virtual na meta — documente a escolha; o estado atual
  trata meta como totalizador independente.

### 6.10 Quadro-resumo: caixa vs. competência

| Evento | Regime | Onde é registrado |
| --- | --- | --- |
| Saldo de conta corrente | Caixa | `account_balances` (soma signed) |
| Pagamento por PIX/boleto/débito | Caixa | `transactions` na conta corrente |
| Compra no cartão | Competência | `transactions` em conta `credit_card`, vinculada à fatura via trigger |
| Estorno no cartão | Competência | `transactions` como `income` na mesma conta de cartão |
| Pagamento da fatura | Caixa (saída) + competência (fatura `paid`) | `transactions` na corrente + UPDATE em `credit_card_invoices` |
| Recorrência prevista | Competência futura | `recurrences` (não impacta saldo) |
| Recorrência materializada | Caixa (quando `occurred_at <= hoje`) | `transactions` com `source='recurrence'` |
| Parcelamento | Competência paralela | `installment_items` (não entra em caixa) |
| Previsão de fluxo | Misto | `forecast_cashflow` (caixa atual + competência futura) |

### 6.11 Casos de borda e armadilhas numéricas

- **Datas (CRÍTICO):** sempre parsear `YYYY-MM-DD` manualmente
  (`formatDate` faz `split('-')` + `new Date(y, m-1, d)`). **Nunca**
  `new Date(stringISO).getMonth()` — isso aplica fuso UTC→local e o dia
  pula para o anterior em fusos negativos (Brasil). Bug clássico.
- **Moeda:** sempre `formatBRL` (`Intl.NumberFormat('pt-BR', { style:
  'currency', currency: 'BRL' })`). Banco: `numeric(14,2)`. **Nunca
  `float`** (erro acumulado).
- **Arredondamento de parcela:** JS usa round-half-to-even em alguns
  contextos. Use `Math.round(x * 100) / 100` e ajuste a última parcela
  como em §6.7.
- **Meses de 28/29/30/31 dias:** sempre `LEAST(dia_configurado,
  ultimo_dia_real(mes))`.
- **Fuso horário:** servidor em UTC; `occurred_at` é `date` (sem hora),
  evitando drift no banco. Cliente deve usar parser manual.
- **Idempotência da materialização:** o loop `WHILE next_run_at <=
  CURRENT_DATE` garante que rodar duas vezes no mesmo dia não duplica.
- **Detecção de duplicidade compartilhada** entre chat, importação e
  manual (em `src/lib/duplicates.server.ts`):
  ```text
  duplicada se:
    mesmo user_id
    E mesmo account_id
    E mesmo type
    E mesmo amount
    E |occurred_at - candidate.occurred_at| <= 1 dia
    E similaridade_levenshtein(normalize(desc_a), normalize(desc_b)) >= 0.7
  normalize = NFD + remover diacríticos + lowercase + colapsar espaços
  ```

---

## 7. Arquitetura de pastas e convenções

```
src/
  routes/                       file-based routing (dot-separated)
    __root.tsx                  shell SSR
    index.tsx                   landing pública
    auth.tsx                    login
    _authenticated/             subtree protegida (ssr:false, gate único)
      route.tsx                 gate (não editar — gerado/integrado)
      dashboard.tsx
      accounts.tsx
      transactions.tsx
      invoices.tsx
      installments.tsx
      recurrences.tsx
      categories.tsx
      budgets.tsx
      goals.tsx
      reports.tsx
      import.tsx
      chat.tsx
      settings.tsx
    trust.tsx                   página pública
    api/
      chat.ts                   endpoint streaming do assistente
      public/
        cron/...                webhooks/cron com header secreto
  lib/
    *.functions.ts              Server Functions (createServerFn)
    *.server.ts                 helpers server-only (admin client etc.)
    duplicates.server.ts        check de duplicidade compartilhado
    format.ts                   formatBRL, formatDate
  components/
    ui/                         shadcn/ui
    transaction-extras.tsx      seletor Único/Recorrente/Parcelado
    filter-pill.tsx
  integrations/
    supabase/
      client.ts                 browser
      client.server.ts          admin (service role)
      auth-middleware.ts        requireSupabaseAuth
      auth-attacher.ts          attachSupabaseAuth (functionMiddleware)
      types.ts                  gerado pelo `supabase gen types`
  styles.css                    Tailwind v4 + tokens
supabase/
  migrations/*.sql              schema completo
```

### Convenções (não negociáveis)
- pt-BR em toda UI.
- Confirmações destrutivas via `Dialog`/`AlertDialog`. **Nunca** `confirm()`.
- Reuso de funções existentes (`createRecurrence`,
  `createInstallmentPurchase`, `formatBRL`, `formatDate`).
- Toda Server Function: Zod no input + `requireSupabaseAuth` quando há
  dados do usuário; `userId` vem do middleware, nunca do body.
- Toda tabela com dados do usuário: RLS ativa + GRANT explícito +
  `ON DELETE CASCADE` a partir de `auth.users`.
- Funções `SECURITY DEFINER` com `_user_id` parâmetro: ou validam
  `auth.uid() = _user_id` internamente, ou têm EXECUTE só para
  `service_role` (reaplicar REVOKE depois de cada `CREATE OR REPLACE`).
- Operações com múltiplas escritas relacionadas: priorizar RPC única no
  banco em vez de várias chamadas do cliente (atomicidade).
- Delete de perfil de usuário: limpar TODAS as tabelas do usuário (a FK
  cascade ajuda, mas confira a lista).

---

## 8. Endpoint de chat IA `/api/chat`

POST streaming (SSE ou chunked). Provedor de IA é decisão livre — o
contrato é o que importa.

### Contrato
```ts
POST /api/chat
{
  thread_id?: string,
  user_message: string
}
→ stream de eventos:
  { type: 'token', value: string }
  { type: 'tool_call', name: string, args: unknown }
  { type: 'tool_result', name: string, result: unknown }
  { type: 'done', message_id: string, thread_id: string }
```

### Tools (todas com schema Zod)
- `record_transaction(type, amount, description, account_hint,
  category_hint, occurred_at)` — usa `findPossibleDuplicates` antes de
  inserir; se houver match >= limiar, pergunta antes.
- `list_recent(limit)`.
- `get_summary(period)` — totais por categoria/conta.
- `create_account(...)`, `create_goal(...)`, `create_category(...)`.

### Trocando o provedor de IA
- Padrão neutro: Vercel AI SDK (`ai`, `@ai-sdk/openai`,
  `@ai-sdk/anthropic`, `@ai-sdk/google`).
- Substituir o adapter no handler de `/api/chat` é a única mudança.
- Persistência (`threads`/`messages`) é independente do provedor.

### Persistência
- A cada turno: append em `messages` com `role` e `tool_calls`.
- `threads.last_message_at = now()` no final.

---

## 9. Importação de extratos `/import`

Fluxo obrigatório (UI):
1. Usuário escolhe **Tipo** (Débito/Conta corrente OU Cartão).
2. Usuário escolhe **Conta** (do tipo selecionado). Sem conta, não
   prossegue — é o que permite vincular à fatura certa.
3. Só então faz upload do arquivo.

Parsers:
- **CSV:** detecção de delimitador (`,` `;` `\t`), header com sinônimos
  pt-BR ("data", "descrição", "valor", "histórico"...).
- **OFX:** parser próprio (regex sobre tags `<STMTTRN>`).
- **PDF (fatura):** `pdfjs-dist` extrai texto + heurística de linhas.

Para cada linha extraída:
- Roda `findPossibleDuplicates` (§6.11).
- Exibe badge "possível duplicata" + edição inline.
- Usuário pode marcar cada linha como Única / Recorrente / Parcelada
  antes de confirmar a importação em lote.

---

## 10. Bugs históricos a evitar (resumo)

| Bug | Como evitar |
| --- | --- |
| Limite Zod de 8 chars em `icon` quebra ícone base64 | Não limitar `icon` baixo; aceitar texto longo |
| `LEAST(due_day, 28)` trava vencimento em 28 | Usar `last_day_of_month(due_month)` |
| `recompute_invoice_total` ignora estornos | `SUM(CASE WHEN type='expense' THEN amount ELSE -amount END)` |
| Delete de perfil deixa órfãos em budgets/invoices/installments | FK com `ON DELETE CASCADE` + rotina de limpeza completa |
| `CREATE OR REPLACE FUNCTION` reconcede EXECUTE a PUBLIC | Reaplicar REVOKE + GRANT após cada recriação |
| `new Date('2025-01-15').getMonth()` pula dia em fuso BR | Parser manual de `YYYY-MM-DD` |
| `float` para dinheiro | `numeric(14,2)` no banco; centavos como inteiro nunca |

---

## 11. Mix HTML estático + React

Duas abordagens válidas — comece pela (A).

### (A) Tudo dentro do TanStack Start (recomendado)
- Páginas públicas (`/`, `/trust`, `/precos`, `/blog/...`) são rotas
  comuns do TanStack Router com SSR habilitado e `head()` definindo
  `<title>`, meta description, OG tags por rota.
- App protegido fica em `_authenticated/`.
- Vantagem: um único deploy, uma única base de auth, SEO funciona.

### (B) Site institucional separado
- Site marketing em Astro / HTML puro / 11ty hospedado em
  `www.dominio.com` (Cloudflare Pages, Netlify, etc.).
- App React em `app.dominio.com` (TanStack Start no Worker).
- Sessão compartilhada: cookie no domínio raiz `.dominio.com` (Supabase
  suporta com configuração de cookie options).
- Vantagem: build do marketing site independente do app, deploy mais
  rápido.

---

## 12. Roadmap sugerido (para o agente replicador)

1. Bootstrap: `npm create @tanstack/start`, configurar Tailwind v4 +
   shadcn/ui, tema escuro vidro fosco.
2. Supabase: criar projeto, rodar migrations (auth + tabelas + RLS +
   GRANTs + triggers + RPCs). Configurar Email + Google.
3. Auth UI: `/auth` com email/Google. Layout `_authenticated/` com gate.
4. CRUDs base: contas → categorias → lançamentos manuais →
   recorrências → parcelamentos.
5. Faturas de cartão: trigger `assign_transaction_to_invoice` +
   `recompute_invoice_total` + tela `/invoices`.
6. Dashboard + relatórios + forecast.
7. Importação de extratos (CSV → OFX → PDF) com duplicidade.
8. Chat IA `/api/chat` com tools + persistência.
9. Página `/trust` + deploy (Cloudflare Workers ou Vercel) +
   configuração de domínio.

---

## 13. Checklist final de envs

| Variável | Onde |
| --- | --- |
| `VITE_SUPABASE_URL` | `.env` + plataforma de deploy (client) |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `.env` + plataforma de deploy (client) |
| `SUPABASE_URL` | secrets do servidor |
| `SUPABASE_PUBLISHABLE_KEY` | secrets do servidor |
| `SUPABASE_SERVICE_ROLE_KEY` | secrets do servidor (NUNCA client) |
| `AI_PROVIDER_API_KEY` | secrets do servidor (OpenAI/Anthropic/Google) |
| `CRON_SECRET` | header bearer para `/api/public/cron/*` |

---

## 14. Critérios de aceitação

### Funcional (testes manuais mínimos)
- Criar conta corrente + lançar receita + despesa → saldo bate.
- Criar cartão com `closing_day=20`, `due_day=10` → lançar compra em 25
  do mês → cai na fatura do mês seguinte com `due_date=10 do mês +2`.
- Lançar estorno como `income` na mesma fatura → total reduz.
- Pagar fatura → fatura vira `paid`, conta corrente reduz, despesa não
  duplica em relatório.
- Criar recorrência mensal com `next_run_at = ontem` → ao chamar
  `materialize_due_recurrences`, surge uma `transaction` e `next_run_at`
  avança 1 mês.
- Criar parcelamento de R$100 em 3x → parcelas 33,33 / 33,33 / 33,34.
- Importar CSV com 1 linha já cadastrada → badge de duplicata aparece.
- Chat: "gastei 50 reais no mercado" → registra como `expense`,
  categoria sugerida.

### Segurança
- RLS ativa em TODAS as tabelas `public.*` do usuário.
- Nenhuma policy `TO anon` em tabelas de usuário.
- `SUPABASE_SERVICE_ROLE_KEY` ausente do bundle do cliente
  (`grep -r service_role dist/` deve não achar).
- RPCs `SECURITY DEFINER` com `_user_id` têm EXECUTE só para
  `service_role` (ou validam `auth.uid()` internamente).
- Endpoints `/api/public/*` validam header secreto antes de qualquer
  escrita.
- Delete de usuário (`auth.users` DELETE) remove TODOS os dados
  relacionados via cascade.

---

> Fim do PRD. Para qualquer divergência entre este documento e o código
> de referência, **o código de referência vence** — atualize o PRD na
> mesma PR.
