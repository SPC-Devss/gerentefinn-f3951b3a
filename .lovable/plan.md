## Respostas às suas três perguntas (antes de qualquer código)

**(a) `createRecurrence` e `createInstallmentPurchase` — reaproveitar 100%?**
- `createRecurrence`: **100% reaproveitada como está**. A assinatura já aceita `next_run_at`, `frequency`, `category_id`, `account_id`, `type`, `amount`, `description` — exatamente o que precisamos. A novidade é só do lado do cliente: ao "transformar em recorrência" um lançamento existente, calculamos `next_run_at` como a *próxima ocorrência futura* (ex.: para mensal, `occurred_at + 1 mês`) em vez de usar a data do próprio lançamento, e depois fazemos um `updateTransaction` adicional para gravar o `recurrence_id` no lançamento atual.
- `createInstallmentPurchase`: **100% reaproveitada como está**. A "conversão" é orquestrada no servidor por uma **nova** server function `convertTransactionToInstallment` (em `src/lib/installments.functions.ts`) que: valida que o lançamento pertence ao usuário, chama internamente a mesma lógica de `createInstallmentPurchase` e, no sucesso, apaga o lançamento original. Isso mantém atomicidade do ponto de vista do cliente e evita reimplementar a lógica de criação de parcelas.
- Pequeno ajuste **só no `updateTransaction`**: hoje ele aceita só campos básicos. Vou adicionar `recurrence_id?: string | null` na assinatura para permitir o vínculo após criar a recorrência. Não é mudança que quebra nada existente.

**(b) Onde fica a função compartilhada de checagem de duplicidade?**
- Novo arquivo `src/lib/duplicates.server.ts` (sufixo `.server.ts` = importável só por código server). Exporta uma única função pura:
  ```
  findPossibleDuplicates(sb, userId, candidates[]) → DuplicateMatch[]
  ```
  Recebe o cliente Supabase já autenticado, o `userId` e um array de candidatos `{ account_id, type, amount, occurred_at, description }`. Faz UMA consulta agregada (filtrando por `user_id`, datas no range ±1 dia e set de `account_id`) e devolve, para cada candidato, o `existing` mais parecido (ou `null`). Critério: mesma conta (ou ambos sem conta), mesmo tipo, mesmo valor, data com diferença ≤ 1 dia, descrição com similaridade ≥ limiar (normalização: lower + strip de acentos via `String.prototype.normalize("NFD")` + colapsar espaços; similaridade = distância de Levenshtein normalizada, sem dependência nova — implementação local pequena).
- Os três pontos de entrada passam a usar essa função:
  - `src/lib/transactions.functions.ts` → `createTransaction` (substitui o match exato atual)
  - `src/lib/import.functions.ts` → `bulkImportTransactions` (substitui o match exato atual; passa a marcar duplicatas e retornar a lista, sem bloquear)
  - `src/routes/api/chat.ts` → tool `record_transaction` (substitui o match exato atual)

**(c) Precisa de migration nova?**
- **Não.** Confirmei o schema: `transactions.recurrence_id` (uuid) já existe e já é usado pela RPC `materialize_due_recurrences`. Não há coluna ou tabela nova. Os três requisitos são 100% código de aplicação (cliente + server functions).

---

## Plano de implementação

### Requisito 1 — Recorrência/parcelamento no diálogo de edição

**Verificação prévia:** o diálogo "Novo lançamento" em `/transactions` JÁ tem campo de recorrência E parcelamento (checkbox "Compra parcelada"), mas a UI mistura padrões (Select para recorrência, Checkbox para parcelamento). Vou unificar nos dois diálogos.

**Novo componente compartilhado** `src/components/transaction-extras.tsx`:
- Recebe `mode: "create" | "edit"`, `value`, `onChange`, `accountIsCreditCard`, `type`.
- Estado fechado: mostra link discreto `+ Transformar em recorrência ou parcelamento` (mesmo estilo visual do `+ Nova categoria`).
- Aberto: pílulas `Único / Recorrente / Parcelado` (3 botões reaproveitando o estilo do `FilterPill` de `/installments`, extraído para `src/components/filter-pill.tsx` para uso compartilhado).
- `Recorrente`: Select de frequência (Semanal/Mensal/Anual).
- `Parcelado`: input de número de parcelas + caixa de aviso com `border-destructive/40 bg-destructive/10` (mesmo padrão da seção "Excluir conta" em `/settings`) explicando que vai substituir o lançamento atual.

**Diálogo "Novo lançamento" (`src/routes/transactions.tsx`)**: substitui o bloco atual de Recorrência + bloco de Parcelamento pelo novo componente. Comportamento de gravação igual ao atual.

