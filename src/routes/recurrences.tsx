import { createFileRoute } from "@tanstack/react-router";
import { requireAuth } from "@/lib/require-auth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  listRecurrences, createRecurrence, toggleRecurrence, deleteRecurrence, materializeDue,
} from "@/lib/recurrences.functions";
import { listCategories } from "@/lib/categories.functions";
import { listAccounts } from "@/lib/accounts.functions";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Repeat, Plus, Trash2, TrendingUp, TrendingDown, RefreshCw } from "lucide-react";
import { formatBRL, formatDate } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/recurrences")({
  beforeLoad: requireAuth,
  component: RecurrencesPage,
  head: () => ({ meta: [{ title: "Recorrências — Finn" }] }),
});

const FREQ_LABELS: Record<string, string> = { weekly: "Semanal", monthly: "Mensal", yearly: "Anual" };

function RecurrencesPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ["recurrences"], queryFn: () => listRecurrences() });

  const toggle = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => toggleRecurrence({ data: { id, active } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["recurrences"] }),
  });

  const del = useMutation({
    mutationFn: (id: string) => deleteRecurrence({ data: { id } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["recurrences"] }); toast.success("Recorrência removida"); },
  });

  const run = useMutation({
    mutationFn: () => materializeDue(),
    onSuccess: (r) => { toast.success(`${r.inserted} transação(ões) geradas`); qc.invalidateQueries({ queryKey: ["recurrences"] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); qc.invalidateQueries({ queryKey: ["summary"] }); },
  });

  return (
    <AppShell
      title="Recorrências"
      subtitle="Assinaturas, salário e outras movimentações repetitivas"
      action={
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => run.mutate()} disabled={run.isPending}>
            <RefreshCw className={`h-4 w-4 mr-1 ${run.isPending ? "animate-spin" : ""}`} /> Rodar pendentes
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-1" /> Nova</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Nova recorrência</DialogTitle></DialogHeader>
              <RecurrenceForm onDone={() => { setOpen(false); qc.invalidateQueries({ queryKey: ["recurrences"] }); }} />
            </DialogContent>
          </Dialog>
        </div>
      }
    >
      {!q.data ? (
        <div className="text-muted-foreground text-sm">Carregando…</div>
      ) : q.data.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-12 text-center">
          <Repeat className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
          <p className="font-medium">Nenhuma recorrência cadastrada</p>
          <p className="text-sm text-muted-foreground mt-1">Cadastre seu salário, aluguel, assinaturas etc.</p>
        </div>
      ) : (
        <div className="tile divide-y divide-border overflow-hidden">
          {q.data.map((r) => {
            const exp = r.type === "expense";
            return (
              <div key={r.id} className="flex items-center gap-3 p-4 group">
                <div className={`h-9 w-9 rounded-lg flex items-center justify-center ${exp ? "bg-destructive/15 text-destructive" : "bg-success/15 text-success"}`}>
                  {exp ? <TrendingDown className="h-4 w-4" /> : <TrendingUp className="h-4 w-4" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">{r.description}</div>
                  <div className="text-xs text-muted-foreground">
                    {FREQ_LABELS[r.frequency]} · próxima em {formatDate(r.next_run_at)}
                    {(r.categories as { name?: string } | null)?.name ? ` · ${(r.categories as { name: string }).name}` : ""}
                  </div>
                </div>
                <div className={`tabular-nums font-semibold ${exp ? "text-destructive" : "text-success"}`}>
                  {exp ? "-" : "+"}{formatBRL(Number(r.amount))}
                </div>
                <Switch checked={r.active} onCheckedChange={(v) => toggle.mutate({ id: r.id, active: v })} />
                <button
                  onClick={() => { if (confirm(`Remover "${r.description}"?`)) del.mutate(r.id); }}
                  className="opacity-0 group-hover:opacity-100 p-1.5 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}

function RecurrenceForm({ onDone }: { onDone: () => void }) {
  const [description, setDescription] = useState("");
  const [type, setType] = useState<"income" | "expense">("expense");
  const [amount, setAmount] = useState("");
  const [frequency, setFrequency] = useState<"weekly" | "monthly" | "yearly">("monthly");
  const [nextDate, setNextDate] = useState(new Date().toISOString().slice(0, 10));
  const [categoryId, setCategoryId] = useState<string>("");
  const [accountId, setAccountId] = useState<string>("");

  const cats = useQuery({ queryKey: ["categories"], queryFn: () => listCategories() });
  const accs = useQuery({ queryKey: ["accounts"], queryFn: () => listAccounts() });

  const mut = useMutation({
    mutationFn: () =>
      createRecurrence({
        data: {
          description,
          type,
          amount: Number(amount),
          frequency,
          next_run_at: nextDate,
          category_id: categoryId || null,
          account_id: accountId || null,
        },
      }),
    onSuccess: () => { toast.success("Recorrência criada"); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <form onSubmit={(e) => { e.preventDefault(); if (!description || !Number(amount)) return; mut.mutate(); }} className="space-y-3">
      <div className="space-y-1.5"><Label>Descrição</Label><Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ex: Netflix" autoFocus /></div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Tipo</Label>
          <Select value={type} onValueChange={(v) => setType(v as typeof type)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="expense">Despesa</SelectItem>
              <SelectItem value="income">Receita</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5"><Label>Valor (R$)</Label><Input type="number" min={0.01} step={0.01} value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Frequência</Label>
          <Select value={frequency} onValueChange={(v) => setFrequency(v as typeof frequency)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="weekly">Semanal</SelectItem>
              <SelectItem value="monthly">Mensal</SelectItem>
              <SelectItem value="yearly">Anual</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5"><Label>Próxima data</Label><Input type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} /></div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Categoria</Label>
          <Select value={categoryId} onValueChange={setCategoryId}>
            <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent>
              {(cats.data ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.icon ? `${c.icon} ` : ""}{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Conta</Label>
          <Select value={accountId} onValueChange={setAccountId}>
            <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent>
              {(accs.data ?? []).map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <Button type="submit" className="w-full" disabled={!description || !Number(amount) || mut.isPending}>
        {mut.isPending ? "Criando…" : "Criar recorrência"}
      </Button>
    </form>
  );
}
