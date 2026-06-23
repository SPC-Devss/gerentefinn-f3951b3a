import { useQuery } from "@tanstack/react-query";
import { getCreditCardSummary } from "@/lib/credit-cards.functions";
import { formatBRL } from "@/lib/format";
import { CreditCard, Pencil, Trash2 } from "lucide-react";

type Props = {
  account: {
    id: string;
    name: string;
    type: string;
    institution: string | null;
    color: string;
    balance: number;
    credit_limit: number | null;
  };
  onEdit: () => void;
  onDelete: () => void;
};

function classifyUsage(pct: number | null): { label: string; barClass: string; textClass: string } {
  if (pct == null) return { label: "sem limite cadastrado", barClass: "bg-muted-foreground/40", textClass: "text-muted-foreground" };
  if (pct >= 80) return { label: "uso alto", barClass: "bg-rose-500", textClass: "text-rose-400" };
  if (pct >= 50) return { label: "uso moderado", barClass: "bg-amber-500", textClass: "text-amber-400" };
  return { label: "uso saudável", barClass: "bg-emerald-500", textClass: "text-emerald-400" };
}

export function CreditCardTile({ account, onEdit, onDelete }: Props) {
  const q = useQuery({
    queryKey: ["credit-card-summary", account.id],
    queryFn: () => getCreditCardSummary({ data: { accountId: account.id } }),
  });

  const s = q.data;
  const usagePctRaw = s?.usagePct ?? null;
  const usagePct = usagePctRaw != null ? Math.min(100, usagePctRaw) : null;
  const usage = classifyUsage(usagePctRaw);

  return (
    <div className="tile p-4 relative">
      <div className="absolute top-2 right-2 flex gap-1">
        <button
          onClick={onEdit}
          className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition"
          aria-label="Editar"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={onDelete}
          className="p-1.5 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition"
          aria-label="Excluir"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="h-10 w-10 rounded-lg flex items-center justify-center mb-3" style={{ background: account.color + "20", color: account.color }}>
        <CreditCard className="h-5 w-5" />
      </div>
      <div className="font-medium">{account.name}</div>
      <div className="text-xs text-muted-foreground">
        Cartão de crédito{account.institution ? ` · ${account.institution}` : ""}
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
        <div>
          <dt className="text-muted-foreground">Gastos à vista</dt>
          <dd className="font-medium tabular-nums">{s ? formatBRL(s.spentCash) : "—"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Parcelas do mês</dt>
          <dd className="font-medium tabular-nums">{s ? formatBRL(s.spentInstallments) : "—"}</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-muted-foreground">Fatura atual</dt>
          <dd className="text-lg font-display font-semibold tabular-nums">{s ? formatBRL(s.currentInvoice) : "—"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Já pago</dt>
          <dd className="font-medium tabular-nums text-emerald-400">{s ? formatBRL(s.alreadyPaid) : "—"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Compromisso futuro</dt>
          <dd className="font-medium tabular-nums">{s ? formatBRL(s.committedFuture) : "—"}</dd>
        </div>
      </dl>

      <div className="mt-3">
        <div className="flex items-center justify-between text-xs mb-1">
          <span className="text-muted-foreground">
            Limite {account.credit_limit != null ? formatBRL(Number(account.credit_limit)) : "não cadastrado"}
          </span>
          <span className={`font-medium ${usage.textClass}`}>
            {usagePctRaw != null ? `${usagePctRaw.toFixed(0)}%` : "—"}
          </span>
        </div>
        <div className="h-2 rounded-full bg-muted/40 overflow-hidden">
          <div
            className={`h-full transition-all ${usage.barClass}`}
            style={{ width: usagePct != null ? `${usagePct}%` : "0%" }}
            aria-label={`Uso do limite: ${usage.label}`}
          />
        </div>
      </div>
    </div>
  );
}
