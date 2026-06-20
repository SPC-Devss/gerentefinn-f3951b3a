## 1. Dashboard — novo widget "Cartões"

Em `src/routes/dashboard.tsx`:
- Criar `CardsWidget` (componente similar ao `AccountsWidget`) que filtra `accounts` onde `type === "credit_card"` e mostra cada cartão com nome, valor usado (`-balance`) e barra de uso do limite.
- Cabeçalho com título "Cartões" + link "Ver" apontando para `/accounts`.
- Inserir o widget na coluna esquerda **entre** `AccountsWidget` e `FlowWidget`.
- O `AccountsWidget` passa a listar apenas contas **não-cartão** (para evitar duplicação).

## 2. Tela /accounts — separação visual e edição

Em `src/routes/accounts.tsx`:
- Separar a grid em duas seções: **Contas correntes** (todos os tipos exceto `credit_card`) e, abaixo, um divisor (`<div className="border-t border-border" />` com título "Cartões de crédito") seguido dos cartões.
- Cada card ganha um botão de **editar** (ícone `Pencil`) ao lado do botão deletar.
- Clicar abre um Dialog reutilizando o `AccountForm` em modo edição, pré-preenchendo `name`, `type`, `institution`, `color`, `credit_limit`, `closing_day`, `due_day`.
- Adicionar server function `updateAccount` em `src/lib/accounts.functions.ts` (mesmo schema do `createAccount` + `id`).
- Refatorar `AccountForm` para aceitar prop opcional `initial` e chamar `updateAccount` quando houver id.

## 3. Tela /transactions — busca ampliada

Em `src/routes/transactions.tsx`, no `filtered` useMemo: além de `description`, comparar `s` contra:
- valor formatado (`String(t.amount)` e `formatBRL(Number(t.amount))`)
- nome da conta/cartão (`t.accounts?.name`)
- nome da categoria (`t.categories?.name`)
Atualizar o placeholder do input para "Buscar descrição, valor, conta ou categoria…".

## 4. Janela "Novo lançamento" — validação e recorrência

Ainda em `src/routes/transactions.tsx`, no Dialog de criação:
- **Validação obrigatória de conta**: desabilitar o botão "Salvar lançamento" quando `!form.account_id` e exibir mensagem inline "Selecione uma conta ou cartão".
- **Campo Recorrência** (Select): "Não recorrente" / "Semanal" / "Mensal" / "Anual".
  - Se recorrente, ao salvar chamar `createRecurrence` (de `src/lib/recurrences.functions.ts`) com `description`, `type`, `amount`, `frequency`, `next_run_at = occurred_at`, `category_id`, `account_id`. Também cria o lançamento atual via `createTransaction`. Invalida query `["recurrences"]` para refletir em `/recurrences`.
  - Recorrência é mutuamente exclusiva com parcelamento.

## 5. Categoria nova — seletor de ícones

No bloco "Nova categoria" do mesmo Dialog:
- Substituir o `Input` de ícone por um seletor com:
  - **Grade de emojis sugeridos** condicionada a `form.type`:
    - Despesa: 🛒 🍔 ⛽ 🏠 💡 💊 🎬 ✈️ 🐶 📚 👕 🚗 📱 🎓 🧾 🛠️
    - Receita: 💰 💵 💼 🏦 📈 🎁 🪙 💳
  - Botão "Enviar imagem do meu computador" (`<input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp">`).
  - Texto auxiliar: "PNG, JPG, SVG ou WebP · até 256 KB · recomendado 64×64 px quadrado".
  - Validação cliente: rejeitar arquivos acima de 256 KB ou fora dos tipos permitidos com `toast.error`.
  - Arquivo válido é convertido para `data:` URL (base64) e armazenado como `icon` na categoria (campo `icon` já é texto livre — emojis curtos ou data-URL).
- O ícone selecionado fica refletido em `quickCatIcon` (string) e enviado ao `createCategory` existente.

## Detalhes técnicos

- Nenhuma migração SQL: `updateAccount` usa tabela `accounts` existente, `recurrences` e `categories` já existem.
- `AccountForm` recebe `initial?: AccountRow` e `mode: "create" | "edit"`; mantém o mesmo layout.
- Server function nova:
  ```ts
  // src/lib/accounts.functions.ts
  export const updateAccount = createServerFn({ method: "POST" })
    .middleware([requireSupabaseAuth])
    .inputValidator(/* id + mesmos campos do create, opcionais */)
    .handler(async ({ context, data }) => {
      const { id, ...patch } = data;
      const { error } = await context.supabase
        .from("accounts").update(patch)
        .eq("id", id).eq("user_id", context.userId);
      if (error) throw new Error(error.message);
      return { ok: true };
    });
  ```
- Recorrência criada a partir do lançamento: invalidar `["recurrences"]` + `["transactions"]` + `["dashboard"]`.
- Toast de confirmação único mostrando "Lançamento salvo" (e "Recorrência criada" quando aplicável).

## Arquivos alterados

- `src/lib/accounts.functions.ts` (adiciona `updateAccount`)
- `src/routes/accounts.tsx` (separação + botão editar + dialog edição)
- `src/routes/dashboard.tsx` (novo `CardsWidget`, ajuste no `AccountsWidget`)
- `src/routes/transactions.tsx` (busca ampliada, validação de conta, select de recorrência, seletor de ícones com upload)
