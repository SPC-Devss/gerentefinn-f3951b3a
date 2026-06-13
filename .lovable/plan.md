
# Redesign visual estilo ZimaOS

Aplico a estética do ZimaOS (preto profundo, tiles arredondados com efeito glass, brilhos diagonais de fundo, tipografia leve e espaçada) ao Finn. Nenhuma regra de negócio, query ou server function muda — só apresentação.

## 1. Paleta e fundo (`src/styles.css`)

Migrar de Midnight Indigo para "Zima Black":

- `--background`: preto quase puro (oklch ~0.08)
- `--card`: cinza-chumbo translúcido (oklch ~0.15) — base dos tiles glass
- `--border`: borda sutil branca a ~6%
- `--primary`: mantém indigo/violeta atual como accent (botões, glow do Finn, gráficos)
- Body ganha background com brilhos diagonais sutis estilo ZimaOS:
  ```
  background:
    radial-gradient(1200px 600px at 20% -10%, rgba(255,255,255,0.05), transparent),
    radial-gradient(800px 500px at 90% 110%, rgba(120,80,255,0.08), transparent),
    linear-gradient(120deg, transparent 40%, rgba(255,255,255,0.025) 50%, transparent 60%),
    #07070a;
  ```
- Nova classe utilitária `.tile` para o efeito vidro: `bg-card/60 backdrop-blur-xl border border-white/5 rounded-2xl shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset]`
- Aumentar `--radius` para `1rem` (tiles mais arredondados, como ZimaOS).

## 2. Dashboard estilo ZimaOS (`src/routes/dashboard.tsx`)

Reorganizar em duas colunas no desktop, empilhado no mobile:

```text
┌──────────────┬──────────────────────────────┐
│ Relógio+Data │  Filtros (período)           │
│              │  Tile grid: Lançamentos,     │
│ Resumo $     │  Faturas, Parcelas, Metas,   │
│              │  Recorrências, Orçamentos,   │
│ Contas       │  Relatórios, Importar,       │
│              │  Chat                        │
│ Fluxo (mini) ├──────────────────────────────┤
│              │  Gráficos (área + categoria) │
└──────────────┴──────────────────────────────┘
```

**Coluna esquerda — widgets (todos como tiles glass):**
- **Relógio + data**: hora grande (font-display, tracking-tight), data por extenso em pt-BR, atualiza a cada minuto.
- **Resumo financeiro**: substitui o "Sistema/CPU/RAM" do ZimaOS — dois mini-rings (Receitas / Despesas, % do orçamento) + saldo do mês.
- **Contas**: lista compacta com nome + saldo; cartões de crédito mostram barra de uso do limite (igual barra de armazenamento do ZimaOS).
- **Mini fluxo**: sparkline (Area do recharts sem eixos) dos últimos 14 dias + setinhas de entrada/saída do dia.

**Coluna direita — "Aplicativos":**
- Header "Aplicativos" igual ZimaOS.
- Grid `grid-cols-2 sm:grid-cols-3 lg:grid-cols-4` de tiles quadrados (cada um vira `<Link>` para a rota): ícone grande centralizado + label embaixo. Hover: leve elevação + brilho do accent.
- Abaixo: os gráficos atuais (série, por categoria, fixas vs variáveis, metas, últimas movimentações), todos convertidos para `.tile`.

Filtros existentes ficam compactados num único botão "Filtros" que abre Sheet (mobile) ou row colapsável (desktop).

## 3. Revisão visual global

Aplicar o vocabulário em todas as rotas existentes, sem alterar conteúdo:

- **`AppShell` / header**: header fica transparente sobre o gradient, com `backdrop-blur` apenas ao rolar. Título em `font-display` mais leve.
- **`AppNav` (sidebar md+)**: fundo `bg-transparent` + tiles dos ícones com a mesma linguagem glass; item ativo ganha glow do primary.
- **Cards de todas as telas** (`transactions`, `invoices`, `installments`, `forecast`, `reports`, `accounts`, `budgets`, `goals`, `recurrences`, `settings`, `chat`): substituir `rounded-xl border border-border bg-card/40` por `.tile` (rounded-2xl, blur, borda branca sutil).
- **Inputs, Selects, Buttons** (shadcn): ajustar variantes para casar com o fundo preto (border `white/10`, hover `white/5`).
- **Recharts**: grids e eixos com opacidade menor (`rgba(255,255,255,0.04)`), cores mantidas.
- **Chat (`chat.$threadId.tsx`)**: bolhas com efeito glass; bolha do usuário em accent indigo translúcido.
- **Login (`login.tsx`)**: card central vira tile glass com glow.

## 4. Detalhes técnicos

- Sem dependências novas. Tudo com Tailwind v4 + tokens em `src/styles.css`.
- Glass usa só `backdrop-filter` padrão (Tailwind cuida do prefixo).
- Sem mudança em rotas, server functions ou schema.
- Mobile-first preservado: a coluna de widgets vira stack acima do grid no `<lg`.
- Breakpoints chave verificados: 375, 768, 1024, 1440.

## Entrega

Após aprovar, implemento numa passada só: edito `styles.css`, `app-shell.tsx`, `app-nav.tsx`, `dashboard.tsx` (reescrita média) e faço o varrer de classes nos demais routes. Não altero lógica de dados.
