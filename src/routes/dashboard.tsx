import { createFileRoute, Link } from "@tanstack/react-router";
import { requireAuth } from "@/lib/require-auth";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { getDashboard } from "@/lib/dashboard.functions";
import { listAccounts } from "@/lib/accounts.functions";
import { listCategories } from "@/lib/categories.functions";
import { AppShell } from "@/components/app-shell";
import { formatBRL } from "@/lib/format";
import {
  TrendingUp, TrendingDown, Wallet, Target, Layers, Repeat, Shuffle,
  MessageCircle, ListChecks, CreditCard, PiggyBank, FileBarChart, Upload, Settings, Sparkles,
} from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
  BarChart, Bar, PieChart, Pie, Cell, Legend,
} from "recharts";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/dashboard")({
  beforeLoad: requireAuth,
  component: DashboardPage,
  head: () => ({ meta: [{ title: "Dashboard — Finn" }] }),
});

const COLORS = ["#7c6cff", "#a78bfa", "#ec4899", "#f59e0b", "#10b981", "#06b6d4", "#ef4444", "#84cc16"];
type Period = "month" | "3m" | "year" | "all" | "custom_month" | "custom_year";

const MONTHS_PT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

const APPS = [
  { to: "/chat", icon: MessageCircle, label: "Chat", tone: "from-violet-500/40 to-fuchsia-500/30" },
  { to: "/transactions", icon: ListChecks, label: "Lançamentos", tone: "from-sky-500/40 to-cyan-400/20" },
  { to: "/accounts", icon: Wallet, label: "Contas", tone: "from-emerald-500/40 to-teal-400/20" },
  { to: "/invoices", icon: CreditCard, label: "Faturas", tone: "from-rose-500/40 to-orange-400/20" },
  { to: "/installments", icon: Layers, label: "Parcelas", tone: "from-amber-500/40 to-yellow-400/20" },
  { to: "/forecast", icon: TrendingUp, label: "Previsão", tone: "from-indigo-500/40 to-blue-400/20" },
  { to: "/reports", icon: FileBarChart, label: "Relatórios", tone: "from-purple-500/40 to-pink-400/20" },
  { to: "/budgets", icon: PiggyBank, label: "Orçamentos", tone: "from-lime-500/40 to-green-400/20" },
  { to: "/goals", icon: Target, label: "Metas", tone: "from-red-500/40 to-rose-400/20" },
  { to: "/recurrences", icon: Repeat, label: "Recorrências", tone: "from-teal-500/40 to-emerald-400/20" },
  { to: "/import", icon: Upload, label: "Importar", tone: "from-slate-400/40 to-zinc-300/20" },
  { to: "/settings", icon: Settings, label: "Configurações", tone: "from-zinc-500/40 to-slate-400/20" },
] as const;

