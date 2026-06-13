import { createFileRoute } from "@tanstack/react-router";
import { requireAuth } from "@/lib/require-auth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { listAccounts, createAccount, deleteAccount } from "@/lib/accounts.functions";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Wallet, CreditCard, PiggyBank, Banknote, TrendingUp } from "lucide-react";
import { formatBRL } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/accounts")({
  beforeLoad: requireAuth,
  component: AccountsPage,
  head: () => ({ meta: [{ title: "Contas e cartões — Finn" }] }),
});

const TYPE_LABELS: Record<string, string> = {
  checking: "Conta corrente",
  savings: "Poupança",
  cash: "Dinheiro",
  credit_card: "Cartão de crédito",
  investment: "Investimento",
};

const TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  checking: Wallet,
  savings: PiggyBank,
  cash: Banknote,
  credit_card: CreditCard,
  investment: TrendingUp,
};

function AccountsPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ["accounts"], queryFn: () => listAccounts() });

  const del = useMutation({
    mutationFn: (id: string) => deleteAccount({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounts"] });
      toast.success("Conta removida");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <AppShell
      title="Contas e cartões"
      subtitle="Gerencie suas contas bancárias e cartões"
      action={
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-1" /> Nova conta</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Nova conta</DialogTitle></DialogHeader>
            <AccountForm onDone={() => { setOpen(false); qc.invalidateQueries({ queryKey: ["accounts"] }); }} />
          </DialogContent>
        </Dialog>
      }
    >
      {!q.data ? (
        <div className="text-muted-foreground text-sm">Carregando…</div>
      ) : q.data.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-12 text-center">
          <Wallet className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
          <p className="font-medium">Nenhuma conta cadastrada</p>
          <p className="text-sm text-muted-foreground mt-1">Adicione sua primeira conta para começar.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {q.data.map((a) => {
            const Icon = TYPE_ICONS[a.type] ?? Wallet;
            return (
              <div key={a.id} className="tile p-4 relative">
                <button
                  onClick={() => { if (confirm(`Remover "${a.name}"? Todas as movimentações ligadas a essa conta ficarão sem vínculo.`)) del.mutate(a.id); }}
                  className="absolute top-2 right-2 p-1.5 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition"
                  aria-label="Excluir conta"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
                <div className="h-10 w-10 rounded-lg flex items-center justify-center mb-3" style={{ background: a.color + "20", color: a.color }}>
                  <Icon className="h-5 w-5" />
                </div>
                <div className="font-medium">{a.name}</div>
                <div className="text-xs text-muted-foreground">{TYPE_LABELS[a.type]}{a.institution ? ` · ${a.institution}` : ""}</div>
                <div className="mt-3 text-xl font-display font-semibold tabular-nums">{formatBRL(a.balance)}</div>
                {a.type === "credit_card" && a.credit_limit != null && (
                  <div className="text-xs text-muted-foreground mt-1">Limite: {formatBRL(Number(a.credit_limit))}</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}

function AccountForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [type, setType] = useState<"checking" | "savings" | "cash" | "credit_card" | "investment">("checking");
  const [institution, setInstitution] = useState("");
  const [color, setColor] = useState("#6366f1");
  const [creditLimit, setCreditLimit] = useState("");
  const [closingDay, setClosingDay] = useState("");
  const [dueDay, setDueDay] = useState("");

  const mut = useMutation({
    mutationFn: () =>
      createAccount({
        data: {
          name,
          type,
          institution: institution || null,
          color,
          credit_limit: type === "credit_card" && creditLimit ? Number(creditLimit) : null,
          closing_day: type === "credit_card" && closingDay ? Number(closingDay) : null,
          due_day: type === "credit_card" && dueDay ? Number(dueDay) : null,
        },
      }),
    onSuccess: () => { toast.success("Conta criada"); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (!name) return; mut.mutate(); }}
      className="space-y-3"
    >
      <div className="space-y-1.5">
        <Label>Nome</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Nubank" autoFocus />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Tipo</Label>
          <Select value={type} onValueChange={(v) => setType(v as typeof type)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(TYPE_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Cor</Label>
          <Input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-10 p-1" />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>Instituição (opcional)</Label>
        <Input value={institution} onChange={(e) => setInstitution(e.target.value)} placeholder="Ex: Itaú" />
      </div>
      {type === "credit_card" && (
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label>Limite</Label>
            <Input type="number" value={creditLimit} onChange={(e) => setCreditLimit(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Fechamento</Label>
            <Input type="number" min={1} max={31} value={closingDay} onChange={(e) => setClosingDay(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Vencimento</Label>
            <Input type="number" min={1} max={31} value={dueDay} onChange={(e) => setDueDay(e.target.value)} />
          </div>
        </div>
      )}
      <Button type="submit" className="w-full" disabled={!name || mut.isPending}>
        {mut.isPending ? "Criando…" : "Criar conta"}
      </Button>
    </form>
  );
}
