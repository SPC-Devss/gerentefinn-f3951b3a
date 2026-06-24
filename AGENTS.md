# AGENTS.md — Instruções para agentes de IA (Lovable) neste repositório

> Este arquivo é lido automaticamente pelo agente do Lovable em toda
> conversa, independentemente do tamanho do histórico — ao contrário do
> Project Knowledge, que pode deixar de ser seguido com 100% de
> consistência em conversas muito longas. Trate este arquivo como a fonte
> mais confiável de contexto sobre o projeto.

## 1. O que é este projeto

- Nome interno deste projeto no Lovable: **Conversa Financeira**.
- Nome do produto, como aparece para o usuário final (cabeçalho do app, mensagens do assistente de IA dentro do app, etc.): **Finn**. Nunca use "Conversa Financeira" como nome do produto dentro da interface — esse nome é só o rótulo do projeto no Lovable, não deve aparecer para o usuário.
- Propósito: Finn é um gerente financeiro pessoal. O objetivo central é centralizar, num só lugar, o controle de todas as contas bancárias e cartões de crédito que o usuário já possui espalhados em apps separados de banco — dando um panorama único da vida financeira para ele se planejar no presente e no futuro, sem precisar abrir um app por banco/cartão.
- Usuário-alvo: uma única pessoa gerenciando suas próprias finanças pessoais (não é uma ferramenta multiusuário nem corporativa). Prioridade máxima: confiabilidade dos números mostrados (saldo, faturas, parcelas). Em um app financeiro, um cálculo errado é pior do que uma tela feia.

## 2. Stack técnica (não trocar sem necessidade clara)

- Framework: TanStack Start (React 19 + SSR), Vite, TypeScript estrito.
- Roteamento: TanStack Router, baseado em arquivos (`src/routes`).
- Dados/estado: TanStack Query + Server Functions.
- UI: Tailwind CSS + shadcn/ui + Radix, ícones lucide-react, gráficos Recharts.
- Backend: Lovable Cloud (Postgres + Auth) via cliente Supabase JS.
- IA: Lovable AI Gateway, usado no chat do app (`/api/chat`).
- Runtime de servidor: Cloudflare Workers (edge).
- Validação: Zod em toda Server Function.
- Leitura de extrato: pdfjs-dist para PDF; parsing nativo para CSV/OFX.

## 3. Arquitetura de dados e Simetria Bancária

Existem hoje TRÊS sistemas de lançamentos relacionados, mas que não são a mesma coisa:
1. `transactions` — lançamentos avulsos (a maioria dos registros do app).
2. `recurrences` — lançamentos que se repetem. A função `materialize_due_recurrences` (RPC, SECURITY DEFINER, chamável só via service_role) materializa as ocorrências futuras como novas linhas em `transactions`, vinculadas pela coluna `recurrence_id`.
3. `installment_purchases` + `installment_items` — compras parceladas. Este é um sistema PARALELO: hoje não existe nenhuma linha correspondente em `transactions` para uma compra parcelada.

### Estrutura Base de Contas e Cartões (`accounts`)
As contas correntes e cartões de crédito coexistem na tabela `accounts`, diferenciados pela coluna `type` (`checking`, `savings`, `cash`, `credit_card` ou `investment`). O sistema possui uma matriz simétrica de 3 instituições principais que deve ser estritamente respeitada:
- **Instituição Caixa Econômica Federal:** Conta Corrente = `CAIXA` (Ativo) // Cartão de Crédito = `CEF` (Passivo).
- **Instituição Sicredi:** Conta Corrente = `Sicredi` // Cartão de Crédito = `SICREDITO`.
- **Instituição Banco Inter:** Conta Corrente = `Inter` // Cartão de Crédito = `intercard`.

### Vinculação Atômica de Faturas (`paid_invoice_id`)
A tabela `transactions` possui uma coluna física de chave estrangeira chamada `paid_invoice_id`, que aponta diretamente para o ID correspondente da tabela `credit_card_invoices`. O indicador gerencial verde **"Já pago"** dos cards de cartão é calculado dinamicamente somando os lançamentos de entrada que possuem este vínculo populado.

## 4. Os três pontos de entrada de lançamentos

O usuário registra um lançamento de três formas diferentes, e as três precisam permanecer coerentes entre si:
1. Pelo agente de IA no chat (`/api/chat`, tool `record_transaction`).
2. Pela importação de extratos (`/import` — CSV, OFX ou PDF de fatura).
3. Manualmente na tela de Lançamentos (`/transactions`).