**Diálogo "Editar lançamento" (`src/routes/transactions.tsx`)**:
- Se o `t.recurrence_id` ou pertencer a parcelamento (consulta auxiliar nova `getTransactionLink` que verifica `recurrence_id` e busca um `installment_items` cujo `purchase.description + due_date + amount` bata — ou, mais simples, descobrir o vínculo apenas pelo `recurrence_id`; para parcelamento, como hoje não há FK em `transactions`, não há como detectar pela tabela, então só mostramos selo quando `recurrence_id` existir): mostra selo no topo com ícone `Repeat` + texto "Recorrência mensal" + link "Ver em Recorrências". Para parcelamento real, isso só apareceria se no futuro houver vínculo; aceito esse limite ou, se preferir, criamos uma migration adicionando `installment_item_id` em `transactions` (me confirme — não está no plano atual).
- Caso contrário: mostra o mesmo componente `TransactionExtras`. Ao salvar com `Recorrente`: chama `updateTransaction` normal + `createRecurrence` com `next_run_at = occurred_at + 1×frequência` + segundo `updateTransaction` com `recurrence_id`. Ao salvar com `Parcelado`: abre `AlertDialog` de confirmação ("Isto vai remover o lançamento atual e criar um parcelamento de N×…"); confirmado, chama `convertTransactionToInstallment`.

**Revisão de importação (`src/routes/import.tsx`)**: o diálogo "Editar lançamento" já existente ali passa a usar o mesmo `TransactionExtras` (modo `create`, pois ainda não foi salvo). As escolhas ficam no objeto `ParsedTx` estendido com `_extras: { kind: "single"|"recurring"|"installment", frequency?, installments_count? }`, e o `bulkImportTransactions` é estendido para receber esses dados e, após inserir cada linha "recorrente", chamar `createRecurrence`; para "parcelado", chamar `createInstallmentPurchase` em vez de inserir em `transactions`.

### Requisito 2 — Duplicidade compartilhada

- Criar `src/lib/duplicates.server.ts` com `findPossibleDuplicates` (assinatura na resposta (b)).
- **Server**: `createTransaction`, `bulkImportTransactions`, tool `record_transaction` passam a usar a função. Os retornos atuais (`{ ok:false, duplicate:true, existing }` / `{ duplicates:[…] }`) são mantidos compatíveis para não quebrar o front existente; apenas o critério interno fica mais permissivo (data ±1 dia + similaridade de descrição).
- **Cliente**:
  - `/transactions` → ao **editar** uma linha, dispara checagem leve (mesmo critério) e, se houver match, mostra `toast.warning` não bloqueante com botão "Salvar mesmo assim" (que reenvia com `force: true`).
  - `/import` → revisão passa a marcar linhas com `_duplicate = true` (badge "possível duplicata" em vermelho discreto), e essas linhas vêm com `_enabled = false` por padrão. O fluxo de confirmação atual já cobre `force`.
  - Chat → comportamento atual já está correto, só herda o novo critério.

### Requisito 3 — Tipo obrigatório na importação

`src/routes/import.tsx`:
- Substitui o checkbox `isCreditCard` + select opcional de conta por:
  1. Select **obrigatório** `fileKind`: `"debit"` (Conta corrente / débito) | `"credit_card"` (Fatura de cartão).
  2. Select **obrigatório** `accountId`, filtrado por `fileKind`: `accounts.filter(a => a.type === "credit_card")` ou `a.type !== "credit_card"`.
- Botão "Ler arquivo" `disabled` até `file && fileKind && accountId`.
- `parseStatement` continua recebendo `is_credit_card` (derivado de `fileKind === "credit_card"`), e `bulkImportTransactions` agora sempre recebe `account_id` (deixa de ser opcional efetivamente; o servidor mantém o campo opcional para retrocompatibilidade).

---

## Resumo técnico (arquivos)

```text
NOVO  src/lib/duplicates.server.ts                 // findPossibleDuplicates compartilhada
NOVO  src/components/filter-pill.tsx               // extrai FilterPill de /installments
NOVO  src/components/transaction-extras.tsx        // pílulas Único/Recorrente/Parcelado + campos
EDIT  src/lib/installments.functions.ts            // + convertTransactionToInstallment
EDIT  src/lib/transactions.functions.ts            // updateTransaction aceita recurrence_id; usa duplicates.server
EDIT  src/lib/import.functions.ts                  // usa duplicates.server; aceita _extras p/ recorrência/parcelamento
EDIT  src/routes/api/chat.ts                       // tool record_transaction usa duplicates.server
EDIT  src/routes/transactions.tsx                  // novo componente nos dois diálogos + selo + AlertDialog conversão
EDIT  src/routes/import.tsx                        // tipo+conta obrigatórios, badge "possível duplicata", extras por linha
EDIT  src/routes/installments.tsx                  // passa a importar FilterPill compartilhado
```

**Migrations:** nenhuma.

Posso seguir com a implementação?
