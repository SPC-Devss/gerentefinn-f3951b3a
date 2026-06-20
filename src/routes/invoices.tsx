import { createFileRoute } from "@tanstack/react-router";
import { requireAuth } from "@/lib/require-auth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { listInvoices, getInvoiceDetail, markInvoicePaid } from "@/lib/invoices.functions";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { CreditCard, Check, ChevronDown, ChevronRight, EyeOff, Eye, Calendar } from "lucide-react";
import { formatBRL, formatDate } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/invoices")({
  beforeLoad: requireAuth,
  component: InvoicesPage,
  head: () => ({ meta: [{ title: "Faturas de cartão — Finn" }] }),
});

const STATUS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  open: { label: "Aberta", variant: "secondary" },
  closed: { label: "Fechada", variant: "default" },
  paid: { label: "Paga", variant: "default" },
  projected: { label: "Projetada", variant: "outline" },
};
const statusFor = (s: string) => STATUS[s] ?? { label: s ?? "—", variant: "secondary" as const };

type InvoiceItem = Awaited<ReturnType<typeof listInvoices>>[number];

type GroupedCard = {
  accountId: string;
  name: string;
  color: string;
  institution?: string | null;
  pending: InvoiceItem[];
  paid: InvoiceItem[];
};

function monthLabel(dateIso: string) {
  const d = new Date(dateIso + "T00:00:00");
  return d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}

function isPaid(inv: InvoiceItem) {
  return inv.status === "paid";
}