Sempre que alterar a lógica de criação de lançamento em um desses três lugares, avalie se a mudança também precisa ser replicada (ou pelo menos considerada) nos outros dois, para eles não divergirem em comportamento. Qualquer checagem de duplicidade compartilhada entre os três canais deve ser mantida e respeitada por qualquer novo código de criação de lançamento — não criar um quarto caminho de inserção sem passar por ela.

## 5. Convenções obrigatórias e Regras de Interface (UI/UX)

### Convenções Gerais
- Interface 100% em português do Brasil (pt-BR), sem exceções no texto voltado ao usuário.
- Tema único, escuro ("vidro fosco" / estilo ZimaOS, definido em `src/styles.css`). Não introduzir modo claro sem pedido explícito.
- Confirmações de ações importantes ou destrutivas sempre usam os componentes `Dialog`/`AlertDialog` já existentes no projeto. Nunca usar `confirm()`, `alert()` ou `prompt()` nativos do navegador.
- Reaproveitar funções já existentes (`createRecurrence`, `createInstallmentPurchase`, `formatBRL`, `formatDate` etc.) em vez de reimplementar lógica equivalente em outro arquivo.
- Moeda sempre formatada via `formatBRL` (`lib/format.ts`). Data sempre formatada via `formatDate`, que faz parsing manual da string "YYYY-MM-DD" — não usar `new Date(stringISO)` seguido de `.getFullYear()/.getMonth()`, porque isso introduz bugs de fuso horário entre UTC e horário local.

### O Modal Unificado de Lançamentos (`/transactions`)
- **Fim dos Sub-Modais:** Elimine qualquer link secundário para configurar recorrências ou parcelamentos (como o antigo "+ Transformar em..."). Todos os seletores de tipo de fluxo devem residir nativamente no corpo do modal principal.
- **Os 4 Tipos Base:** O campo "Tipo" deve expor exatamente 4 opções limpas: `Despesa`, `Receita`, `Transferência` e `Pagamento de Cartão`.
  - **Despesa / Receita:** Exibem inline os botões estilizados `Único`, `Recorrente` e `Parcelado`. Se `Parcelado` for selecionado, exiba os campos numéricos de parcelas no próprio corpo do modal. Se `Recorrente` for selecionado, bloqueie a opção de parcelamento.
  - **Transferência:** Exibe os campos semânticos "Sair da conta..." e "Entrar na conta...". O tipo de fluxo fica permanentemente travado em `Único`.
  - **Pagamento de Cartão:** Exibe o campo "Sair da conta..." (filtrando apenas contas correntes de origem) e "Entrar na conta..." (filtrando apenas cartões de crédito de destino). Abaixo, exibe obrigatoriamente o campo select **"Fatura de Referência"**, buscando em tempo real as faturas abertas ou vencidas do cartão selecionado. Ao salvar, grave o fluxo como uma transferência de duas pernas, mas injete obrigatoriamente o ID da fatura selecionada na coluna física `paid_invoice_id` da tabela `transactions`.

### O Atalho na Tela de Faturas (`/invoices`)
- O botão **"Marcar como paga"** no detalhe de uma fatura não deve ser um interruptor de status cego. Ele deve atuar como um atalho que abre o Modal de Novo Lançamento com o tipo **"Pagamento de Cartão"** pré-selecionado, preenchendo o valor total automaticamente e travando o campo "Fatura de Referência" com o ID da fatura em questão. O usuário precisa apenas apontar a conta corrente de origem do dinheiro para consolidar a partida dobrada.

### Limpeza do Extrato de Transações
- Remova strings redundantes de parcelamento inseridas manualmente nos textos de descrição (ex: remova textos como "(3/3)" ou "Parcela X" do nome).
- Use **Badges Visuais Compactos** ao lado da descrição limpa:
  - Lançamentos com parcelas ativas: Exibir badge com ícone (Ex: `💳 3/3`).
  - Lançamentos com `transfer_id`: Exibir badge direcional de fluxo interno (Ex: `🔁 Para: INTER` ou `🔁 De: CAIXA`).

### Alertas Críticos e Regras do Dashboard (`/dashboard`)
- **Alerta de Cheque Especial (Emergência Técnica):** No mini-painel de Contas Correntes, caso o saldo de qualquer conta fique menor que zero (negativo), o valor deve ser renderizado obrigatoriamente em **vermelho vivo**, em **negrito**, acompanhado de um ícone de alerta (`⚠️`) e utilizando a animação de pulso/piscar nativa do Tailwind (`animate-pulse`) para sinalizar o uso do limite de crédito emergencial.
- **Termômetro de Cartões Eficiente:** O widget lateral de cartões não deve fazer sumários históricos cegos de toda a tabela. Ele deve exibir ao lado de cada cartão estritamente o valor da **"Fatura Atual"** (soma de compras à vista do ciclo + parcelas da competência corrente calculadas por `getCreditCardSummary`). A barra de progresso em porcentagem (%) deve medir o peso da fatura atual em relação ao limite total do cartão.
- **Card de Parcelas Dinâmico:** O card informativo superior de "Parcelas" deve responder de forma reativa ao seletor de período do cabeçalho. Ao alterar o filtro de tempo, o componente deve somar as parcelas correspondentes estritamente à competência selecionada, abandonando valores estáticos acumulados.
- **Modernização de Links:** Substitua todos os textos estáticos "VER" dos cabeçalhos dos blocos por um ícone de lupa minimalista (`Search` do `lucide-react`) configurado como link de navegação.

