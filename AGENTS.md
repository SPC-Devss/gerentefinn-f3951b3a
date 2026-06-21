# AGENTS.md — Instruções para agentes de IA (Lovable) neste repositório

> Este arquivo é lido automaticamente pelo agente do Lovable em toda
> conversa, independentemente do tamanho do histórico — ao contrário do
> Project Knowledge, que pode deixar de ser seguido com 100% de
> consistência em conversas muito longas. Trate este arquivo como a fonte
> mais confiável de contexto sobre o projeto.

## 1. O que é este projeto

- Nome interno deste projeto no Lovable: **Conversa Financeira**.
- Nome do produto, como aparece para o usuário final (cabeçalho do app,
  mensagens do assistente de IA dentro do app, etc.): **Finn**. Nunca use
  "Conversa Financeira" como nome do produto dentro da interface — esse
  nome é só o rótulo do projeto no Lovable, não deve aparecer para o
  usuário.
- Propósito: Finn é um gerente financeiro pessoal. O objetivo central é
  centralizar, num só lugar, o controle de todas as contas bancárias e
  cartões de crédito que o usuário já possui espalhados em apps separados
  de banco — dando um panorama único da vida financeira para ele se
  planejar no presente e no futuro, sem precisar abrir um app por
  banco/cartão.
- Usuário-alvo: uma única pessoa gerenciando suas próprias finanças
  pessoais (não é uma ferramenta multiusuário nem corporativa). Prioridade
  máxima: confiabilidade dos números mostrados (saldo, faturas, parcelas).
  Em um app financeiro, um cálculo errado é pior do que uma tela feia.

## 2. Stack técnica (não trocar sem necessidade clara)

- Framework: TanStack Start (React 19 + SSR), Vite, TypeScript estrito.
- Roteamento: TanStack Router, baseado em arquivos (`src/routes`).
- Dados/estado: TanStack Query + Server Functions.
- UI: Tailwind CSS + shadcn/ui + Radix, ícones lucide-react, gráficos
  Recharts.
- Backend: Lovable Cloud (Postgres + Auth) via cliente Supabase JS.
- IA: Lovable AI Gateway, usado no chat do app (`/api/chat`).
- Runtime de servidor: Cloudflare Workers (edge).
- Validação: Zod em toda Server Function.
- Leitura de extrato: pdfjs-dist para PDF; parsing nativo para CSV/OFX.

## 3. Arquitetura de dados — leia isto antes de mexer em lançamentos

Existem hoje TRÊS sistemas relacionados, mas que não são a mesma coisa:

1. `transactions` — lançamentos avulsos (a maioria dos registros do app).
2. `recurrences` — lançamentos que se repetem. A função
   `materialize_due_recurrences` (RPC, SECURITY DEFINER, chamável só via
   service_role) materializa as ocorrências futuras como novas linhas em
   `transactions`, vinculadas pela coluna `recurrence_id`.
3. `installment_purchases` + `installment_items` — compras parceladas.
   Este é um sistema PARALELO: hoje não existe nenhuma linha
   correspondente em `transactions` para uma compra parcelada.

Antes de qualquer mudança que pareça precisar "unificar" esses três
sistemas, confirme o plano com o usuário — é uma decisão de modelagem de
dados, não um detalhe de implementação.

Outras tabelas importantes: `accounts` (inclui contas correntes e cartões
de crédito no mesmo lugar, diferenciados pela coluna `type`: `checking`,
`savings`, `cash`, `credit_card` ou `investment`), `credit_card_invoices`
(faturas, calculadas automaticamente por trigger a partir de `closing_day`
e `due_day` da conta), `categories`, `budgets`, `goals`, `threads` e
`messages` (histórico do chat).

## 4. Os três pontos de entrada de lançamentos

O usuário registra um lançamento de três formas diferentes, e as três
precisam permanecer coerentes entre si:

1. Pelo agente de IA no chat (`/api/chat`, tool `record_transaction`).
2. Pela importação de extratos (`/import` — CSV, OFX ou PDF de fatura).
3. Manualmente na tela de Lançamentos (`/transactions`).

Sempre que alterar a lógica de criação de lançamento em um desses três
lugares, avalie se a mudança também precisa ser replicada (ou pelo menos
considerada) nos outros dois, para eles não divergirem em comportamento.
Qualquer checagem de duplicidade compartilhada entre os três canais deve
ser mantida e respeitada por qualquer novo código de criação de
lançamento — não criar um quarto caminho de inserção sem passar por ela.

## 5. Convenções obrigatórias deste projeto

- Interface 100% em português do Brasil (pt-BR), sem exceções no texto
  voltado ao usuário.
- Tema único, escuro ("vidro fosco" / estilo ZimaOS, definido em
  `src/styles.css`). Não introduzir modo claro sem pedido explícito.
- Confirmações de ações importantes ou destrutivas sempre usam os
  componentes `Dialog`/`AlertDialog` já existentes no projeto. Nunca usar
  `confirm()`, `alert()` ou `prompt()` nativos do navegador.
