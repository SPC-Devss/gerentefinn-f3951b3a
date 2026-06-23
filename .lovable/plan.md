## Diagnóstico

A tela `/login` existe e está intacta, mas a rota `/` (`src/routes/index.tsx`) não está mais redirecionando para ela quando o usuário está deslogado. Resultado: ao abrir o app, o `RootComponent` renderiza só `<Outlet />` com o componente `() => null` do índice — tela em branco, sem ir para o login.

Causa: o `beforeLoad` do `index.tsx` faz `if (typeof window === "undefined") return;` para evitar redirecionar usuários autenticados durante a SSR (já que `supabase.auth.getSession()` no servidor não enxerga o `localStorage`). Com esse early-return, o servidor responde HTML vazio e, na hidratação, o TanStack Router não reexecuta o `beforeLoad` do match inicial — então o `redirect({ to: "/login" })` nunca dispara.

Confirmei com Playwright: ao acessar `http://localhost:8080/` sem sessão, a URL permanece em `/` e o `<body>` fica vazio, sem erros no console.

## Correção proposta (mínima e cirúrgica)

Trocar a estratégia do `index.tsx` para que o gate rode no cliente:

- Marcar a rota `/` como `ssr: false`.
- Remover o early-return `typeof window === "undefined"`.
- Manter a lógica existente: sem sessão → `redirect({ to: "/login" })`; com sessão → escolher a thread mais recente (ou criar uma) e `redirect` para `/chat/$threadId`.

Isso restaura o comportamento original (login aparece para deslogado, chat aparece para logado) sem mexer em `__root.tsx`, na tela `/login` ou em qualquer outra rota.

## Arquivo afetado

- `src/routes/index.tsx` — apenas as opções da rota (`ssr: false`) e remoção do guard de `window`.

## Verificação

Após a alteração, rodar Playwright em `/` sem sessão e confirmar que a URL passa a `/login` e o formulário aparece.