### Governança e Soberania Contábil nos Relatórios (`/reports`)
- **Filtro de Partidas Dobradas:** Os gráficos e cards de totalização de Despesas e Receitas devem obrigatoriamente **ignorar** registros que possuam `transfer_id NOT NULL` ou que sejam do tipo `Pagamento de Cartão`. Movimentações internas não alteram o patrimônio líquido e não podem inflar artificialmente os totais do relatório.
- **Simetria Gerencial:** Implemente um gráfico de pizza/barras de **Receitas por Categoria** idêntico e espelhado ao modelo de despesas já existente, discriminando as origens dos ingressos (Salário, Pró-labore, Rendimentos, etc.) cadastrados pelo usuário.

## 6. Antes de implementar mudanças estruturais

Para qualquer mudança que:
- crie ou altere tabelas/colunas,
- altere a relação entre tabelas já existentes, ou
- toque mais de uma tela/fluxo ao mesmo tempo,

apresente o plano (o que muda no banco e no código) antes de implementar, e espere confirmação do usuário.

## 7. Bugs já identificados e corrigidos — não reintroduzir

Estes problemas já foram encontrados em auditoria e corrigidos (ou estão em correção). Ao mexer em código relacionado, preste atenção para não reintroduzir o mesmo padrão:

- O campo `icon` de `categories` já teve um limite de 8 caracteres no schema Zod que impedia salvar ícones customizados (imagens em base64). Qualquer campo que aceito upload de imagem como texto precisa de um limite de tamanho compatível com o que a interface realmente envia.
- O cálculo de vencimento de fatura de cartão (`assign_transaction_to_invoice`) já teve um bug em que o dia de vencimento ficava travado em 28 (`LEAST(acc.due_day, 28)`) em vez de respeitar o último dia real do mês, como já era feito corretamente para o fechamento. Qualquer cálculo de data baseado em "dia do mês" configurável pelo usuário deve lidar com meses de tamanhos diferentes.
- O recálculo de total de fatura (`recompute_invoice_total`) já ignorou estornos/reembolsos lançados como `income` na mesma fatura, somando só `type = 'expense'`. Qualquer lógica de soma de valores em fatura/extrato precisa considerar estornos.
- A exclusão de conta de usuário (delete de perfil) já deixou para trás dados órfãos em `budgets`, `credit_card_invoices`, `installment_purchases` e `installment_items`, porque a lista de limpeza manual estava incompleta e essas tabelas não tinham `ON DELETE CASCADE` a partir de `auth.users`. Qualquer nova tabela com dados do usuário precisa entrar tanto na rotina de limpeza quanto ter a FK com cascade.
- **Atenção ao Trigger Automático:** O gatilho automático de faturas (`assign_transaction_to_invoice`) deve ser explicitamente ignorado ou desativado para transferências e transações com a descrição "PAGAMENTO DE FATURA", evitando duplicidades na conta de destino e garantindo a soberania do preenchimento manual via campo `paid_invoice_id`.

## 8. Mapa rápido do código

- `src/lib/*.functions.ts` — toda a lógica de negócio do servidor (Server Functions), uma por domínio (transactions, accounts, recurrences, installments, invoices, goals, budgets, reports, forecast, import, threads, categories, profile, dashboard).
- `src/routes/*.tsx` — uma tela por arquivo, roteamento por nome de arquivo (TanStack Router).
- `src/routes/api/chat.ts` — endpoint do assistente de IA, com as tools disponíveis para o chat (record_transaction, list_recent, get_summary, create_account, create_goal, etc.).
- `supabase/migrations/*.sql` — schema do banco, RLS, triggers e funções RPC. As migrations rodam em ordem — o estado final do banco depende de TODAS elas terem sido aplicadas, então nunca presuma o comportamento de uma tabela olhando só a migration onde ela foi criada; confira se uma migration posterior alterou grants, colunas ou triggers.
- `src/integrations/supabase/` — clientes Supabase (`client.ts` = público, `client.server.ts` = admin/service_role, nunca importar o admin em código que roda no navegador) e middleware de autenticação.