function InvoicesPage() {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showPaid, setShowPaid] = useState(false);
  const [paidCardsOpen, setPaidCardsOpen] = useState<Record<string, boolean>>({});
  const isProjected = !!selectedId && selectedId.startsWith("projected-");

  const q = useQuery({ queryKey: ["invoices"], queryFn: () => listInvoices() });
  const detailQ = useQuery({
    queryKey: ["invoice", selectedId],
    queryFn: () => getInvoiceDetail({ data: { id: selectedId! } }),
    enabled: !!selectedId && !isProjected,
  });

  const payM = useMutation({
    mutationFn: (v: { id: string; paid: boolean }) => markInvoicePaid({ data: v }),
    onSuccess: () => {
      toast.success("Atualizado");
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["invoice"] });
    },
  });

  const cards = useMemo(() => {
    const map = new Map<string, GroupedCard>();
    for (const inv of q.data ?? []) {
      const acc = inv.accounts as { name?: string; color?: string; institution?: string } | null;
      const id = inv.account_id ?? "sem-cartao";
      if (!map.has(id)) {
        map.set(id, {
          accountId: id,
          name: acc?.name ?? "Cartão desconhecido",
          color: acc?.color ?? "#4f46e5",
          institution: acc?.institution,
          pending: [],
          paid: [],
        });
      }
      const group = map.get(id)!;
      if (isPaid(inv)) group.paid.push(inv);
      else group.pending.push(inv);
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [q.data]);

  const paidTotal = useMemo(
    () => cards.reduce((sum, c) => sum + c.paid.reduce((s, i) => s + Number(i.total_amount), 0), 0),
    [cards],
  );
  const pendingTotal = useMemo(
    () => cards.reduce((sum, c) => sum + c.pending.reduce((s, i) => s + Number(i.total_amount), 0), 0),
    [cards],
  );

  const selectedInvoice = useMemo(
    () => q.data?.find((i) => i.id === selectedId),
    [q.data, selectedId],
  );

  return (
    <AppShell title="Faturas de cartão" subtitle="Visualize fechamentos, vencimentos e marque faturas como pagas.">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Switch id="show-paid" checked={showPaid} onCheckedChange={setShowPaid} />
          <Label htmlFor="show-paid" className="flex items-center gap-2 cursor-pointer">
            {showPaid ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
            Mostrar faturas pagas
          </Label>
        </div>
        <div className="text-sm text-muted-foreground">
          Em aberto: <span className="font-semibold text-foreground">{formatBRL(pendingTotal)}</span>
          {showPaid && (
            <span className="ml-3">
              Pagas: <span className="font-semibold text-foreground">{formatBRL(paidTotal)}</span>
            </span>
          )}
        </div>
      </div>

      {q.isLoading && <p className="text-muted-foreground">Carregando...</p>}
      {q.data && cards.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <CreditCard className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p>Nenhuma fatura prevista nos próximos 3 meses. Registre lançamentos em um cartão para começar.</p>
        </div>
      )}

      <div className="grid gap-4">
        {cards.map((card) => {
          const paidOpen = !!paidCardsOpen[card.accountId];
          const paidCount = card.paid.length;
          return (
            <Card key={card.accountId} className="overflow-hidden">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-3 text-base">
                  <div
                    className="h-10 w-10 rounded-md flex items-center justify-center"
                    style={{ backgroundColor: card.color + "30", color: card.color }}
                  >
                    <CreditCard className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="truncate">{card.name}</div>
                    {card.institution && (
                      <div className="text-xs font-normal text-muted-foreground truncate">{card.institution}</div>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold">
                      {formatBRL(card.pending.reduce((s, i) => s + Number(i.total_amount), 0))}
                    </div>
                    <div className="text-xs text-muted-foreground">em aberto</div>
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                {card.pending.length === 0 && paidCount === 0 && (
                  <p className="text-sm text-muted-foreground py-2">Nenhuma fatura para este cartão.</p>
                )}

                {card.pending.length > 0 && (
                  <div className="space-y-2">
                    {card.pending.map((inv) => (
                      <InvoiceRow key={inv.id} inv={inv} onClick={() => setSelectedId(inv.id)} />
                    ))}
                  </div>
                )}

                {showPaid && paidCount > 0 && (
                  <div className="mt-3 pt-3 border-t border-border">
                    <Collapsible
                      open={paidOpen}
                      onOpenChange={(open) =>
                        setPaidCardsOpen((prev) => ({ ...prev, [card.accountId]: open }))
                      }
                    >
                      <CollapsibleTrigger asChild>
                        <Button variant="ghost" size="sm" className="w-full justify-between h-8 px-2 text-muted-foreground">
                          <span className="flex items-center gap-2">
                            <Check className="h-4 w-4" />
                            {paidCount} fatura{paidCount > 1 ? "s" : ""} paga{paidCount > 1 ? "s" : ""}
                          </span>
                          {paidOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </Button>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="space-y-2 mt-2">
                          {card.paid.map((inv) => (
                            <InvoiceRow key={inv.id} inv={inv} onClick={() => setSelectedId(inv.id)} paid />
                          ))}
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog open={!!selectedId} onOpenChange={(o) => !o && setSelectedId(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Detalhe da fatura</DialogTitle>
          </DialogHeader>
          {isProjected && selectedInvoice && (() => {
            const acc = selectedInvoice.accounts as { name?: string } | null;
            return (
              <div className="space-y-3">
                <div>
                  <div className="font-semibold">{acc?.name}</div>
                  <div className="text-sm text-muted-foreground">
                    Projeção · Vence {formatDate(selectedInvoice.due_date)} · Total estimado {formatBRL(Number(selectedInvoice.total_amount))}
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">
                  Esta fatura ainda não foi gerada. O valor é a soma das parcelas futuras agendadas para este mês de referência.
                </p>
              </div>
            );
          })()}
          {!isProjected && detailQ.data && detailQ.data.invoice && (
            <div className="space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <div className="font-semibold">{(detailQ.data.invoice.accounts as { name?: string } | null)?.name}</div>
                  <div className="text-sm text-muted-foreground">
                    Vence {formatDate(detailQ.data.invoice.due_date)} · Total {formatBRL(Number(detailQ.data.invoice.total_amount))}
                  </div>
                </div>
                {detailQ.data.invoice.status !== "paid" ? (
                  <Button onClick={() => payM.mutate({ id: selectedId!, paid: true })} disabled={payM.isPending}>
                    <Check className="h-4 w-4 mr-2" /> Marcar como paga
                  </Button>
                ) : (
                  <Button variant="outline" onClick={() => payM.mutate({ id: selectedId!, paid: false })} disabled={payM.isPending}>
                    Reabrir
                  </Button>
                )}
              </div>
              <div className="border border-border rounded-lg divide-y divide-border max-h-96 overflow-y-auto">
                {detailQ.data.transactions.length === 0 && (
                  <p className="p-4 text-sm text-muted-foreground">Sem lançamentos nesta fatura.</p>
                )}
                {detailQ.data.transactions.map((t) => (
                  <div key={t.id} className="p-3 flex justify-between items-center">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{t.description}</div>
                      <div className="text-xs text-muted-foreground">
                        {formatDate(t.occurred_at as string)} · {(t.categories as { name?: string; icon?: string } | null)?.name ?? "Sem categoria"}
                      </div>
                    </div>
                    <div className={`font-medium ${t.type === "income" ? "text-emerald-500" : ""}`}>
                      {t.type === "income" ? "−" : ""}{formatBRL(Number(t.amount))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function InvoiceRow({
  inv,
  onClick,
  paid = false,
}: {
  inv: InvoiceItem;
  onClick: () => void;
  paid?: boolean;
}) {
  const status = inv.projected ? "projected" : inv.status;
  const isPastDue = !paid && !inv.projected && inv.due_date < new Date().toISOString().slice(0, 10);
  return (
    <button
      onClick={onClick}
      className={`w-full text-left border rounded-lg p-3 flex items-center gap-3 transition ${
        paid ? "border-border/50 bg-muted/30 hover:bg-muted/50" : "border-border bg-card hover:bg-accent/30"
      }`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-sm font-medium ${paid ? "text-muted-foreground line-through" : ""}`}>
            {monthLabel(inv.reference_month)}
          </span>
          <Badge variant={statusFor(status).variant} className="text-xs">{statusFor(status).label}</Badge>
          {isPastDue && <Badge variant="destructive" className="text-xs">Vencida</Badge>}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2">
          <Calendar className="h-3 w-3" />
          Fecha {formatDate(inv.closing_date)} · Vence {formatDate(inv.due_date)}
        </div>
      </div>
      <div className={`text-right font-semibold ${paid ? "text-muted-foreground" : ""}`}>
        {formatBRL(Number(inv.total_amount))}
      </div>
    </button>
  );
}
