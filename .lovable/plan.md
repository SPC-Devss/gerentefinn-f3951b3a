# Plano: criar `PRD.md` na raiz do projeto

## Objetivo
Gerar um único `PRD.md` (em pt-BR) na raiz do repositório, autossuficiente, que permita a outro agente de vibe coding (Cursor, Bolt, v0, Replit Agent, etc.) recriar o **Finn** do zero com **Supabase externo** (conta própria do usuário) e stack moderna React + TanStack Start, incluindo uma seção financeira detalhada explicando fórmulas, regime de caixa vs. competência e o tratamento de despesas/receitas.

## Estrutura proposta do PRD.md

1. **Visão geral do produto** — nome interno (Conversa Financeira) vs. produto (Finn); problema; público (usuário único); princípios (confiabilidade > estética, pt-BR, tema escuro único, mobile-first).

2. **Escopo funcional** — Auth (email + Google), Dashboard, Contas, Lançamentos (3 entradas: chat IA, importação, manual), Recorrências, Parcelamentos, Faturas de cartão, Categorias, Orçamentos, Metas, Relatórios, Forecast, Chat persistente, Detecção de duplicidade, página `/trust`.

3. **Stack técnica** — TanStack Start v1 + React 19 + Vite 7 + TS estrito; TanStack Router/Query; Tailwind v4 + shadcn/ui + Radix + lucide + Recharts; Zod; pdfjs-dist; runtime Cloudflare Workers (alternativas Vercel/Node).

