import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { MessageCircle, LayoutDashboard, Wallet, Target, Repeat, Upload, LogOut, Sparkles, ListChecks, Settings, PiggyBank, CreditCard, TrendingUp, FileBarChart, Layers } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

const items = [
  { to: "/chat", icon: MessageCircle, label: "Chat" },
  { to: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/transactions", icon: ListChecks, label: "Lançamentos" },
  { to: "/accounts", icon: Wallet, label: "Contas" },
  { to: "/budgets", icon: PiggyBank, label: "Orçamentos" },
  { to: "/invoices", icon: CreditCard, label: "Faturas" },
  { to: "/installments", icon: Layers, label: "Parcelas" },
  { to: "/forecast", icon: TrendingUp, label: "Previsão" },
  { to: "/reports", icon: FileBarChart, label: "Relatórios" },
  { to: "/goals", icon: Target, label: "Metas" },
  { to: "/recurrences", icon: Repeat, label: "Recorrências" },
  { to: "/import", icon: Upload, label: "Importar" },
  { to: "/settings", icon: Settings, label: "Configurações" },
] as const;

/** Compact icon-rail used on tablet/desktop (md+). */
export function AppNav() {
  const navigate = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });

  return (
    <nav className="hidden md:flex w-16 shrink-0 bg-sidebar/60 backdrop-blur-xl border-r border-white/5 flex-col items-center py-3 gap-1">
      <Link
        to="/chat"
        className="h-10 w-10 rounded-xl bg-primary glow flex items-center justify-center mb-2"
        aria-label="Finn"
      >
        <Sparkles className="h-4 w-4 text-primary-foreground" />
      </Link>
      {items.map((it) => {
        const active = path === it.to || path.startsWith(it.to + "/");
        const Icon = it.icon;
        return (
          <Link
            key={it.to}
            to={it.to}
            className={`group relative h-10 w-10 rounded-xl flex items-center justify-center transition ${
              active
                ? "bg-primary/15 text-foreground shadow-[inset_0_1px_0_0_oklch(1_0_0_/_0.08)]"
                : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
            }`}
            aria-label={it.label}
          >
            <Icon className="h-4.5 w-4.5" />
            <span className="pointer-events-none absolute left-full ml-2 z-50 whitespace-nowrap rounded-md bg-popover/90 backdrop-blur px-2 py-1 text-xs opacity-0 shadow group-hover:opacity-100 transition border border-white/5">
              {it.label}
            </span>
          </Link>
        );
      })}
      <button
        onClick={async () => {
          await supabase.auth.signOut();
          navigate({ to: "/login" });
        }}
        className="mt-auto h-10 w-10 rounded-xl flex items-center justify-center text-muted-foreground hover:bg-white/5 hover:text-foreground"
        aria-label="Sair"
      >
        <LogOut className="h-4 w-4" />
      </button>
    </nav>
  );
}

/** Full-label list used inside the mobile drawer. */
export function AppNavList({ onNavigate }: { onNavigate?: () => void }) {
  const navigate = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="flex flex-col h-full py-2">
      <Link
        to="/chat"
        onClick={onNavigate}
        className="mx-2 mb-2 h-11 rounded-lg bg-primary glow flex items-center gap-3 px-3"
      >
        <Sparkles className="h-4 w-4 text-primary-foreground" />
        <span className="text-sm font-medium text-primary-foreground">Finn</span>
      </Link>
      <div className="flex-1 overflow-y-auto px-2 space-y-0.5">
        {items.map((it) => {
          const active = path === it.to || path.startsWith(it.to + "/");
          const Icon = it.icon;
          return (
            <Link
              key={it.to}
              to={it.to}
              onClick={onNavigate}
              className={`h-11 rounded-lg flex items-center gap-3 px-3 text-sm transition ${
                active ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              }`}
            >
              <Icon className="h-4.5 w-4.5" />
              <span>{it.label}</span>
            </Link>
          );
        })}
      </div>
      <button
        onClick={async () => {
          onNavigate?.();
          await supabase.auth.signOut();
          navigate({ to: "/login" });
        }}
        className="mx-2 mt-2 h-11 rounded-lg flex items-center gap-3 px-3 text-sm text-muted-foreground hover:bg-accent/50 hover:text-foreground"
      >
        <LogOut className="h-4 w-4" />
        <span>Sair</span>
      </button>
    </div>
  );
}
