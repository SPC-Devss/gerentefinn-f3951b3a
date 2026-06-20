import { createFileRoute } from "@tanstack/react-router";
import { requireAuth } from "@/lib/require-auth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { listBudgets, upsertBudget, deleteBudget } from "@/lib/budgets.functions";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { Plus, Trash2, Target, Pencil } from "lucide-react";
import { formatBRL } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/budgets")({
  beforeLoad: requireAuth,
  component: BudgetsPage,
  head: () => ({ meta: [{ title: "Orçamentos — Finn" }] }),
});

const MONTHS = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

type EditState = {
  mode: "create" | "edit";
  id: string | null;
  category_id: string;
  amount: string;
};

const EMPTY_EDIT: EditState = { mode: "create", id: null, category_id: "", amount: "" };

function BudgetsPage() {
  const qc = useQueryClient();
  const now = new Date();
  const [month, setMonth] = useState<number>(now.getMonth() + 1); // 1-12
  const [year, setYear] = useState<number>(now.getFullYear());

  const monthIso = `${year}-${String(month).padStart(2, "0")}-01`;

  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<EditState>(EMPTY_EDIT);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);

  const q = useQuery({
    queryKey: ["budgets", monthIso],
    queryFn: () => listBudgets({ data: { month: monthIso } }),
  });
  const data = q.data;

  const upsertM = useMutation({
    mutationFn: () =>
      upsertBudget({
        data: {
          category_id: edit.category_id,
          amount: Number(String(edit.amount).replace(",", ".")),
          month: monthIso,
        },
      }),
    onSuccess: () => {
      toast.success(edit.mode === "edit" ? "Orçamento atualizado" : "Orçamento salvo");
      qc.invalidateQueries({ queryKey: ["budgets"] });
      setOpen(false);
      setEdit(EMPTY_EDIT);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const delM = useMutation({
    mutationFn: (id: string) => deleteBudget({ data: { id } }),
    onSuccess: () => {
      toast.success("Orçamento removido");
      qc.invalidateQueries({ queryKey: ["budgets"] });
      setPendingDelete(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const usedCategoryIds = useMemo(
    () => new Set((data?.items ?? []).map((i) => i.category_id)),
    [data],
  );
  const availableCats = (data?.categories ?? []).filter((c) => {
    // when editing, keep current category in the list
    if (edit.mode === "edit" && c.id === edit.category_id) return true;
    return !usedCategoryIds.has(c.id);
  });

  const years = useMemo(() => {
    const y = now.getFullYear();
    return [y - 2, y - 1, y, y + 1];
  }, [now]);

  function openCreate() {
    setEdit(EMPTY_EDIT);
    setOpen(true);
  }
  function openEdit(item: { id: string; category_id: string; amount: number }) {
    setEdit({
      mode: "edit",
      id: item.id,
      category_id: item.category_id,
      amount: String(item.amount),
    });
    setOpen(true);
  }

  const amountValid = Number(String(edit.amount).replace(",", ".")) > 0;

  return (
    <AppShell
      title="Orçamentos"
      subtitle="Defina um teto mensal por categoria e acompanhe o quanto já foi gasto."
      action={
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-2" /> Novo orçamento
        </Button>
      }
    >
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Mês</Label>
          <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              {MONTHS.map((label, idx) => (
                <SelectItem key={idx} value={String(idx + 1)}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Ano</Label>
          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
            <SelectContent>
              {years.map((y) => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {q.isLoading && <p className="text-muted-foreground">Carregando...</p>}
      {data && data.items.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <Target className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p>Nenhum orçamento definido para este mês.</p>
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {data?.items.map((b) => {
          const colorClass =
            b.pct >= 100 ? "bg-destructive" : b.pct >= 80 ? "bg-yellow-500" : "bg-primary";
          const remaining = b.amount - b.spent;
          return (
            <div key={b.id} className="border border-border rounded-lg p-4 bg-card">
              <div className="flex items-center justify-between mb-2">
                <div className="font-medium">{b.category_name}</div>
                <div className="flex items-center gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => openEdit({ id: b.id, category_id: b.category_id, amount: b.amount })}
                    aria-label="Editar"
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setPendingDelete({ id: b.id, name: b.category_name })}
                    aria-label="Excluir"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div className={`h-full ${colorClass} transition-all`} style={{ width: `${Math.min(100, b.pct)}%` }} />
              </div>
              <div className="flex justify-between text-sm mt-2">
                <span className="text-muted-foreground">
                  {formatBRL(b.spent)} / {formatBRL(b.amount)}
                </span>
                <span className={remaining < 0 ? "text-destructive font-medium" : "text-muted-foreground"}>
                  {remaining < 0 ? `Excedeu ${formatBRL(-remaining)}` : `Resta ${formatBRL(remaining)}`}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <Dialog open={open} onOpenChange={(o) => { if (!o) { setOpen(false); setEdit(EMPTY_EDIT); } else setOpen(true); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{edit.mode === "edit" ? "Editar limite" : "Definir limite"}</DialogTitle>
            <DialogDescription>
              {MONTHS[month - 1]} de {year}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Categoria</Label>
              <Select
                value={edit.category_id}
                onValueChange={(v) => setEdit((e) => ({ ...e, category_id: v }))}
                disabled={edit.mode === "edit"}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Escolha uma categoria" />
                </SelectTrigger>
                <SelectContent>
                  {availableCats.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Limite mensal (R$)</Label>
              <Input
                type="number"
                step="0.01"
                value={edit.amount}
                onChange={(e) => setEdit((s) => ({ ...s, amount: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setOpen(false); setEdit(EMPTY_EDIT); }}>
              Cancelar
            </Button>
            <Button
              onClick={() => upsertM.mutate()}
              disabled={!edit.category_id || !amountValid || upsertM.isPending}
            >
              {upsertM.isPending ? "Salvando…" : edit.mode === "edit" ? "Salvar alterações" : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!pendingDelete} onOpenChange={(o) => { if (!o && !delM.isPending) setPendingDelete(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remover orçamento?</DialogTitle>
            <DialogDescription>
              O orçamento de “{pendingDelete?.name}” será removido. Esta ação não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDelete(null)} disabled={delM.isPending}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => pendingDelete && delM.mutate(pendingDelete.id)}
              disabled={delM.isPending}
            >
              {delM.isPending ? "Removendo…" : "Remover"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
