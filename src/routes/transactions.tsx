import { createFileRoute, Link } from "@tanstack/react-router";
import { requireAuth } from "@/lib/require-auth";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { listTransactions, createTransaction, updateTransaction, deleteTransaction, deleteTransactionsBulk, checkDuplicateTransaction } from "@/lib/transactions.functions";
import { createTransfer } from "@/lib/transfers.functions";
import { listCategories, createCategory, deleteCategory } from "@/lib/categories.functions";
import { listAccounts } from "@/lib/accounts.functions";
import { createInstallmentPurchase, convertTransactionToInstallment } from "@/lib/installments.functions";
import { createRecurrence } from "@/lib/recurrences.functions";

import { Pencil, Trash2, Plus, Search, Printer, Upload, Repeat, Layers } from "lucide-react";
import { formatBRL } from "@/lib/format";
import { toast } from "sonner";
import { TransactionExtras, DEFAULT_EXTRAS, type TransactionExtrasValue } from "@/components/transaction-extras";

export const Route = createFileRoute("/transactions")({
  beforeLoad: requireAuth,
  component: TransactionsPage,
  head: () => ({ meta: [{ title: "Lançamentos — Finn" }] }),
});

type Draft = {
  id: string;
  type: "income" | "expense" | "transfer";
  amount: number;
  description: string;
  occurred_at: string;
  category_id: string | null;
  account_id: string | null;
  recurrence_id: string | null;
};

type AccountKind = "all" | "credit_card" | "non_credit";

const MONTHS = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

function nextOccurrenceIso(iso: string, freq: "weekly" | "monthly" | "yearly"): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (freq === "weekly") {
    return new Date(Date.UTC(y, m - 1, d + 7)).toISOString().slice(0, 10);
  }
  if (freq === "yearly") {
    return new Date(Date.UTC(y + 1, m - 1, d)).toISOString().slice(0, 10);
  }
  // monthly: clamp dia ao último dia do mês alvo
  const dt = new Date(Date.UTC(y, m, 1));
  const last = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
  dt.setUTCDate(Math.min(d, last));
  return dt.toISOString().slice(0, 10);
}