- Reaproveitar funções já existentes (`createRecurrence`,
  `createInstallmentPurchase`, `formatBRL`, `formatDate` etc.) em vez de
  reimplementar lógica equivalente em outro arquivo.
- Moeda sempre formatada via `formatBRL` (`lib/format.ts`). Data sempre
  formatada via `formatDate`, que faz parsing manual da string
  "YYYY-MM-DD" — não usar `new Date(stringISO)` seguido de
  `.getFullYear()/.getMonth()`, porque isso introduz bugs de fuso horário
  entre UTC e horário local.
- Toda Server Function que recebe dados do cliente deve validar com Zod e
  derivar o `userId` do middleware de autenticação já existente — nunca
  confiar em um `user_id` vindo do corpo da requisição.
- Toda tabela nova com dados do usuário precisa ter RLS habilitado com
  policy `auth.uid() = user_id`, e declarar
  `user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE`
  (ver seção 7 sobre por que isso importa).
- Funções `SECURITY DEFINER` que recebem um `_user_id` como parâmetro
  devem (a) verificar internamente que `auth.uid() = _user_id`, ou (b) ter
  `EXECUTE` revogado de `anon`/`authenticated`/`PUBLIC` e concedido só a
  `service_role`. Ao recriar uma função assim com
  `CREATE OR REPLACE FUNCTION`, reaplicar o `REVOKE` depois — o Postgres
  reconcede `EXECUTE` a `PUBLIC` automaticamente toda vez que a função é
  recriada.
- Operações com mais de uma escrita relacionada no banco (ex.: apagar
  parcelas não pagas e recriar outras, ou criar uma transação e vinculá-la
  a uma recorrência nova) devem priorizar atomicidade — preferir uma
  função/RPC única no banco a múltiplas chamadas sequenciais do cliente.
- Ao excluir a conta do usuário (delete de perfil), garantir que TODAS as
  tabelas com dados do usuário sejam limpas, não só uma lista parcial —
  isso já causou um bug real neste projeto (ver seção 7).

## 6. Antes de implementar mudanças estruturais

Para qualquer mudança que:
- crie ou altere tabelas/colunas,
- altere a relação entre tabelas já existentes, ou
- toque mais de uma tela/fluxo ao mesmo tempo,

apresente o plano (o que muda no banco e no código) antes de implementar,
e espere confirmação do usuário.

## 7. Bugs já identificados e corrigidos — não reintroduzir

Estes problemas já foram encontrados em auditoria e corrigidos (ou estão
em correção). Ao mexer em código relacionado, preste atenção para não
reintroduzir o mesmo padrão:

- O campo `icon` de `categories` já teve um limite de 8 caracteres no
  schema Zod que impedia salvar ícones customizados (imagens em base64).
  Qualquer campo que aceite upload de imagem como texto precisa de um
  limite de tamanho compatível com o que a interface realmente envia.
- O cálculo de vencimento de fatura de cartão
  (`assign_transaction_to_invoice`) já teve um bug em que o dia de
  vencimento ficava travado em 28 (`LEAST(acc.due_day, 28)`) em vez de
  respeitar o último dia real do mês, como já era feito corretamente para
  o fechamento. Qualquer cálculo de data baseado em "dia do mês"
  configurável pelo usuário deve lidar com meses de tamanhos diferentes.
- O recálculo de total de fatura (`recompute_invoice_total`) já ignorou
  estornos/reembolsos lançados como `income` na mesma fatura, somando só
  `type = 'expense'`. Qualquer lógica de soma de valores em fatura/extrato
  precisa considerar estornos.
- A exclusão de conta de usuário (delete de perfil) já deixou para trás
  dados órfãos em `budgets`, `credit_card_invoices`,
  `installment_purchases` e `installment_items`, porque a lista de
  limpeza manual estava incompleta e essas tabelas não tinham
  `ON DELETE CASCADE` a partir de `auth.users`. Qualquer nova tabela com
  dados do usuário precisa entrar tanto na rotina de limpeza quanto ter a
  FK com cascade.

## 8. Mapa rápido do código

- `src/lib/*.functions.ts` — toda a lógica de negócio do servidor (Server
  Functions), uma por domínio (transactions, accounts, recurrences,
  installments, invoices, goals, budgets, reports, forecast, import,
  threads, categories, profile, dashboard).
- `src/routes/*.tsx` — uma tela por arquivo, roteamento por nome de
  arquivo (TanStack Router).
- `src/routes/api/chat.ts` — endpoint do assistente de IA, com as tools
  disponíveis para o chat (record_transaction, list_recent, get_summary,
  create_account, create_goal, etc.).
- `supabase/migrations/*.sql` — schema do banco, RLS, triggers e funções
  RPC. As migrations rodam em ordem — o estado final do banco depende de
  TODAS elas terem sido aplicadas, então nunca presuma o comportamento de
  uma tabela olhando só a migration onde ela foi criada; confira se uma
  migration posterior alterou grants, colunas ou triggers.
- `src/integrations/supabase/` — clientes Supabase (`client.ts` = público,
  `client.server.ts` = admin/service_role, nunca importar o admin em
  código que roda no navegador) e middleware de autenticação.