function DashboardPage() {
  const now = new Date();
  const [period, setPeriod] = useState<Period>("month");
  const [customMonth, setCustomMonth] = useState<string>(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  const [customYear, setCustomYear] = useState<string>(String(now.getFullYear()));
  const [accountKind, setAccountKind] = useState<"all" | "credit_card" | "cash_like">("all");
  const [accountId, setAccountId] = useState<string>("all");
  const [categoryId, setCategoryId] = useState<string>("all");

  const accountsQ = useQuery({ queryKey: ["accounts"], queryFn: () => listAccounts() });
  const categoriesQ = useQuery({ queryKey: ["categories"], queryFn: () => listCategories() });

  const filteredAccounts = useMemo(() => {
    const accs = accountsQ.data ?? [];
    if (accountKind === "credit_card") return accs.filter((a) => a.type === "credit_card");
    if (accountKind === "cash_like") return accs.filter((a) => a.type !== "credit_card");
    return accs;
  }, [accountsQ.data, accountKind]);

  const yearOptions = useMemo(() => {
    const y = now.getFullYear();
    return [y - 2, y - 1, y, y + 1].map(String);
  }, [now]);
  const monthOptions = useMemo(() => {
    const y = Number(customMonth.slice(0, 4));
    return MONTHS_PT.map((label, i) => ({
      value: `${y}-${String(i + 1).padStart(2, "0")}`,
      label: `${label} ${y}`,
    }));
  }, [customMonth]);

  const q = useQuery({
    queryKey: ["dashboard", period, customMonth, customYear, accountKind, accountId, categoryId],
    queryFn: () =>
      getDashboard({
        data: {
          period,
          month: period === "custom_month" ? customMonth : null,
          year: period === "custom_year" ? customYear : null,
          accountId: accountId === "all" ? null : accountId,
          categoryId: categoryId === "all" ? null : categoryId,
          accountKind,
        },
      }),
  });
  const d = q.data;

  const periodLabel = period === "custom_month"
    ? monthOptions.find((m) => m.value === customMonth)?.label ?? customMonth
    : period === "custom_year"
      ? customYear
      : period === "month" ? "Mês atual" : period === "3m" ? "Últimos 3 meses" : period === "year" ? "Este ano" : "Tudo";

  const seriesTitle = period === "month" || period === "custom_month" ? `${periodLabel} (diário)` : period === "3m" ? "Últimos 3 meses (diário)" : "Mensal";

  return (
    <AppShell title="Painel" subtitle={periodLabel}>
      <div className="grid grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)] gap-4 lg:gap-6">
        {/* Left: widgets */}
        <aside className="space-y-4">
          <ClockWidget />
          <FinanceWidget income={d?.month.income ?? 0} expense={d?.month.expense ?? 0} balance={d?.month.balance ?? 0} />
          <AccountsWidget accounts={(accountsQ.data ?? []).filter((a) => a.type !== "credit_card")} />
          <CardsWidget accounts={(accountsQ.data ?? []).filter((a) => a.type === "credit_card")} />
          <FlowWidget series={d?.series ?? []} />
        </aside>

        {/* Right: filters + apps + insights */}
        <section className="space-y-5">
          {/* Filters */}
          <div className="tile p-3 sm:p-4">
            <div className="flex flex-wrap gap-3">
              <FilterSelect label="Período" value={period} onChange={(v) => setPeriod(v as Period)}
                options={[
                  { value: "month", label: "Mês atual" },
                  { value: "custom_month", label: "Mês específico" },
                  { value: "custom_year", label: "Ano específico" },
                  { value: "3m", label: "Últimos 3 meses" },
                  { value: "year", label: "Este ano" },
                  { value: "all", label: "Tudo" },
                ]} />
              {period === "custom_month" && (
                <>
                  <FilterSelect label="Ano" value={customMonth.slice(0, 4)}
                    onChange={(y) => setCustomMonth(`${y}-${customMonth.slice(5)}`)}
                    options={yearOptions.map((y) => ({ value: y, label: y }))} />
                  <FilterSelect label="Mês" value={customMonth} onChange={setCustomMonth} options={monthOptions} />
                </>
              )}
              {period === "custom_year" && (
                <FilterSelect label="Ano" value={customYear} onChange={setCustomYear}
                  options={yearOptions.map((y) => ({ value: y, label: y }))} />
              )}
              <FilterSelect label="Tipo" value={accountKind} onChange={(v) => { setAccountKind(v as typeof accountKind); setAccountId("all"); }}
                options={[
                  { value: "all", label: "Todos" },
                  { value: "cash_like", label: "Conta corrente" },
                  { value: "credit_card", label: "Cartão de crédito" },
                ]} />
              <FilterSelect label="Conta" value={accountId} onChange={setAccountId}
                options={[
                  { value: "all", label: "Todas" },
                  ...filteredAccounts.map((a) => ({ value: a.id, label: a.name })),
                ]} />
              <FilterSelect label="Categoria" value={categoryId} onChange={setCategoryId}
                options={[
                  { value: "all", label: "Todas as categorias" },
                  ...(categoriesQ.data ?? []).map((c) => ({ value: c.id, label: `${c.icon ?? ""} ${c.name}`.trim() })),
                ]} />
            </div>
          </div>

          {/* Apps grid — ZimaOS style */}
          <div>
            <div className="flex items-center justify-between mb-3 px-1">
              <h2 className="font-display text-base sm:text-lg font-medium tracking-tight">Aplicativos</h2>
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Acesso rápido</span>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4">
              {APPS.map((app) => (
                <AppTile key={app.to} {...app} />
              ))}
            </div>
          </div>

          {!d ? (
            <div className="tile p-8 text-center text-sm text-muted-foreground">Carregando…</div>
          ) : (
            <>
              {/* KPIs */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                <Kpi label="Receitas" value={d.month.income} icon={<TrendingUp className="h-4 w-4" />} tone="success" />
                <Kpi label="Despesas" value={d.month.expense} icon={<TrendingDown className="h-4 w-4" />} tone="destructive" />
                <Kpi label="Saldo" value={d.month.balance} icon={<Wallet className="h-4 w-4" />} tone={d.month.balance < 0 ? "destructive" : "primary"} />
                <Kpi label="Parcelas (a pagar)" value={d.installmentsCommitted} icon={<Layers className="h-4 w-4" />} tone="primary" />
              </div>

              <Card title="Despesas fixas vs variáveis">
                <FixedVsVariable fixed={d.expenseBreakdown.fixed} variable={d.expenseBreakdown.variable} />
              </Card>

              <Card title={seriesTitle}>
                {d.series.length === 0 ? (
                  <Empty text="Sem movimentações no período" />
                ) : (
                  <div className="h-48 sm:h-64 -ml-2 sm:ml-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={d.series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="gIn" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#10b981" stopOpacity={0.5} />
                            <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="gOut" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#ef4444" stopOpacity={0.5} />
                            <stop offset="100%" stopColor="#ef4444" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                        <XAxis
                          dataKey="date"
                          tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 11 }}
                          tickFormatter={(v: string) => (v.length === 7 ? `${v.slice(5)}/${v.slice(2, 4)}` : v.slice(5))}
                        />
                        <YAxis tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 11 }} tickFormatter={(v) => `R$${v}`} />
                        <Tooltip content={<TooltipBox />} />
                        <Area type="monotone" dataKey="income" stroke="#10b981" fill="url(#gIn)" name="Receitas" />
                        <Area type="monotone" dataKey="expense" stroke="#ef4444" fill="url(#gOut)" name="Despesas" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </Card>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6">
                <Card title="Despesas por categoria">
                  {d.byCategory.length === 0 ? (
                    <Empty text="Sem despesas no período" />
                  ) : (
                    <div className="h-56 sm:h-64">
                      <ResponsiveContainer>
                        <BarChart data={d.byCategory} layout="vertical" margin={{ left: 0, right: 16, top: 8, bottom: 8 }}>
                          <XAxis type="number" tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 10 }} />
                          <YAxis type="category" dataKey="name" tick={{ fill: "rgba(255,255,255,0.7)", fontSize: 11 }} width={80} />
                          <Tooltip content={<TooltipBox />} />
                          <Bar dataKey="amount" fill="#7c6cff" radius={[0, 6, 6, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </Card>

                <Card title="Distribuição">
                  {d.byCategory.length === 0 ? (
                    <Empty text="Sem dados" />
                  ) : (
                    <div className="h-56 sm:h-64">
                      <ResponsiveContainer>
                        <PieChart>
                          <Pie data={d.byCategory.slice(0, 5)} dataKey="amount" nameKey="name" innerRadius={50} outerRadius={85} paddingAngle={2}>
                            {d.byCategory.slice(0, 5).map((_, i) => (
                              <Cell key={i} fill={COLORS[i % COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip content={<TooltipBox />} />
                          <Legend wrapperStyle={{ fontSize: 12 }} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </Card>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6">
                <Card title="Metas ativas">
                  {d.goals.length === 0 ? (
                    <Empty text="Nenhuma meta ativa" />
                  ) : (
                    <div className="space-y-3">
                      {d.goals.map((g) => {
                        const pct = Math.min(100, (Number(g.current_amount) / Number(g.target_amount)) * 100);
                        return (
                          <div key={g.id}>
                            <div className="flex items-center gap-2 text-sm mb-1.5">
                              <Target className="h-3.5 w-3.5 text-primary" />
                              <span className="font-medium">{g.name}</span>
                              <span className="ml-auto tabular-nums text-muted-foreground">
                                {formatBRL(Number(g.current_amount))} / {formatBRL(Number(g.target_amount))}
                              </span>
                            </div>
                            <Progress value={pct} />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </Card>

                <Card title="Últimas movimentações">
                  {d.recent.length === 0 ? (
                    <Empty text="Nenhuma transação" />
                  ) : (
                    <ul className="space-y-2.5">
                      {d.recent.map((t) => {
                        const exp = t.type === "expense";
                        const cat = t.categories as { name?: string | null; icon?: string | null } | null;
                        return (
                          <li key={t.id} className="flex items-center gap-3 text-sm">
                            <div className={`h-8 w-8 rounded-xl flex items-center justify-center text-xs ${exp ? "bg-destructive/15 text-destructive" : "bg-success/15 text-success"}`}>
                              {cat?.icon ?? (exp ? "↓" : "↑")}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="truncate">{t.description}</div>
                              <div className="text-xs text-muted-foreground">{cat?.name ?? "Outros"} · {t.occurred_at}</div>
                            </div>
                            <div className={`tabular-nums font-medium ${exp ? "text-destructive" : "text-success"}`}>
                              {exp ? "-" : "+"}{formatBRL(Number(t.amount))}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </Card>
              </div>
            </>
          )}
        </section>
      </div>
    </AppShell>
  );
}

/* -------------------- Widgets (ZimaOS-style) -------------------- */

function ClockWidget() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const date = now.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
  return (
    <div className="tile p-5">
      <div className="font-display text-5xl sm:text-6xl font-light tracking-tighter tabular-nums leading-none">
        {hh}<span className="opacity-50">:</span>{mm}
      </div>
      <div className="mt-3 text-xs text-muted-foreground capitalize">{date}</div>
    </div>
  );
}

function Ring({ value, max, color, label, amount }: { value: number; max: number; color: string; label: string; amount: number }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const r = 28;
  const c = 2 * Math.PI * r;
  const dash = (pct / 100) * c;
  return (
    <div className="flex flex-col items-center gap-1 min-w-0">
      <div className="relative h-[72px] w-[72px]">
        <svg viewBox="0 0 72 72" className="h-full w-full -rotate-90">
          <circle cx="36" cy="36" r={r} stroke="oklch(1 0 0 / 0.08)" strokeWidth="6" fill="none" />
          <circle cx="36" cy="36" r={r} stroke={color} strokeWidth="6" fill="none"
            strokeDasharray={`${dash} ${c}`} strokeLinecap="round" />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-[10px]">
          <span className="font-semibold tabular-nums">{Math.round(pct)}%</span>
        </div>
      </div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="text-[11px] tabular-nums truncate max-w-full">{formatBRL(amount)}</div>
    </div>
  );
}

function FinanceWidget({ income, expense, balance }: { income: number; expense: number; balance: number }) {
  const total = Math.max(income, expense, 1);
  return (
    <div className="tile p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-medium">Resumo</div>
        <Sparkles className="h-3.5 w-3.5 text-primary" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Ring value={income} max={total} color="#10b981" label="Receitas" amount={income} />
        <Ring value={expense} max={total} color="#ef4444" label="Despesas" amount={expense} />
      </div>
      <div className="mt-4 pt-3 border-t border-white/5 flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Saldo</span>
        <span className={`text-base font-display font-medium tabular-nums ${balance < 0 ? "text-destructive" : "text-success"}`}>
          {formatBRL(balance)}
        </span>
      </div>
    </div>
  );
}

type AccountRow = { id: string; name: string; type: string; balance: number; credit_limit: number | null; color?: string | null };
function AccountsWidget({ accounts }: { accounts: AccountRow[] }) {
  const shown = accounts;
  return (
    <div className="tile p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-medium">Contas <span className="text-[10px] text-muted-foreground">({shown.length})</span></div>
        <Link to="/accounts" className="text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground">Ver</Link>
      </div>
      {shown.length === 0 ? (
        <div className="text-xs text-muted-foreground py-4 text-center">Nenhuma conta</div>
      ) : (
        <div className="space-y-3 max-h-72 overflow-y-auto pr-1">

          {shown.map((a) => {
            const isCard = a.type === "credit_card";
            const limit = Number(a.credit_limit ?? 0);
            const used = isCard ? Math.max(0, -a.balance) : 0;
            const pct = isCard && limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
            return (
              <div key={a.id}>
                <div className="flex items-center gap-2 text-xs">
                  <span className="h-2 w-2 rounded-full shrink-0" style={{ background: a.color ?? "#7c6cff" }} />
                  <span className="truncate flex-1">{a.name}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {isCard ? formatBRL(used) : formatBRL(a.balance)}
                  </span>
                </div>
                {isCard && limit > 0 && (
                  <div className="mt-1.5 h-1 w-full rounded-full bg-white/5 overflow-hidden">
                    <div className="h-full rounded-full bg-gradient-to-r from-primary to-fuchsia-500" style={{ width: `${pct}%` }} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CardsWidget({ accounts }: { accounts: AccountRow[] }) {
  const shown = accounts;
  return (
    <div className="tile p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-medium">Cartões <span className="text-[10px] text-muted-foreground">({shown.length})</span></div>
        <Link to="/accounts" className="text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground">Ver</Link>
      </div>
      {shown.length === 0 ? (
        <div className="text-xs text-muted-foreground py-4 text-center">Nenhum cartão</div>
      ) : (
        <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
          {shown.map((a) => {
            const limit = Number(a.credit_limit ?? 0);
            const used = Math.max(0, -a.balance);
            const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
            return (
              <div key={a.id}>
                <div className="flex items-center gap-2 text-xs">
                  <CreditCard className="h-3 w-3 shrink-0" style={{ color: a.color ?? "#7c6cff" }} />
                  <span className="truncate flex-1">{a.name}</span>
                  <span className="tabular-nums text-muted-foreground">{formatBRL(used)}</span>
                </div>
                {limit > 0 && (
                  <div className="mt-1.5 h-1 w-full rounded-full bg-white/5 overflow-hidden">
                    <div className="h-full rounded-full bg-gradient-to-r from-rose-500 to-orange-400" style={{ width: `${pct}%` }} />
                  </div>
                )}
                {limit > 0 && (
                  <div className="mt-0.5 text-[10px] text-muted-foreground tabular-nums text-right">
                    {Math.round(pct)}% de {formatBRL(limit)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FlowWidget({ series }: { series: Array<{ date: string; income: number; expense: number }> }) {
  const data = series.slice(-14).map((s) => ({ ...s, net: s.income - s.expense }));
  const last = data[data.length - 1];
  return (
    <div className="tile p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-medium">Fluxo</div>
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">14d</span>
      </div>
      <div className="h-16">
        {data.length === 0 ? (
          <div className="h-full flex items-center justify-center text-[11px] text-muted-foreground">Sem dados</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="gFlow" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#7c6cff" stopOpacity={0.6} />
                  <stop offset="100%" stopColor="#7c6cff" stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="net" stroke="#7c6cff" strokeWidth={2} fill="url(#gFlow)" />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
      {last && (
        <div className="mt-2 flex items-center justify-between text-[11px]">
          <span className="inline-flex items-center gap-1 text-success">
            <TrendingUp className="h-3 w-3" /> {formatBRL(last.income)}
          </span>
          <span className="inline-flex items-center gap-1 text-destructive">
            <TrendingDown className="h-3 w-3" /> {formatBRL(last.expense)}
          </span>
        </div>
      )}
    </div>
  );
}

function AppTile({ to, icon: Icon, label, tone }: { to: string; icon: typeof MessageCircle; label: string; tone: string }) {
  return (
    <Link to={to} className="tile tile-hover group flex flex-col items-center justify-center gap-2 p-3 sm:p-4 aspect-square">
      <div className={`h-10 w-10 sm:h-12 sm:w-12 rounded-2xl bg-gradient-to-br ${tone} flex items-center justify-center shadow-inner border border-white/10`}>
        <Icon className="h-5 w-5 sm:h-6 sm:w-6 text-foreground" />
      </div>
      <span className="text-[11px] sm:text-xs text-center text-muted-foreground group-hover:text-foreground transition truncate max-w-full">{label}</span>
    </Link>
  );
}

/* -------------------- Existing helpers -------------------- */

function FixedVsVariable({ fixed, variable }: { fixed: number; variable: number }) {
  const total = fixed + variable;
  if (total === 0) return <Empty text="Sem despesas no período" />;
  const fixedPct = (fixed / total) * 100;
  const variablePct = 100 - fixedPct;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-xl bg-white/[0.03] border border-white/5 p-3">
          <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
            <Repeat className="h-3.5 w-3.5 text-primary" /> Fixas
          </div>
          <div className="mt-1 text-xl font-display font-semibold tabular-nums">{formatBRL(fixed)}</div>
          <div className="text-xs text-muted-foreground">{fixedPct.toFixed(1)}% · contas recorrentes</div>
        </div>
        <div className="rounded-xl bg-white/[0.03] border border-white/5 p-3">
          <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
            <Shuffle className="h-3.5 w-3.5 text-[#f59e0b]" /> Variáveis
          </div>
          <div className="mt-1 text-xl font-display font-semibold tabular-nums">{formatBRL(variable)}</div>
          <div className="text-xs text-muted-foreground">{variablePct.toFixed(1)}% · gastos pontuais</div>
        </div>
      </div>
      <div className="h-2 w-full rounded-full overflow-hidden bg-white/5 border border-white/5 flex">
        <div className="h-full bg-primary" style={{ width: `${fixedPct}%` }} />
        <div className="h-full bg-[#f59e0b]" style={{ width: `${variablePct}%` }} />
      </div>
      <p className="text-xs text-muted-foreground">
        Despesas <span className="text-foreground font-medium">fixas</span> são lançamentos vinculados a uma recorrência (luz, condomínio, IPTU, financiamento, etc).
        Cadastre em <span className="text-foreground">Recorrências</span> para classificar corretamente.
      </p>
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div className="flex flex-col gap-1 min-w-0 flex-1 sm:flex-none">
      <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-9 w-full sm:w-[170px] bg-white/5 border-white/10">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function Kpi({ label, value, icon, tone }: { label: string; value: number; icon: React.ReactNode; tone: "success" | "destructive" | "primary" }) {
  const color = tone === "success" ? "text-success" : tone === "destructive" ? "text-destructive" : "text-primary";
  return (
    <div className="tile p-3 sm:p-4 min-w-0">
      <div className="flex items-center gap-2 text-[10px] sm:text-xs uppercase tracking-widest text-muted-foreground">
        <span className={color}>{icon}</span>
        <span className="truncate">{label}</span>
      </div>
      <div className={`mt-2 text-lg sm:text-2xl font-display font-semibold tabular-nums truncate ${color}`}>{formatBRL(value)}</div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="tile p-4">
      <div className="text-xs uppercase tracking-widest text-muted-foreground mb-3">{title}</div>
      {children}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="h-40 flex items-center justify-center text-sm text-muted-foreground">{text}</div>;
}

function TooltipBox({ active, payload, label }: { active?: boolean; payload?: Array<{ name?: string; value?: number; color?: string }>; label?: string | number }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-white/10 bg-popover/90 backdrop-blur px-3 py-2 text-xs shadow">
      {label != null && <div className="text-muted-foreground mb-1">{String(label)}</div>}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
          <span>{p.name}:</span>
          <span className="tabular-nums font-medium">{formatBRL(Number(p.value ?? 0))}</span>
        </div>
      ))}
    </div>
  );
}