function TransactionsPage() {
  const qc = useQueryClient();
  const txs = useQuery({ queryKey: ["transactions", "all"], queryFn: () => listTransactions() });
  const cats = useQuery({ queryKey: ["categories"], queryFn: () => listCategories() });
  const accs = useQuery({ queryKey: ["accounts"], queryFn: () => listAccounts() });

  const now = new Date();
  const [search, setSearch] = useState("");
  const [month, setMonth] = useState<string>(String(now.getMonth() + 1));
  const [year, setYear] = useState<string>(String(now.getFullYear()));
  const [kind, setKind] = useState<AccountKind>("all");
  const [edit, setEdit] = useState<Draft | null>(null);
  const [editExtras, setEditExtras] = useState<TransactionExtrasValue>({ ...DEFAULT_EXTRAS });
  const [convertConfirm, setConvertConfirm] = useState<{ count: number; description: string; amount: number } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [newCat, setNewCat] = useState("");
  const [newIcon, setNewIcon] = useState("");

  // New manual launch
  const todayIso = new Date().toISOString().slice(0, 10);
  const [createOpen, setCreateOpen] = useState(false);
  const emptyForm = {
    type: "expense" as "income" | "expense" | "transfer",
    description: "",
    amount: "" as string,
    occurred_at: todayIso,
    accountKind: "checking" as "checking" | "credit_card",
    account_id: "" as string,
    transfer_to: "" as string,
    category_id: "" as string,
    extras: { ...DEFAULT_EXTRAS } as TransactionExtrasValue,
  };
  const [form, setForm] = useState(emptyForm);

  const [quickCatOpen, setQuickCatOpen] = useState(false);
  const [quickCatName, setQuickCatName] = useState("");
  const [quickCatIcon, setQuickCatIcon] = useState("");
  const [dupExisting, setDupExisting] = useState<{
    id: string;
    description: string | null;
    occurred_at: string;
    amount: number;
    type: string;
  } | null>(null);


  const years = useMemo(() => {
    const set = new Set<number>();
    set.add(now.getFullYear());
    for (const t of txs.data ?? []) set.add(new Date(t.occurred_at).getFullYear());
    return Array.from(set).sort((a, b) => b - a);
  }, [txs.data, now]);

  const filtered = useMemo(() => {
    if (!txs.data) return [];
    const s = search.toLowerCase().trim();
    return txs.data.filter((t) => {
      if (s) {
        const acc = (t as { accounts?: { name?: string } | null }).accounts;
        const cat = (t as { categories?: { name?: string } | null }).categories;
        const amt = Number(t.amount);
        const haystack = [
          t.description,
          acc?.name ?? "",
          cat?.name ?? "",
          String(amt),
          amt.toFixed(2),
          amt.toFixed(2).replace(".", ","),
          formatBRL(amt),
        ].join(" ").toLowerCase();
        if (!haystack.includes(s)) return false;
      }
      const d = new Date(t.occurred_at + "T00:00:00");
      if (year !== "all" && d.getFullYear() !== Number(year)) return false;
      if (month !== "all" && d.getMonth() + 1 !== Number(month)) return false;
      const accType = (t as { accounts?: { type?: string } | null }).accounts?.type;
      if (kind === "credit_card" && accType !== "credit_card") return false;
      if (kind === "non_credit" && accType === "credit_card") return false;
      return true;
    });
  }, [txs.data, search, month, year, kind]);

  const filteredIds = useMemo(() => filtered.map((t) => t.id), [filtered]);
  const allSelected = filteredIds.length > 0 && filteredIds.every((id) => selected.has(id));
  const someSelected = filteredIds.some((id) => selected.has(id));

  const toggleAll = (checked: boolean) => {
    const next = new Set(selected);
    if (checked) filteredIds.forEach((id) => next.add(id));
    else filteredIds.forEach((id) => next.delete(id));
    setSelected(next);
  };

  const toggleOne = (id: string, checked: boolean) => {
    const next = new Set(selected);
    if (checked) next.add(id); else next.delete(id);
    setSelected(next);
  };

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["transactions"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["accounts"] });
  };

  const editAccount = useMemo(
    () => (edit ? (accs.data ?? []).find((a) => a.id === edit.account_id) ?? null : null),
    [edit, accs.data],
  );
  const editAccountIsCC = editAccount?.type === "credit_card";

  const upd = useMutation({
    mutationFn: async (d: Draft) => {
      // Sempre salva campos básicos primeiro
      await updateTransaction({
        data: {
          id: d.id, type: d.type, amount: d.amount, description: d.description,
          occurred_at: d.occurred_at, category_id: d.category_id, account_id: d.account_id,
        },
      });
      // Aviso não bloqueante sobre possível duplicata
      try {
        const dup = await checkDuplicateTransaction({
          data: {
            type: d.type, amount: d.amount, description: d.description,
            occurred_at: d.occurred_at, account_id: d.account_id, exclude_id: d.id,
          },
        });
        if (dup.duplicate) {
          toast.warning(`Existe um lançamento parecido em ${dup.existing.occurred_at} (${formatBRL(Number(dup.existing.amount))}).`);
        }
      } catch { /* ignore */ }

      // Se marcou como recorrente e ainda não tinha vínculo: cria e vincula
      if (editExtras.kind === "recurring" && !d.recurrence_id && d.type !== "transfer") {
        const next = nextOccurrenceIso(d.occurred_at, editExtras.frequency);
        const rec = await createRecurrence({
          data: {
            description: d.description,
            type: d.type,
            amount: d.amount,
            frequency: editExtras.frequency,
            next_run_at: next,
            category_id: d.category_id,
            account_id: d.account_id,
          },
        });
        if (rec?.id) {
          await updateTransaction({ data: { id: d.id, recurrence_id: rec.id } });
        }
        return { kind: "recurring" as const };
      }
      return { kind: "ok" as const };
    },
    onSuccess: (r) => {
      toast.success(r.kind === "recurring" ? "Lançamento salvo e recorrência criada" : "Lançamento atualizado");
      setEdit(null);
      setEditExtras({ ...DEFAULT_EXTRAS });
      invalidate();
      qc.invalidateQueries({ queryKey: ["recurrences"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const convert = useMutation({
    mutationFn: async () => {
      if (!edit) throw new Error("Lançamento ausente");
      if (editExtras.installments_count < 2) throw new Error("Mínimo de 2 parcelas");
      return convertTransactionToInstallment({
        data: { transaction_id: edit.id, installments_count: editExtras.installments_count },
      });
    },
    onSuccess: () => {
      toast.success("Lançamento convertido em parcelamento");
      setConvertConfirm(null);
      setEdit(null);
      setEditExtras({ ...DEFAULT_EXTRAS });
      invalidate();
      qc.invalidateQueries({ queryKey: ["installments"] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const create = useMutation({
    mutationFn: async (opts: { force?: boolean } = {}) => {
      const amount = Number(String(form.amount).replace(",", "."));
      if (!form.description.trim()) throw new Error("Informe a descrição");
      if (!(amount > 0)) throw new Error("Informe um valor válido");

      // Transferência: duas pernas vinculadas por transfer_id
      if (form.type === "transfer") {
        if (!form.account_id) throw new Error("Selecione a conta de origem");
        if (!form.transfer_to) throw new Error("Selecione a conta de destino");
        if (form.account_id === form.transfer_to) throw new Error("A conta de origem deve ser diferente do destino");
        await createTransfer({
          data: {
            from_account_id: form.account_id,
            to_account_id: form.transfer_to,
            amount,
            description: form.description.trim(),
            occurred_at: form.occurred_at,
            category_id: form.category_id || null,
          },
        });
        return { kind: "ok" as const, createdRecurrence: false };
      }

      if (!form.account_id) throw new Error("Selecione uma conta ou cartão");
      const account = accs.data?.find((a) => a.id === form.account_id);
      const isCC = account?.type === "credit_card";
      const ex = form.extras;
      if (ex.kind === "installment" && !(isCC && form.type === "expense")) {
        throw new Error("Parcelamento só em despesa de cartão de crédito");
      }
      let createdRecurrence = false;
      if (ex.kind === "installment") {
        if (ex.installments_count < 2) throw new Error("Mínimo de 2 parcelas");
        await createInstallmentPurchase({
          data: {
            description: form.description.trim(),
            total_amount: amount,
            installments_count: ex.installments_count,
            first_due_date: form.occurred_at,
            account_id: form.account_id,
            category_id: form.category_id || null,
          },
        });
        return { kind: "ok" as const, createdRecurrence };
      }
      const res = await createTransaction({
        data: {
          type: form.type,
          amount,
          description: form.description.trim(),
          occurred_at: form.occurred_at,
          category_id: form.category_id || null,
          account_id: form.account_id,
          force: opts.force === true,
        },
      });
      if (res && res.ok === false && res.duplicate) {
        return { kind: "duplicate" as const, existing: res.existing };
      }
      if (ex.kind === "recurring") {
        await createRecurrence({
          data: {
            description: form.description.trim(),
            type: form.type as "income" | "expense",
            amount,
            frequency: ex.frequency,
            next_run_at: form.occurred_at,
            category_id: form.category_id || null,
            account_id: form.account_id,
          },
        });
        createdRecurrence = true;
      }
      return { kind: "ok" as const, createdRecurrence };
    },

    onSuccess: (r) => {
      if (r.kind === "duplicate") {
        setDupExisting({
          id: r.existing.id as string,
          description: (r.existing.description as string | null) ?? null,
          occurred_at: r.existing.occurred_at as string,
          amount: Number(r.existing.amount),
          type: r.existing.type as string,
        });
        return;
      }
      toast.success(r.createdRecurrence ? "Lançamento salvo e recorrência criada" : "Lançamento salvo com sucesso");
      setCreateOpen(false);
      setForm(emptyForm);
      invalidate();
      qc.invalidateQueries({ queryKey: ["installments"] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["recurrences"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });


  const quickAddCat = useMutation({
    mutationFn: () => createCategory({ data: { name: quickCatName.trim(), icon: quickCatIcon.trim() || null } }),
    onSuccess: (row) => {
      toast.success("Categoria criada");
      qc.invalidateQueries({ queryKey: ["categories"] });
      if (row?.id) setForm((f) => ({ ...f, category_id: row.id }));
      setQuickCatName(""); setQuickCatIcon(""); setQuickCatOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: (id: string) => deleteTransaction({ data: { id } }),
    onSuccess: () => { toast.success("Lançamento removido"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const bulkDel = useMutation({
    mutationFn: (ids: string[]) => deleteTransactionsBulk({ data: { ids } }),
    onSuccess: (r) => { toast.success(`${r.count} lançamento(s) removido(s)`); setSelected(new Set()); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const addCat = useMutation({
    mutationFn: () => createCategory({ data: { name: newCat.trim(), icon: newIcon.trim() || null } }),
    onSuccess: () => { toast.success("Categoria criada"); setNewCat(""); setNewIcon(""); qc.invalidateQueries({ queryKey: ["categories"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const delCat = useMutation({
    mutationFn: (id: string) => deleteCategory({ data: { id } }),
    onSuccess: () => { toast.success("Categoria removida"); qc.invalidateQueries({ queryKey: ["categories"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const formAccount = (accs.data ?? []).find((a) => a.id === form.account_id);
  const formAccountIsCC = formAccount?.type === "credit_card";

  return (
    <AppShell
      title="Lançamentos"
      subtitle="Veja, edite ou remova suas movimentações"
      action={
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-2" /> Novo lançamento
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.print()} aria-label="Imprimir">
            <Printer className="h-4 w-4 mr-2" /> Imprimir
          </Button>
        </div>
      }
    >
      <div className="space-y-8">
        <section>
          <div className="grid grid-cols-2 sm:flex sm:flex-wrap sm:items-end gap-3 mb-3">
            <div className="relative col-span-2 sm:flex-1 sm:min-w-[180px] sm:max-w-sm">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar descrição, valor, conta ou categoria…" className="pl-9" />
            </div>
            <div className="space-y-1.5 min-w-0">
              <Label className="text-xs">Mês</Label>
              <Select value={month} onValueChange={setMonth}>
                <SelectTrigger className="w-full sm:w-[140px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {MONTHS.map((m, i) => <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 min-w-0">
              <Label className="text-xs">Ano</Label>
              <Select value={year} onValueChange={setYear}>
                <SelectTrigger className="w-full sm:w-[110px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 col-span-2 min-w-0">
              <Label className="text-xs">Origem</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as AccountKind)}>
                <SelectTrigger className="w-full sm:w-[170px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  <SelectItem value="credit_card">Cartão de crédito</SelectItem>
                  <SelectItem value="non_credit">Conta (não-cartão)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center justify-between mb-2 px-1">
            <div className="text-sm text-muted-foreground">{filtered.length} lançamento(s)</div>
            {someSelected && (
              <Button
                size="sm"
                variant="destructive"
                disabled={bulkDel.isPending}
                onClick={() => {
                  const ids = filteredIds.filter((id) => selected.has(id));
                  if (ids.length && confirm(`Remover ${ids.length} lançamento(s)?`)) bulkDel.mutate(ids);
                }}
              >
                <Trash2 className="h-4 w-4 mr-1" />
                Excluir selecionados ({filteredIds.filter((id) => selected.has(id)).length})
              </Button>
            )}
          </div>

          <div className="rounded-xl border border-border overflow-hidden">
            {!txs.data ? (
              <div className="p-6 text-sm text-muted-foreground">Carregando…</div>
            ) : filtered.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">Nenhum lançamento.</div>
            ) : (
              <>
                <div className="flex items-center gap-3 px-4 py-2 bg-muted/40 border-b border-border text-xs text-muted-foreground">
                  <Checkbox checked={allSelected} onCheckedChange={(v) => toggleAll(!!v)} aria-label="Selecionar todos" />
                  <span>Selecionar todos visíveis</span>
                </div>
                <ul className="divide-y divide-border">
                  {filtered.map((t) => {
                    const cat = (t as { categories?: { name: string; icon: string | null } | null }).categories;
                    const acc = (t as { accounts?: { name: string; color: string; type?: string } | null }).accounts;
                    const isCC = acc?.type === "credit_card";
                    const recurrenceId = (t as { recurrence_id?: string | null }).recurrence_id ?? null;
                    return (
                      <li key={t.id} className="flex items-center gap-3 px-4 py-3 hover:bg-accent/30">
                        <Checkbox
                          checked={selected.has(t.id)}
                          onCheckedChange={(v) => toggleOne(t.id, !!v)}
                          aria-label="Selecionar lançamento"
                        />
                        <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center text-base">
                          {cat?.icon ?? (t.type === "income" ? "💰" : t.type === "expense" ? "💳" : "🔁")}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="font-medium truncate flex items-center gap-1.5">
                            {t.description}
                            {recurrenceId && <Repeat className="h-3 w-3 text-muted-foreground" aria-label="Recorrente" />}
                          </div>
                          <div className="text-xs text-muted-foreground truncate">
                            {t.occurred_at} · {cat?.name ?? "Sem categoria"}
                            {acc ? ` · ${acc.name}${isCC ? " (cartão)" : ""}` : ""}
                          </div>
                        </div>
                        <div className={`tabular-nums font-medium ${t.type === "income" ? "text-emerald-500" : t.type === "expense" ? "text-rose-500" : ""}`}>
                          {t.type === "expense" ? "-" : t.type === "income" ? "+" : ""}{formatBRL(Number(t.amount))}
                        </div>
                        <button
                          onClick={() => {
                            setEdit({
                              id: t.id,
                              type: t.type as Draft["type"],
                              amount: Number(t.amount),
                              description: t.description,
                              occurred_at: t.occurred_at,
                              category_id: t.category_id,
                              account_id: (t as { account_id: string | null }).account_id,
                              recurrence_id: recurrenceId,
                            });
                            setEditExtras({ ...DEFAULT_EXTRAS });
                          }}
                          className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
                          aria-label="Editar"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => { if (confirm("Remover este lançamento?")) del.mutate(t.id); }}
                          className="p-1.5 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive"
                          aria-label="Excluir"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>
        </section>

        <section>
          <h2 className="font-display text-lg font-semibold mb-3">Categorias</h2>
          <div className="flex flex-wrap gap-2 mb-4">
            {cats.data?.map((c) => (
              <div key={c.id} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card/40 pl-3 pr-1 py-1 text-sm">
                <span>{c.icon ?? "🏷️"}</span>
                <span>{c.name}</span>
                {c.is_default ? (
                  <span className="text-[10px] text-muted-foreground px-1.5">padrão</span>
                ) : (
                  <button
                    onClick={() => { if (confirm(`Remover "${c.name}"?`)) delCat.mutate(c.id); }}
                    className="h-6 w-6 rounded-full hover:bg-destructive/20 text-muted-foreground hover:text-destructive flex items-center justify-center"
                    aria-label="Remover"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </div>
            ))}
          </div>
          <form
            onSubmit={(e) => { e.preventDefault(); if (newCat.trim()) addCat.mutate(); }}
            className="flex flex-wrap items-end gap-2 max-w-xl"
          >
            <div className="space-y-1.5 flex-1 min-w-[180px]">
              <Label>Nova categoria</Label>
              <Input value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="Ex: Pet shop" />
            </div>
            <div className="space-y-1.5 w-24">
              <Label>Ícone</Label>
              <Input value={newIcon} onChange={(e) => setNewIcon(e.target.value)} placeholder="🐶" />
            </div>
            <Button type="submit" disabled={!newCat.trim() || addCat.isPending}>
              <Plus className="h-4 w-4 mr-1" /> Adicionar
            </Button>
          </form>
        </section>
      </div>

      {/* Diálogo Editar */}
      <Dialog open={edit !== null} onOpenChange={(v) => { if (!v) { setEdit(null); setEditExtras({ ...DEFAULT_EXTRAS }); } }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Editar lançamento</DialogTitle></DialogHeader>
          {edit && (
            <div className="space-y-3">
              {edit.recurrence_id && (
                <div className="rounded-lg border border-border bg-muted/30 p-3 flex items-center gap-2 text-sm">
                  <Repeat className="h-4 w-4 text-primary" />
                  <span className="flex-1">Este lançamento faz parte de uma recorrência.</span>
                  <Link to="/recurrences" className="text-primary text-xs hover:underline">Ver em Recorrências</Link>
                </div>
              )}
              <div className="space-y-1.5">
                <Label>Descrição</Label>
                <Input value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Tipo</Label>
                  <Select value={edit.type} onValueChange={(v) => setEdit({ ...edit, type: v as Draft["type"] })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="expense">Despesa</SelectItem>
                      <SelectItem value="income">Receita</SelectItem>
                      <SelectItem value="transfer">Transferência</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Valor (R$)</Label>
                  <Input type="number" step="0.01" min="0" value={edit.amount}
                    onChange={(e) => setEdit({ ...edit, amount: Number(e.target.value) })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Data</Label>
                  <Input type="date" value={edit.occurred_at}
                    onChange={(e) => setEdit({ ...edit, occurred_at: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Categoria</Label>
                  <Select value={edit.category_id ?? "none"} onValueChange={(v) => setEdit({ ...edit, category_id: v === "none" ? null : v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sem categoria</SelectItem>
                      {cats.data?.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.icon ? `${c.icon} ` : ""}{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Conta</Label>
                <Select value={edit.account_id ?? "none"} onValueChange={(v) => setEdit({ ...edit, account_id: v === "none" ? null : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sem conta</SelectItem>
                    {accs.data?.map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {!edit.recurrence_id && (
                <TransactionExtras
                  mode="edit"
                  value={editExtras}
                  onChange={setEditExtras}
                  accountIsCreditCard={!!editAccountIsCC}
                  isExpense={edit.type === "expense"}
                  amount={Number(edit.amount) || 0}
                />
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEdit(null)}>Cancelar</Button>
            <Button
              disabled={!edit || !edit.description.trim() || !(edit.amount > 0) || upd.isPending || convert.isPending}
              onClick={() => {
                if (!edit) return;
                if (editExtras.kind === "installment") {
                  setConvertConfirm({
                    count: editExtras.installments_count,
                    description: edit.description,
                    amount: edit.amount,
                  });
                  return;
                }
                upd.mutate(edit);
              }}
            >
              {upd.isPending || convert.isPending ? "Salvando…" : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* AlertDialog confirmação conversão */}
      <AlertDialog open={!!convertConfirm} onOpenChange={(o) => { if (!o) setConvertConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Layers className="h-5 w-5 text-destructive" /> Converter em parcelamento?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Isto vai <strong>remover o lançamento atual</strong> "{convertConfirm?.description}" e criar uma compra parcelada de {convertConfirm?.count}× a partir de {formatBRL(Number(convertConfirm?.amount ?? 0))}. A ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={convert.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={convert.isPending}
              onClick={(e) => { e.preventDefault(); convert.mutate(); }}
            >
              {convert.isPending ? "Convertendo…" : "Converter"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Diálogo Novo */}
      <Dialog open={createOpen} onOpenChange={(v) => { if (!v) { setCreateOpen(false); setQuickCatOpen(false); } }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Novo lançamento</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Descrição</Label>
              <Input
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Ex: Mercado, salário, conta de luz…"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Tipo</Label>
                <Select
                  value={form.type}
                  onValueChange={(v) => setForm({
                    ...form,
                    type: v as "income" | "expense" | "transfer",
                    extras: v !== "expense" ? { ...DEFAULT_EXTRAS } : form.extras,
                    transfer_to: v === "transfer" ? form.transfer_to : "",
                  })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="expense">Despesa</SelectItem>
                    <SelectItem value="income">Receita</SelectItem>
                    <SelectItem value="transfer">Transferência</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Valor (R$)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  inputMode="decimal"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  placeholder="0,00"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Data</Label>
              <Input type="date" value={form.occurred_at} onChange={(e) => setForm({ ...form, occurred_at: e.target.value })} />
            </div>

            {form.type === "transfer" ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Sair da conta</Label>
                  <Select value={form.account_id} onValueChange={(v) => setForm({ ...form, account_id: v })}>
                    <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
                    <SelectContent>
                      {(accs.data ?? []).filter((a) => !a.archived).map((a) => (
                        <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Entrar na conta</Label>
                  <Select value={form.transfer_to} onValueChange={(v) => setForm({ ...form, transfer_to: v })}>
                    <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
                    <SelectContent>
                      {(accs.data ?? [])
                        .filter((a) => !a.archived && a.id !== form.account_id)
                        .map((a) => (
                          <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
                {form.account_id && form.transfer_to && form.account_id === form.transfer_to && (
                  <p className="col-span-full text-xs text-destructive">A conta de origem deve ser diferente da conta de destino.</p>
                )}
              </div>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label>Pagamento</Label>
                  <Select
                    value={form.accountKind}
                    onValueChange={(v) => setForm({
                      ...form,
                      accountKind: v as "checking" | "credit_card",
                      account_id: "",
                      extras: v === "checking" && form.extras.kind === "installment" ? { ...DEFAULT_EXTRAS } : form.extras,
                    })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="checking">Conta corrente / dinheiro</SelectItem>
                      <SelectItem value="credit_card">Cartão de crédito</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label>{form.accountKind === "credit_card" ? "Cartão" : "Conta"}</Label>
                  <Select value={form.account_id} onValueChange={(v) => setForm({ ...form, account_id: v })}>
                    <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
                    <SelectContent>
                      {(accs.data ?? [])
                        .filter((a) => !a.archived)
                        .filter((a) => form.accountKind === "credit_card" ? a.type === "credit_card" : a.type !== "credit_card")
                        .map((a) => (
                          <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  {!form.account_id && (
                    <p className="text-xs text-destructive">Selecione uma conta ou cartão para continuar.</p>
                  )}
                </div>
              </>
            )}


            {form.type !== "transfer" && (
              <TransactionExtras
                mode="create"
                value={form.extras}
                onChange={(v) => setForm({ ...form, extras: v })}
                accountIsCreditCard={!!formAccountIsCC}
                isExpense={form.type === "expense"}
                amount={Number(String(form.amount).replace(",", ".")) || 0}
              />
            )}


            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>Categoria</Label>
                <button
                  type="button"
                  className="text-xs text-primary hover:underline"
                  onClick={() => setQuickCatOpen((v) => !v)}
                >
                  {quickCatOpen ? "Cancelar" : "+ Nova categoria"}
                </button>
              </div>
              <Select value={form.category_id || "none"} onValueChange={(v) => setForm({ ...form, category_id: v === "none" ? "" : v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem categoria</SelectItem>
                  {cats.data?.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.icon ? `${c.icon} ` : ""}{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {quickCatOpen && (
                <div className="space-y-3 pt-2 rounded-lg border border-border p-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Nome</Label>
                    <Input value={quickCatName} onChange={(e) => setQuickCatName(e.target.value)} placeholder="Ex: Pet shop" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Ícone {quickCatIcon && <span className="ml-1">— atual: {quickCatIcon.startsWith("data:") ? <img src={quickCatIcon} alt="" className="inline h-4 w-4 align-middle rounded" /> : quickCatIcon}</span>}</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {(form.type === "income"
                        ? ["💰","💵","💼","🏦","📈","🎁","🪙","💳"]
                        : ["🛒","🍔","⛽","🏠","💡","💊","🎬","✈️","🐶","📚","👕","🚗","📱","🎓","🧾","🛠️"]
                      ).map((emo) => (
                        <button
                          key={emo}
                          type="button"
                          onClick={() => setQuickCatIcon(emo)}
                          className={`h-9 w-9 rounded-md border text-lg flex items-center justify-center transition ${quickCatIcon === emo ? "border-primary bg-primary/10" : "border-border hover:bg-accent"}`}
                          aria-label={`Selecionar ${emo}`}
                        >
                          {emo}
                        </button>
                      ))}
                    </div>
                    <label className="flex items-center gap-2 text-xs text-primary hover:underline cursor-pointer mt-1">
                      <Upload className="h-3.5 w-3.5" />
                      Enviar imagem do meu computador
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/svg+xml,image/webp"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          const okTypes = ["image/png","image/jpeg","image/svg+xml","image/webp"];
                          if (!okTypes.includes(file.type)) {
                            toast.error("Formato inválido. Use PNG, JPG, SVG ou WebP.");
                            e.target.value = "";
                            return;
                          }
                          if (file.size > 256 * 1024) {
                            toast.error("Arquivo muito grande. Máximo 256 KB.");
                            e.target.value = "";
                            return;
                          }
                          const reader = new FileReader();
                          reader.onload = () => setQuickCatIcon(String(reader.result || ""));
                          reader.readAsDataURL(file);
                        }}
                      />
                    </label>
                    <p className="text-[10px] text-muted-foreground">PNG, JPG, SVG ou WebP · até 256 KB · recomendado 64×64 px quadrado.</p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    className="w-full"
                    disabled={!quickCatName.trim() || quickAddCat.isPending}
                    onClick={() => quickAddCat.mutate()}
                  >
                    Criar categoria
                  </Button>
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancelar</Button>
            <Button
              disabled={
                create.isPending ||
                !form.account_id ||
                (form.type === "transfer" && (!form.transfer_to || form.account_id === form.transfer_to))
              }
              onClick={() => create.mutate({})}
            >
              {create.isPending ? "Salvando…" : "Salvar lançamento"}
            </Button>

          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!dupExisting} onOpenChange={(o) => { if (!o) setDupExisting(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Possível lançamento duplicado</DialogTitle>
          </DialogHeader>
          {dupExisting && (
            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground">
                Já existe um lançamento parecido (mesma conta, data próxima, mesmo valor e descrição similar):
              </p>
              <div className="rounded-md border border-border p-3 space-y-1">
                <div className="font-medium">{dupExisting.description ?? "Sem descrição"}</div>
                <div className="text-xs text-muted-foreground">
                  {dupExisting.occurred_at} · {dupExisting.type === "income" ? "Receita" : dupExisting.type === "expense" ? "Despesa" : "Transferência"} · {formatBRL(dupExisting.amount)}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Deseja registrar mesmo assim?
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDupExisting(null)}>Cancelar</Button>
            <Button
              disabled={create.isPending}
              onClick={() => { setDupExisting(null); create.mutate({ force: true }); }}
            >
              Registrar mesmo assim
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