4. **Supabase externo (não Lovable Cloud)** — criar projeto em supabase.com; envs (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`); três clientes (browser publishable, server publishable, admin); habilitar Email + Google; aplicar migrations via CLI.

5. **Modelagem de dados** — DDL resumida de `profiles`, `accounts`, `categories`, `transactions`, `recurrences`, `installment_purchases`, `installment_items`, `credit_card_invoices`, `budgets`, `goals`, `threads`, `messages`; regra `user_id NOT NULL REFERENCES auth.users ON DELETE CASCADE`; RLS `auth.uid() = user_id`; GRANTs explícitos; funções/triggers (`handle_new_user`, `touch_updated_at`, `assign_transaction_to_invoice`, `recompute_invoice_total`, `trg_recompute_invoice`, `materialize_due_recurrences`, `forecast_cashflow`, `account_balances`).

6. **🆕 Modelo financeiro: fórmulas, regime de caixa vs. competência e cálculos** *(seção nova e detalhada, conforme pedido)*

   6.1 **Tipos de conta e o que cada uma representa**
   - `checking` / `savings` / `cash` / `investment`: contas de saldo direto (regime de caixa puro)
   - `credit_card`: NÃO tem saldo no sentido tradicional; tem "fatura em aberto" e "fatura fechada"

   6.2 **Lançamentos (`transactions`) — convenções de sinal**
   - Campo `amount` sempre positivo; o sentido é dado por `type` (`income` | `expense`)
   - Fórmula canônica do delta de uma transação: `signed = (type='income' ? +amount : -amount)`
   - Estornos/reembolsos são lançados como `income` na MESMA conta (cartão) → entram no recálculo de fatura

   6.3 **Saldo de conta corrente (regime de caixa)**
   - Função `account_balances(_user_id)`: `SUM(CASE WHEN type='income' THEN amount WHEN type='expense' THEN -amount END)` agrupado por `account_id`
   - Considera TODAS as datas (`occurred_at` passado e futuro) — explicação de por quê e quando filtrar por `occurred_at <= CURRENT_DATE` (saldo "disponível hoje" vs. "saldo projetado")
   - Cartão de crédito (`type='credit_card'`) não tem linha em `account_balances` no sentido de "dinheiro disponível" — ver 6.4

   6.4 **Faturas de cartão de crédito (regime de competência)**
   - Cada transação em conta `credit_card` é vinculada a UMA fatura via trigger `assign_transaction_to_invoice` (BEFORE INSERT/UPDATE)
   - Regras de competência:
     - `closing_day` = dia do fechamento da fatura na conta
     - Se `occurred_at <= data_fechamento_do_mes_corrente` → fatura do mês corrente
     - Caso contrário → fatura do mês seguinte
     - Clamp ao último dia real do mês (evita o bug histórico do `LEAST(due_day, 28)`); mostrar a expressão `LEAST(closing_day, último_dia_do_mês(ref_month))`
   - Vencimento: `due_day` do mês seguinte ao fechamento, mesmo clamp
   - `reference_month` = `date_trunc('month', closing_date)` — chave única `(account_id, reference_month)`
   - Função `recompute_invoice_total`: `SUM(CASE WHEN type='expense' THEN amount ELSE -amount END)` sobre transações vinculadas → garante que estornos (`income`) abatem a fatura
   - Trigger `trg_recompute_invoice` recalcula em INSERT/UPDATE/DELETE, e também na fatura ANTIGA quando `invoice_id` muda

   6.5 **Pagamento de fatura (ponte entre competência → caixa)**
   - Modelagem: pagamento da fatura é um lançamento `expense` na conta corrente (caixa) + marcação de `status='paid'` na fatura (competência)
   - NÃO criar lançamento `income` no cartão para "zerar" — isso distorceria o histórico da fatura
   - Risco a evitar: contar a despesa duas vezes (uma na transação original do cartão, outra no pagamento) — o pagamento debita o caixa, mas a despesa "real" do orçamento é a transação original

   6.6 **Recorrências (`recurrences`)**
   - Tabela armazena o "molde" (não impacta saldo por si só)
   - RPC `materialize_due_recurrences(_user_id)` insere linhas reais em `transactions` quando `next_run_at <= CURRENT_DATE`, avança `next_run_at` conforme `frequency` (`weekly`/`monthly`/`yearly`) e marca `source='recurrence'` + `recurrence_id`
   - Quando materializadas, passam a contar normalmente em `account_balances` e em faturas (se a conta for cartão)
   - SECURITY DEFINER + `REVOKE EXECUTE ... FROM PUBLIC` + `GRANT EXECUTE ... TO service_role` (reaplicar após cada `CREATE OR REPLACE`)

   6.7 **Parcelamentos (`installment_purchases` + `installment_items`)** — sistema PARALELO
   - Hoje NÃO geram linhas em `transactions` — explicar essa decisão e o impacto:
     - Não entram em `account_balances`
     - Não entram em `credit_card_invoices` via trigger
     - Para o usuário ver "quanto vai pesar no mês X", a UI consulta `installment_items` diretamente filtrando por mês de vencimento
   - Fórmula de parcela: `valor_parcela = round(total / n, 2)`, com ajuste da última parcela = `total − sum(parcelas[0..n-2])` para fechar centavos
   - Marcação `paid`/`pending` por item; "converter em despesa real" é uma operação separada (não automática)
   - Alerta para o agente replicador: se decidir unificar com `transactions`, é decisão de modelagem que muda relatórios e fatura — exige plano explícito

   6.8 **Previsão de fluxo de caixa (`forecast_cashflow`)**
   - Saldo inicial = soma signed de `transactions` com `occurred_at <= CURRENT_DATE` (caixa)
   - Para cada dia futuro D ∈ [hoje, hoje+N]: somar
     - `-total_amount` de faturas `credit_card_invoices` com `due_date = D` e `status <> 'paid'` (a fatura SAI do caixa no vencimento)
     - delta signed de `recurrences` com `next_run_at = D` (recorrências previstas)
   - **Atenção**: a previsão NÃO inclui parcelamentos (limitação atual a documentar)
   - Resultado é o saldo projetado acumulado por dia

   6.9 **Relatórios e categorias**
   - Despesa/receita por categoria em janela [início, fim]: somar `amount` por `category_id` filtrando por `type` e `occurred_at BETWEEN`
   - Orçamentos (`budgets`): comparar consumo no período com `limit_amount` por categoria
   - Metas (`goals`): `progresso = current_amount / target_amount`; aportes podem (ou não) ser refletidos como `expense` em conta caixa — decisão a documentar

   6.10 **Regime de caixa vs. competência — quadro-resumo**
   - Tabela markdown mapeando cada feature à sua base:
     - Saldo de conta corrente → caixa
     - Pagamento de boleto/PIX → caixa
     - Compra no cartão → competência (entra na fatura)
     - Fatura paga → caixa (no dia do pagamento)
     - Recorrência prevista → competência (só vira caixa quando materializada e ocorrida)
     - Parcelamento → competência paralela (não afeta caixa enquanto não houver lançamento real)
     - Forecast → projeção mista (caixa atual + competência futura)

   6.11 **Casos de borda e armadilhas numéricas**
   - Datas: SEMPRE parsear `YYYY-MM-DD` manualmente (`formatDate`), nunca `new Date(iso).getMonth()` — bug de fuso
   - Moeda: SEMPRE `formatBRL`; armazenar como `numeric(14,2)` no banco; nunca usar `float`
   - Arredondamento: parcelas usam round-half-even por padrão JS — documentar e ajustar centavos na última parcela
   - Mês com 28/30/31 dias: clamp de `closing_day`/`due_day` ao último dia real
   - Fuso: o servidor usa UTC; `occurred_at` é `date` (sem hora), o que evita drift, mas exige parser manual no cliente
   - Idempotência da materialização de recorrências (não materializar duas vezes o mesmo dia)
   - Detecção de duplicidade compartilhada entre os 3 canais de entrada (Levenshtein ≥ 0,7 + mesma conta + mesmo tipo/valor + janela ±1 dia)

7. **Arquitetura de pastas e convenções de código** — `src/routes/` (file-based dot-separated), `src/routes/api/`, `src/lib/*.functions.ts` (Server Functions com `createServerFn` + `requireSupabaseAuth`), `src/lib/*.server.ts`, `src/components/`, `src/integrations/supabase/`; rotas autenticadas sob `_authenticated/` (ssr:false); pt-BR; Dialog/AlertDialog em vez de `confirm()`.

8. **Endpoint de chat IA `/api/chat`** — contrato POST + schemas das tools (`record_transaction`, `list_recent`, `get_summary`, `create_account`, `create_goal`...); como trocar Lovable AI Gateway por OpenAI/Anthropic/Google direto via Vercel AI SDK; streaming + persistência em `threads`/`messages`.

9. **Importação de extratos** — fluxo (Tipo + Conta antes do arquivo); parsers CSV/OFX/PDF (pdfjs-dist); reuso da detecção de duplicidade.

10. **Bugs históricos a evitar** — limite Zod de `icon`; clamp do dia 28; estornos ignorados em `recompute_invoice_total`; órfãos no delete de perfil; SECURITY DEFINER reconcedendo EXECUTE.

11. **Mix HTML estático + React** —
    - (A) Tudo no TanStack Start (SSR + `head()` para SEO em rotas públicas)
    - (B) Site institucional separado (Astro/HTML puro) em `www.dominio.com` + app React em `app.dominio.com` compartilhando o mesmo Supabase; compartilhamento de sessão via cookies de domínio raiz ou SSO Supabase
    - Recomendação: começar com (A)

12. **Roadmap de implementação** — bootstrap → Supabase + Auth → CRUDs base → faturas (trigger) → recorrências + parcelamentos → dashboard/relatórios/forecast → importação → chat IA → trust + deploy.

13. **Envs — checklist final** — tabela de variáveis e onde cada uma é usada.

14. **Critérios de aceitação** — testes manuais mínimos por feature; checks de segurança (RLS, sem `anon` em tabelas de usuário, service_role nunca no bundle do cliente, RPCs SECURITY DEFINER protegidas).

## Detalhes da entrega
- Único arquivo: `PRD.md` na raiz
- pt-BR; markdown rico (tabelas, exemplos curtos de DDL e fórmulas em blocos de código)
- Sem código completo de UI — apenas DDL resumida, assinaturas de Server Functions, contratos de endpoint e fórmulas
- Sem mencionar URLs internas do Lovable nem IDs do projeto
- Lovable AI Gateway aparece apenas como uma das alternativas de provedor de IA

## Arquivos afetados
- Criar: `PRD.md`
- Não altera mais nada
