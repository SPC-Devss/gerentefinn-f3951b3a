import { createFileRoute } from "@tanstack/react-router";
import { requireAuth } from "@/lib/require-auth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { listGoals, createGoal, addGoalProgress, deleteGoal } from "@/lib/goals.functions";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Target, Plus, Trash2, CheckCircle2 } from "lucide-react";
import { formatBRL, formatDate } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/goals")({
  beforeLoad: requireAuth,
  component: GoalsPage,
  head: () => ({ meta: [{ title: "Metas — Finn" }] }),
});

function GoalsPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);
  const [progressTarget, setProgressTarget] = useState<{ id: string; name: string } | null>(null);
  const [progressValue, setProgressValue] = useState<string>("");

  const q = useQuery({ queryKey: ["goals"], queryFn: () => listGoals() });

  const del = useMutation({
    mutationFn: (id: string) => deleteGoal({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["goals"] });
      toast.success("Meta removida");
      setPendingDelete(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addProg = useMutation({
    mutationFn: ({ id, amount }: { id: string; amount: number }) => addGoalProgress({ data: { id, amount } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["goals"] });
      toast.success("Progresso atualizado");
      setProgressTarget(null);
      setProgressValue("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const progressNumber = Number(String(progressValue).replace(",", "."));
  const progressValid = Number.isFinite(progressNumber) && progressNumber > 0;

  return (
    <AppShell
      title="Metas"
      subtitle="Acompanhe seu progresso financeiro"
      action={
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-1" /> Nova meta</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Nova meta</DialogTitle></DialogHeader>
            <GoalForm onDone={() => { setOpen(false); qc.invalidateQueries({ queryKey: ["goals"] }); }} />
          </DialogContent>
        </Dialog>
      }
    >
      {!q.data ? (
        <div className="text-muted-foreground text-sm">Carregando…</div>
      ) : q.data.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-12 text-center">
          <Target className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
          <p className="font-medium">Nenhuma meta ainda</p>
          <p className="text-sm text-muted-foreground mt-1">Crie metas para guardar dinheiro, viajar ou pagar dívidas.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {q.data.map((g) => {
            const cur = Number(g.current_amount);
            const tgt = Number(g.target_amount);
            const pct = Math.min(100, (cur / tgt) * 100);
            const done = g.status === "completed";
            return (
              <div key={g.id} className="tile p-4 group relative">
                <button
                  onClick={() => setPendingDelete({ id: g.id, name: g.name })}
                  className="absolute top-2 right-2 p-1.5 rounded opacity-0 group-hover:opacity-100 hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition"
                  aria-label="Remover meta"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
                <div className="flex items-center gap-2 mb-2">
                  {done ? <CheckCircle2 className="h-5 w-5 text-success" /> : <Target className="h-5 w-5 text-primary" />}
                  <div className="font-medium">{g.name}</div>
                </div>
                <div className="flex items-end justify-between mb-2">
                  <div>
                    <div className="text-2xl font-display font-semibold tabular-nums">{formatBRL(cur)}</div>
                    <div className="text-xs text-muted-foreground">de {formatBRL(tgt)}</div>
                  </div>
                  <div className="text-xs text-muted-foreground text-right">
                    <div className="font-medium text-foreground tabular-nums">{pct.toFixed(0)}%</div>
                    {g.deadline && <div>até {formatDate(g.deadline)}</div>}
                  </div>
                </div>
                <Progress value={pct} className="mb-3" />
                {!done && (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      className="flex-1"
                      onClick={() => {
                        setProgressTarget({ id: g.id, name: g.name });
                        setProgressValue("");
                      }}
                    >
                      Adicionar valor
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Confirmação de exclusão */}
      <Dialog open={!!pendingDelete} onOpenChange={(o) => { if (!o && !del.isPending) setPendingDelete(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remover meta?</DialogTitle>
            <DialogDescription>
              A meta “{pendingDelete?.name}” será removida. Esta ação não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDelete(null)} disabled={del.isPending}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => pendingDelete && del.mutate(pendingDelete.id)}
              disabled={del.isPending}
            >
              {del.isPending ? "Removendo…" : "Remover"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Diálogo para adicionar progresso */}
      <Dialog
        open={!!progressTarget}
        onOpenChange={(o) => {
          if (!o && !addProg.isPending) { setProgressTarget(null); setProgressValue(""); }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adicionar valor</DialogTitle>
            <DialogDescription>
              Quanto adicionar em “{progressTarget?.name}”?
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="progress-amount">Valor (R$)</Label>
            <Input
              id="progress-amount"
              type="number"
              min={0}
              step="0.01"
              autoFocus
              value={progressValue}
              onChange={(e) => setProgressValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && progressValid && progressTarget) {
                  addProg.mutate({ id: progressTarget.id, amount: progressNumber });
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setProgressTarget(null); setProgressValue(""); }}
              disabled={addProg.isPending}
            >
              Cancelar
            </Button>
            <Button
              onClick={() => progressTarget && addProg.mutate({ id: progressTarget.id, amount: progressNumber })}
              disabled={!progressValid || addProg.isPending}
            >
              {addProg.isPending ? "Salvando…" : "Adicionar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function GoalForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [current, setCurrent] = useState("0");
  const [deadline, setDeadline] = useState("");

  const mut = useMutation({
    mutationFn: () =>
      createGoal({
        data: {
          name,
          target_amount: Number(target),
          current_amount: Number(current) || 0,
          deadline: deadline || null,
        },
      }),
    onSuccess: () => { toast.success("Meta criada"); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <form onSubmit={(e) => { e.preventDefault(); if (!name || !Number(target)) return; mut.mutate(); }} className="space-y-3">
      <div className="space-y-1.5"><Label>Nome</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Viagem para Lisboa" autoFocus /></div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5"><Label>Objetivo (R$)</Label><Input type="number" min={1} value={target} onChange={(e) => setTarget(e.target.value)} /></div>
        <div className="space-y-1.5"><Label>Já tenho (R$)</Label><Input type="number" min={0} value={current} onChange={(e) => setCurrent(e.target.value)} /></div>
      </div>
      <div className="space-y-1.5"><Label>Prazo (opcional)</Label><Input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} /></div>
      <Button type="submit" className="w-full" disabled={!name || !Number(target) || mut.isPending}>
        {mut.isPending ? "Criando…" : "Criar meta"}
      </Button>
    </form>
  );
}
