import { createFileRoute } from "@tanstack/react-router";
import { requireAuth } from "@/lib/require-auth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { listInvoices, getInvoiceDetail, markInvoicePaid } from "@/lib/invoices.functions";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { CreditCard, Check } from "lucide-react";
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

function InvoicesPage() {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
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

  return (
    <AppShell title="Faturas de cartão" subtitle="Visualize fechamentos, vencimentos e marque faturas como pagas.">
      {q.isLoading && <p className="text-muted-foreground">Carregando...</p>}
      {q.data && q.data.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <CreditCard className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p>Nenhuma fatura ainda. Registre lançamentos em um cartão para começar.</p>
        </div>
      )}
      <div className="space-y-2">
        {q.data?.map((inv) => {
          const acc = inv.accounts as { name?: string; color?: string; institution?: string } | null;
          return (
            <button
              key={inv.id}
              onClick={() => setSelectedId(inv.id)}
              className="w-full text-left border border-border rounded-lg p-4 bg-card hover:bg-accent/30 flex items-center gap-4 transition"
            >
              <div className="h-10 w-10 rounded-md flex items-center justify-center" style={{ backgroundColor: (acc?.color ?? "#4f46e5") + "30", color: acc?.color ?? "#4f46e5" }}>
                <CreditCard className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{acc?.name}</div>
                <div className="text-xs text-muted-foreground">
                  Ref. {inv.reference_month.slice(0, 7)} · Fecha {formatDate(inv.closing_date)} · Vence {formatDate(inv.due_date)}
                </div>
              </div>
              <div className="text-right">
                <div className="font-semibold">{formatBRL(Number(inv.total_amount))}</div>
                <Badge variant={statusFor(inv.projected ? "projected" : inv.status).variant} className="text-xs mt-1">{statusFor(inv.projected ? "projected" : inv.status).label}</Badge>
              </div>
            </button>
          );
        })}
      </div>

      <Dialog open={!!selectedId} onOpenChange={(o) => !o && setSelectedId(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Detalhe da fatura</DialogTitle>
          </DialogHeader>
          {isProjected && (() => {
            const inv = q.data?.find((i) => i.id === selectedId);
            const acc = inv?.accounts as { name?: string } | null;
            return (
              <div className="space-y-3">
                <div>
                  <div className="font-semibold">{acc?.name}</div>
                  <div className="text-sm text-muted-foreground">
                    Projeção · Vence {inv && formatDate(inv.due_date)} · Total estimado {inv && formatBRL(Number(inv.total_amount))}
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
              <div className="flex items-center justify-between">
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
                        {formatDate(t.occurred_at as string)} · {(t.categories as { name?: string } | null)?.name ?? "Sem categoria"}
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
