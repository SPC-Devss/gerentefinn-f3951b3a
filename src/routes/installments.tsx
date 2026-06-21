import { createFileRoute } from "@tanstack/react-router";
import { requireAuth } from "@/lib/require-auth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  listInstallments,
  createInstallmentPurchase,
  updateInstallmentPurchase,
  deleteInstallmentPurchase,
  toggleInstallmentItemPaid,
} from "@/lib/installments.functions";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Pencil, CreditCard, Calendar, Check, X } from "lucide-react";
import { formatBRL, formatDate } from "@/lib/format";
import { toast } from "sonner";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { FilterPill } from "@/components/filter-pill";

export const Route = createFileRoute("/installments")({
  beforeLoad: requireAuth,
  component: InstallmentsPage,
  head: () => ({ meta: [{ title: "Parcelas — Finn" }] }),
});

type Filter = { kind: "all" } | { kind: "month"; value: string } | { kind: "year"; value: string } | { kind: "account"; value: string };

function todayMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function todayYear() {
  return String(new Date().getFullYear());
}
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function InstallmentsPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>({ kind: "all" });
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<null | {
    id: string;
    description: string;
    total_amount: string;
    installments_count: string;
    first_due_date: string;
    account_id: string;
    category_id: string;
    notes: string;
  }>(null);

  const queryParams = useMemo(() => {
    if (filter.kind === "month") return { month: filter.value };
    if (filter.kind === "year") return { year: filter.value };
    if (filter.kind === "account") return { account_id: filter.value };
    return {};
  }, [filter]);

  const q = useQuery({
    queryKey: ["installments", queryParams],
    queryFn: () => listInstallments({ data: queryParams }),
  });

  // base (unfiltered) accounts list for filters & form
  const baseQ = useQuery({
    queryKey: ["installments", "base"],
    queryFn: () => listInstallments({ data: {} }),
  });
  const accounts = baseQ.data?.accounts ?? [];
  const categories = baseQ.data?.categories ?? [];

  const invalidateAll = () => qc.invalidateQueries({ queryKey: ["installments"] });

  type PurchaseInput = {
    description: string;
    total_amount: number;
    installments_count: number;
    first_due_date: string;
    account_id: string | null;
    category_id: string | null;
    notes: string | null;
  };

  const createM = useMutation({
    mutationFn: (v: PurchaseInput) => createInstallmentPurchase({ data: v }),
    onSuccess: () => {
      toast.success("Compra parcelada criada");
      setCreateOpen(false);
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateM = useMutation({
    mutationFn: (v: PurchaseInput & { id: string; regenerate?: boolean }) => updateInstallmentPurchase({ data: v }),
    onSuccess: () => {
      toast.success("Atualizado");
      setEditing(null);
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteM = useMutation({
    mutationFn: (id: string) => deleteInstallmentPurchase({ data: { id } }),
    onSuccess: () => {
      toast.success("Removido");
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleM = useMutation({
    mutationFn: (v: { id: string; paid: boolean }) => toggleInstallmentItemPaid({ data: v }),
    onSuccess: invalidateAll,
  });

  const monthOptions = useMemo(() => {
    const months: string[] = [];
    const now = new Date();
    for (let i = -6; i <= 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }
    return months;
  }, []);

  const yearOptions = useMemo(() => {
    const y = new Date().getFullYear();
    return [y - 1, y, y + 1, y + 2, y + 3];
  }, []);

  return (
    <AppShell
      title="Parcelas"
      subtitle="Controle das suas compras parceladas — pagas e a vencer."
      action={
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" /> Nova compra parcelada
            </Button>
          </DialogTrigger>
          <PurchaseForm
            mode="create"
            accounts={accounts}
            categories={categories}
            onSubmit={(v) => createM.mutate(v)}
            pending={createM.isPending}
          />
        </Dialog>
      }
    >
      {/* Filters */}
      <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 mb-5">
        <FilterPill active={filter.kind === "all"} onClick={() => setFilter({ kind: "all" })} className="col-span-2 sm:col-span-1">
          Visão geral
        </FilterPill>
        <Select
          value={filter.kind === "month" ? filter.value : ""}
          onValueChange={(v) => v && setFilter({ kind: "month", value: v })}
        >
          <SelectTrigger className={`w-full sm:w-[160px] h-9 ${filter.kind === "month" ? "ring-2 ring-primary" : ""}`}>
            <SelectValue placeholder="Por mês" />
          </SelectTrigger>
          <SelectContent>
            {monthOptions.map((m) => (
              <SelectItem key={m} value={m}>
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filter.kind === "year" ? filter.value : ""}
          onValueChange={(v) => v && setFilter({ kind: "year", value: v })}
        >
          <SelectTrigger className={`w-full sm:w-[120px] h-9 ${filter.kind === "year" ? "ring-2 ring-primary" : ""}`}>
            <SelectValue placeholder="Por ano" />
          </SelectTrigger>
          <SelectContent>
            {yearOptions.map((y) => (
              <SelectItem key={y} value={String(y)}>
                {y}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filter.kind === "account" ? filter.value : ""}
          onValueChange={(v) => v && setFilter({ kind: "account", value: v })}
        >
          <SelectTrigger className={`w-full sm:w-[200px] h-9 ${filter.kind === "account" ? "ring-2 ring-primary" : ""}`}>
            <SelectValue placeholder="Por cartão/conta" />
          </SelectTrigger>
          <SelectContent>
            {accounts.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {filter.kind !== "all" && (
          <Button variant="ghost" size="sm" onClick={() => setFilter({ kind: "all" })}>
            <X className="h-4 w-4 mr-1" /> Limpar
          </Button>
        )}
      </div>

      {/* Totals card */}
      <div className="border border-border rounded-lg p-5 bg-card mb-4">
        <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Total comprometido</p>
        <p className="font-display text-3xl font-semibold">{formatBRL(q.data?.totalCommitted ?? 0)}</p>
        <p className="text-xs text-muted-foreground mt-1">Soma de todas as parcelas ainda não pagas{filter.kind !== "all" ? " (filtro aplicado)" : ""}.</p>
      </div>

      {/* Future commitment chart */}
      {q.data && q.data.byMonth.length > 0 && (
        <div className="border border-border rounded-lg p-4 bg-card mb-4">
          <h3 className="font-medium mb-3">Comprometimento futuro</h3>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={q.data.byMonth}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 6 }}
                  formatter={(v) => formatBRL(Number(v))}
                />
                <Bar dataKey="amount" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Purchases list */}
      <div className="border border-border rounded-lg bg-card">
        <div className="p-4 border-b border-border">
          <h3 className="font-medium">Compras ativas</h3>
        </div>
        {q.isLoading && <p className="p-6 text-muted-foreground">Carregando...</p>}
        {q.data && q.data.purchases.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <CreditCard className="h-10 w-10 mx-auto mb-3 opacity-40" />
            <p>Nenhuma compra parcelada {filter.kind !== "all" ? "neste filtro" : "ainda"}.</p>
          </div>
        )}
        <div className="divide-y divide-border">
          {q.data?.purchases.map((p) => {
            const pct = p.installments_count > 0 ? (p.paid_count / p.installments_count) * 100 : 0;
            const monthlyValue = p.items[0]?.amount ?? Number(p.total_amount) / p.installments_count;
            const accColor = p.account?.color ?? "#4f46e5";
            return (
              <div key={p.id} className="p-4">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium uppercase tracking-wide truncate">{p.description}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {p.category?.name ?? "Sem categoria"} · {formatBRL(monthlyValue)} / mês
                      {p.account && <> · <span style={{ color: accColor }}>{p.account.name}</span></>}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-semibold">{formatBRL(Number(p.total_amount))}</div>
                    <div className="text-xs text-muted-foreground">total</div>
                  </div>
                </div>
                <div className="text-xs text-muted-foreground mb-1.5">
                  {p.paid_count}/{p.installments_count} pagas · Falta {formatBRL(p.remaining_amount)} · quita em {formatDate(p.last_due_date)}
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden mb-3">
                  <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                </div>

                {/* Items grid */}
                <details className="mb-3">
                  <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">Ver parcelas</summary>
                  <div className="mt-2 grid gap-1 grid-cols-1 sm:grid-cols-2">
                    {p.items.map((it) => (
                      <button
                        key={it.id}
                        onClick={() => toggleM.mutate({ id: it.id, paid: !it.paid })}
                        className={`flex items-center justify-between text-xs p-2 rounded border transition ${
                          it.paid
                            ? "bg-primary/10 border-primary/30 text-foreground"
                            : "bg-background border-border hover:bg-accent/30"
                        }`}
                      >
                        <span className="flex items-center gap-2">
                          <span className={`h-4 w-4 rounded-sm border flex items-center justify-center ${it.paid ? "bg-primary border-primary text-primary-foreground" : "border-muted-foreground/40"}`}>
                            {it.paid && <Check className="h-3 w-3" />}
                          </span>
                          <span className="font-medium">{it.number}/{p.installments_count}</span>
                          <span className="text-muted-foreground">{formatDate(it.due_date)}</span>
                        </span>
                        <span className={it.paid ? "line-through text-muted-foreground" : "font-medium"}>{formatBRL(Number(it.amount))}</span>
                      </button>
                    ))}
                  </div>
                </details>

                <div className="flex gap-2 justify-end">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setEditing({
                        id: p.id,
                        description: p.description,
                        total_amount: String(p.total_amount),
                        installments_count: String(p.installments_count),
                        first_due_date: p.first_due_date,
                        account_id: p.account_id ?? "",
                        category_id: p.category_id ?? "",
                        notes: p.notes ?? "",
                      })
                    }
                  >
                    <Pencil className="h-3.5 w-3.5 mr-1.5" /> Editar
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      if (confirm("Excluir esta compra parcelada e todas as suas parcelas?")) deleteM.mutate(p.id);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Excluir
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Edit dialog */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        {editing && (
          <PurchaseForm
            mode="edit"
            initial={editing}
            accounts={accounts}
            categories={categories}
            onSubmit={(v) => updateM.mutate({ id: editing.id, regenerate: true, ...v })}
            pending={updateM.isPending}
          />
        )}
      </Dialog>
    </AppShell>
  );
}

function FilterPill({ active, onClick, children, className }: { active: boolean; onClick: () => void; children: React.ReactNode; className?: string }) {
  return (
    <button
      onClick={onClick}
      className={`h-9 px-3 rounded-md text-sm border transition ${
        active ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border hover:bg-accent/40"
      } ${className ?? ""}`}
    >
      {children}
    </button>
  );
}


function PurchaseForm({
  mode,
  initial,
  accounts,
  categories,
  onSubmit,
  pending,
}: {
  mode: "create" | "edit";
  initial?: {
    description: string;
    total_amount: string;
    installments_count: string;
    first_due_date: string;
    account_id: string;
    category_id: string;
    notes: string;
  };
  accounts: { id: string; name: string }[];
  categories: { id: string; name: string }[];
  onSubmit: (v: {
    description: string;
    total_amount: number;
    installments_count: number;
    first_due_date: string;
    account_id: string | null;
    category_id: string | null;
    notes: string | null;
  }) => void;
  pending: boolean;
}) {
  const [description, setDescription] = useState(initial?.description ?? "");
  const [total, setTotal] = useState(initial?.total_amount ?? "");
  const [count, setCount] = useState(initial?.installments_count ?? "");
  const [firstDate, setFirstDate] = useState(initial?.first_due_date ?? todayISO());
  const [accountId, setAccountId] = useState(initial?.account_id ?? "");
  const [categoryId, setCategoryId] = useState(initial?.category_id ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");

  return (
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle>{mode === "create" ? "Nova compra parcelada" : "Editar compra parcelada"}</DialogTitle>
        <DialogDescription>
          {mode === "edit"
            ? "As parcelas ainda não pagas serão recriadas com base nos novos valores."
            : "Informe o valor total e o número de parcelas — o sistema gera o cronograma."}
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div>
          <Label>Descrição</Label>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ex: Geladeira" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Valor total (R$)</Label>
            <Input type="number" step="0.01" value={total} onChange={(e) => setTotal(e.target.value)} />
          </div>
          <div>
            <Label>Nº de parcelas</Label>
            <Input type="number" min="1" max="360" value={count} onChange={(e) => setCount(e.target.value)} />
          </div>
        </div>
        <div>
          <Label className="flex items-center gap-1.5"><Calendar className="h-3.5 w-3.5" /> 1ª parcela vence em</Label>
          <Input type="date" value={firstDate} onChange={(e) => setFirstDate(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Cartão / conta</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger>
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Categoria</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger>
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div>
          <Label>Observações (opcional)</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </div>
      </div>
      <DialogFooter>
        <Button
          onClick={() =>
            onSubmit({
              description: description.trim(),
              total_amount: Number(total),
              installments_count: Number(count),
              first_due_date: firstDate,
              account_id: accountId || null,
              category_id: categoryId || null,
              notes: notes.trim() || null,
            })
          }
          disabled={!description || !total || !count || !firstDate || pending}
        >
          {pending ? "Salvando..." : "Salvar"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
