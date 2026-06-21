import { useState } from "react";
import { FilterPill } from "@/components/filter-pill";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle } from "lucide-react";
import { formatBRL } from "@/lib/format";

export type ExtrasKind = "single" | "recurring" | "installment";
export type ExtrasFrequency = "weekly" | "monthly" | "yearly";

export type TransactionExtrasValue = {
  kind: ExtrasKind;
  frequency: ExtrasFrequency;
  installments_count: number;
};

export const DEFAULT_EXTRAS: TransactionExtrasValue = {
  kind: "single",
  frequency: "monthly",
  installments_count: 2,
};

export function TransactionExtras({
  value,
  onChange,
  accountIsCreditCard,
  isExpense,
  mode,
  amount,
}: {
  value: TransactionExtrasValue;
  onChange: (v: TransactionExtrasValue) => void;
  accountIsCreditCard: boolean;
  isExpense: boolean;
  mode: "create" | "edit";
  amount: number;
}) {
  const [open, setOpen] = useState(value.kind !== "single");

  const installmentAllowed = accountIsCreditCard && isExpense;

  if (!open && value.kind === "single") {
    return (
      <button
        type="button"
        className="text-xs text-primary hover:underline"
        onClick={() => setOpen(true)}
      >
        + Transformar em recorrência ou parcelamento
      </button>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <div className="flex items-center justify-between">
        <Label className="text-xs">Tipo</Label>
        <button
          type="button"
          className="text-xs text-muted-foreground hover:text-foreground"
          onClick={() => {
            onChange({ ...value, kind: "single" });
            setOpen(false);
          }}
        >
          cancelar
        </button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <FilterPill
          active={value.kind === "single"}
          onClick={() => onChange({ ...value, kind: "single" })}
        >
          Único
        </FilterPill>
        <FilterPill
          active={value.kind === "recurring"}
          onClick={() => onChange({ ...value, kind: "recurring" })}
        >
          Recorrente
        </FilterPill>
        <FilterPill
          active={value.kind === "installment"}
          onClick={() => {
            if (!installmentAllowed) return;
            onChange({ ...value, kind: "installment" });
          }}
          className={!installmentAllowed ? "opacity-40 cursor-not-allowed" : ""}
        >
          Parcelado
        </FilterPill>
      </div>

      {value.kind === "recurring" && (
        <div className="space-y-1.5">
          <Label className="text-xs">Frequência</Label>
          <Select
            value={value.frequency}
            onValueChange={(v) => onChange({ ...value, frequency: v as ExtrasFrequency })}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="weekly">Semanal</SelectItem>
              <SelectItem value="monthly">Mensal</SelectItem>
              <SelectItem value="yearly">Anual</SelectItem>
            </SelectContent>
          </Select>
          {mode === "edit" && (
            <p className="text-[11px] text-muted-foreground">
              O lançamento atual ficará vinculado à recorrência. A próxima ocorrência será gerada na data correspondente.
            </p>
          )}
        </div>
      )}

      {value.kind === "installment" && (
        <>
          <div className="space-y-1.5">
            <Label className="text-xs">Número de parcelas</Label>
            <Input
              type="number"
              min={2}
              max={360}
              value={value.installments_count}
              onChange={(e) =>
                onChange({
                  ...value,
                  installments_count: Math.max(2, Number(e.target.value) || 2),
                })
              }
            />
            {amount > 0 && (
              <p className="text-xs text-muted-foreground">
                {value.installments_count}× de {formatBRL(amount / value.installments_count)}
              </p>
            )}
          </div>
          {mode === "edit" && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 flex gap-2 text-xs">
              <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
              <span className="text-foreground/90">
                Isto vai <strong>substituir</strong> o lançamento atual por uma compra parcelada. O lançamento original será removido e novas parcelas serão geradas a partir da data atual.
              </span>
            </div>
          )}
          {!installmentAllowed && (
            <p className="text-[11px] text-muted-foreground">
              Parcelamento só é possível em despesa de cartão de crédito.
            </p>
          )}
        </>
      )}
    </div>
  );
}
