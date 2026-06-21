import { createFileRoute } from "@tanstack/react-router";
import { requireAuth } from "@/lib/require-auth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { listAccounts } from "@/lib/accounts.functions";
import { listCategories } from "@/lib/categories.functions";
import { parseStatement, bulkImportTransactions } from "@/lib/import.functions";
import { Upload, FileText, Loader2, CheckCircle2, Trash2, Pencil, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { formatBRL } from "@/lib/format";
import { TransactionExtras, DEFAULT_EXTRAS, type TransactionExtrasValue } from "@/components/transaction-extras";

export const Route = createFileRoute("/import")({
  beforeLoad: requireAuth,
  component: ImportPage,
  head: () => ({ meta: [{ title: "Importar extrato — Finn" }] }),
});

type ParsedTx = {
  type: "expense" | "income";
  amount: number;
  description: string;
  occurred_at: string;
  suggested_category?: string | null;
  _enabled: boolean;
  _duplicate?: boolean;
  _extras: TransactionExtrasValue;
};

type FileKind = "" | "debit" | "credit_card";

function ImportPage() {
  const accountsQ = useQuery({ queryKey: ["accounts"], queryFn: () => listAccounts() });
  const [fileKind, setFileKind] = useState<FileKind>("");
  const [accountId, setAccountId] = useState<string>("");
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState<ParsedTx[] | null>(null);
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<ParsedTx | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dupes, setDupes] = useState<
    { index: number; candidate: { description: string; amount: number; occurred_at: string; type: "expense" | "income" }; existing: { id: string; description: string | null; occurred_at: string; amount: number; type: string } }[]
    | null
  >(null);
  const categoriesQ = useQuery({ queryKey: ["categories"], queryFn: () => listCategories() });

  const accountsForKind = useMemo(() => {
    const all = accountsQ.data ?? [];
    if (fileKind === "credit_card") return all.filter((a) => a.type === "credit_card" && !a.archived);
    if (fileKind === "debit") return all.filter((a) => a.type !== "credit_card" && !a.archived);
    return [];
  }, [accountsQ.data, fileKind]);

  const selectedAccount = useMemo(
    () => (accountsQ.data ?? []).find((a) => a.id === accountId) ?? null,
    [accountsQ.data, accountId],
  );
  const accountIsCreditCard = selectedAccount?.type === "credit_card";

  async function extractText(f: File): Promise<{ text: string; format: "ofx" | "csv" | "pdf" }> {
    const name = f.name.toLowerCase();
    if (name.endsWith(".pdf")) {
      const pdfjs = await import("pdfjs-dist");
      const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      const buf = await f.arrayBuffer();
      const doc = await pdfjs.getDocument({ data: buf }).promise;
      let out = "";
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        out += content.items.map((it) => ("str" in it ? it.str : "")).join(" ") + "\n";
      }
      return { text: out, format: "pdf" };
    }
    const text = await f.text();
    if (name.endsWith(".ofx") || /<OFX|<STMTTRN/i.test(text)) return { text, format: "ofx" };
    return { text, format: "csv" };
  }

  async function handleParse() {
    if (!file || !fileKind || !accountId) return;
    setParsing(true);
    setParsed(null);
    try {
      const { text, format } = await extractText(file);
      const res = await parseStatement({
        data: { text, format, is_credit_card: fileKind === "credit_card" },
      });
      setParsed(res.transactions.map((t) => ({ ...t, _enabled: true, _extras: { ...DEFAULT_EXTRAS } })));
      toast.success(`${res.transactions.length} transações detectadas`);
    } catch (e) {
      toast.error((e as Error).message || "Falha ao ler arquivo");
    } finally {
      setParsing(false);
    }
  }

  const importM = useMutation({
    mutationFn: (opts: { force?: boolean; skip_indices?: number[] } = {}) => {
      const all = parsed ?? [];
      // Mantém índices globais para alinhar com `duplicates.index`
      const skipExtra = opts.skip_indices ?? [];
      const disabledIdx = all.map((t, i) => (t._enabled ? -1 : i)).filter((i) => i >= 0);
      const skipFinal = Array.from(new Set([...skipExtra, ...disabledIdx]));
      return bulkImportTransactions({
        data: {
          account_id: accountId || null,
          transactions: all.map((t) => ({
            type: t.type,
            amount: t.amount,
            description: t.description,
            occurred_at: t.occurred_at,
            category_name: t.suggested_category ?? null,
            extras: t._extras,
          })),
          force: opts.force === true,
          skip_indices: skipFinal,
        },
      });
    },
    onSuccess: (r) => {
      if (r && r.ok === false && r.duplicate) {
        setDupes(r.duplicates);
        // marca duplicatas no estado e desmarca
        const dupIdx = new Set(r.duplicates.map((d) => d.index));
        setParsed((prev) =>
          prev?.map((p, idx) =>
            dupIdx.has(idx) ? { ...p, _duplicate: true, _enabled: false } : p,
          ) ?? null,
        );
        return;
      }
      toast.success(`${r.inserted} lançamentos importados`);
      setParsed(null);
      setFile(null);
      setConfirmOpen(false);
      setDupes(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });


  const selectedCount = (parsed ?? []).filter((t) => t._enabled).length;
  const totalExpense = (parsed ?? []).filter((t) => t._enabled && t.type === "expense").reduce((s, t) => s + t.amount, 0);
  const totalIncome = (parsed ?? []).filter((t) => t._enabled && t.type === "income").reduce((s, t) => s + t.amount, 0);

  return (
    <AppShell title="Importar extrato" subtitle="Carregue extratos OFX, CSV ou faturas em PDF">
      <div className="space-y-6">
        <div className="tile p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Tipo de lançamento no arquivo <span className="text-destructive">*</span></Label>
              <Select
                value={fileKind}
                onValueChange={(v) => { setFileKind(v as FileKind); setAccountId(""); setParsed(null); }}
              >
                <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="debit">Conta corrente / débito</SelectItem>
                  <SelectItem value="credit_card">Fatura de cartão de crédito</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{fileKind === "credit_card" ? "Cartão" : "Conta"} <span className="text-destructive">*</span></Label>
              <Select value={accountId} onValueChange={(v) => { setAccountId(v); setParsed(null); }} disabled={!fileKind}>
                <SelectTrigger><SelectValue placeholder={!fileKind ? "Escolha o tipo acima" : "Selecione…"} /></SelectTrigger>
                <SelectContent>
                  {accountsForKind.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {fileKind && accountsForKind.length === 0 && (
                <p className="text-xs text-destructive">Nenhuma conta {fileKind === "credit_card" ? "de cartão" : "de débito"} cadastrada.</p>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Arquivo <span className="text-destructive">*</span></Label>
            <label className="flex items-center gap-2 rounded-md border border-input bg-background px-3 py-2 cursor-pointer hover:bg-accent/40 transition">
              <Upload className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm truncate flex-1">
                {file ? file.name : "Escolher .ofx, .csv ou .pdf"}
              </span>
              <input
                type="file"
                accept=".ofx,.csv,.pdf,application/pdf,text/csv"
                className="hidden"
                onChange={(e) => { setFile(e.target.files?.[0] ?? null); setParsed(null); }}
              />
            </label>
          </div>

          <Button
            onClick={handleParse}
            disabled={!file || !fileKind || !accountId || parsing}
            className="w-full sm:w-auto"
          >
            {parsing ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Analisando…</> : <><FileText className="h-4 w-4 mr-1" /> Ler arquivo</>}
          </Button>
          <p className="text-xs text-muted-foreground">
            O Finn lê o arquivo no seu navegador e usa IA para identificar valor, data, descrição e categoria sugerida. Você revisa antes de salvar.
          </p>
        </div>

        {parsed && parsed.length > 0 && (
          <div className="tile overflow-hidden">
            <div className="px-5 py-4 border-b border-border flex flex-wrap items-center gap-4">
              <div>
                <div className="font-medium">{selectedCount} de {parsed.length} selecionadas</div>
                <div className="text-xs text-muted-foreground">
                  Receitas {formatBRL(totalIncome)} · Despesas {formatBRL(totalExpense)}
                </div>
              </div>
              <Button
                onClick={() => setConfirmOpen(true)}
                disabled={selectedCount === 0 || importM.isPending}
                className="ml-auto"
              >
                <CheckCircle2 className="h-4 w-4 mr-1" /> Revisar e importar
              </Button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto divide-y divide-border">
              {parsed.map((t, i) => (
                <div key={i} className={`px-5 py-3 flex items-center gap-3 ${t._enabled ? "" : "opacity-40"}`}>
                  <Checkbox
                    checked={t._enabled}
                    onCheckedChange={(v) => {
                      setParsed((prev) => prev?.map((p, idx) => idx === i ? { ...p, _enabled: v === true } : p) ?? null);
                    }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate flex items-center gap-2">
                      {t.description}
                      {t._duplicate && (
                        <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide rounded-full border border-destructive/40 bg-destructive/10 text-destructive px-2 py-0.5">
                          <AlertTriangle className="h-3 w-3" /> possível duplicata
                        </span>
                      )}
                      {t._extras.kind === "recurring" && (
                        <span className="text-[10px] rounded-full border border-border bg-muted/50 px-2 py-0.5">🔁 recorrente</span>
                      )}
                      {t._extras.kind === "installment" && (
                        <span className="text-[10px] rounded-full border border-border bg-muted/50 px-2 py-0.5">📦 {t._extras.installments_count}×</span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {t.occurred_at}{t.suggested_category ? ` · ${t.suggested_category}` : ""}
                    </div>
                  </div>
                  <div className={`text-sm font-medium tabular-nums ${t.type === "income" ? "text-emerald-400" : "text-foreground"}`}>
                    {t.type === "income" ? "+" : "−"}{formatBRL(t.amount)}
                  </div>
                  <button
                    onClick={() => { setEditIdx(i); setEditDraft({ ...t, _extras: { ...t._extras } }); }}
                    className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent/40"
                    aria-label="Editar"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => setParsed((prev) => prev?.filter((_, idx) => idx !== i) ?? null)}
                    className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                    aria-label="Remover"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {parsed && parsed.length === 0 && (
          <div className="text-center text-sm text-muted-foreground py-8">
            Nenhuma transação detectada neste arquivo.
          </div>
        )}

        <Dialog open={editIdx !== null} onOpenChange={(o) => { if (!o) { setEditIdx(null); setEditDraft(null); } }}>
          <DialogContent className="max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Editar lançamento</DialogTitle>
            </DialogHeader>
            {editDraft && (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Descrição</Label>
                  <Input
                    value={editDraft.description}
                    onChange={(e) => setEditDraft({ ...editDraft, description: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Tipo</Label>
                    <Select
                      value={editDraft.type}
                      onValueChange={(v) => setEditDraft({ ...editDraft, type: v as "expense" | "income" })}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="expense">Despesa</SelectItem>
                        <SelectItem value="income">Receita</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Valor (R$)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={editDraft.amount}
                      onChange={(e) => setEditDraft({ ...editDraft, amount: Number(e.target.value) })}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Data</Label>
                    <Input
                      type="date"
                      value={editDraft.occurred_at}
                      onChange={(e) => setEditDraft({ ...editDraft, occurred_at: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Categoria</Label>
                    <Select
                      value={editDraft.suggested_category ?? "__none__"}
                      onValueChange={(v) => setEditDraft({ ...editDraft, suggested_category: v === "__none__" ? null : v })}
                    >
                      <SelectTrigger><SelectValue placeholder="Sem categoria" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Sem categoria</SelectItem>
                        {(categoriesQ.data ?? []).map((c) => (
                          <SelectItem key={c.id} value={c.name}>
                            {c.icon ? `${c.icon} ` : ""}{c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <TransactionExtras
                  mode="create"
                  value={editDraft._extras}
                  onChange={(v) => setEditDraft({ ...editDraft, _extras: v })}
                  accountIsCreditCard={accountIsCreditCard}
                  isExpense={editDraft.type === "expense"}
                  amount={Number(editDraft.amount) || 0}
                />
              </div>
            )}
            <DialogFooter>
              <Button variant="ghost" onClick={() => { setEditIdx(null); setEditDraft(null); }}>Cancelar</Button>
              <Button
                onClick={() => {
                  if (editIdx === null || !editDraft) return;
                  if (!editDraft.description.trim()) { toast.error("Descrição obrigatória"); return; }
                  if (!(editDraft.amount > 0)) { toast.error("Valor deve ser maior que zero"); return; }
                  if (!/^\d{4}-\d{2}-\d{2}$/.test(editDraft.occurred_at)) { toast.error("Data inválida"); return; }
                  setParsed((prev) => prev?.map((p, idx) => idx === editIdx ? { ...editDraft } : p) ?? null);
                  setEditIdx(null);
                  setEditDraft(null);
                }}
              >
                Salvar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={confirmOpen} onOpenChange={(o) => { if (!importM.isPending) setConfirmOpen(o); }}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Confirmar importação</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="rounded-lg bg-muted/40 p-3 grid grid-cols-3 gap-3 text-sm">
                <div>
                  <div className="text-xs text-muted-foreground">Lançamentos</div>
                  <div className="font-medium tabular-nums">{selectedCount}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Receitas</div>
                  <div className="font-medium tabular-nums text-emerald-400">{formatBRL(totalIncome)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Despesas</div>
                  <div className="font-medium tabular-nums">{formatBRL(totalExpense)}</div>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                Revise abaixo. Após confirmar, os lançamentos serão salvos
                {selectedAccount ? ` em "${selectedAccount.name}"` : ""}.
              </p>
              <div className="max-h-[40vh] overflow-y-auto rounded-lg border border-border divide-y divide-border">
                {(parsed ?? []).filter((t) => t._enabled).map((t, i) => (
                  <div key={i} className="px-3 py-2 flex items-center gap-3 text-sm">
                    <div className="flex-1 min-w-0">
                      <div className="truncate font-medium">{t.description}</div>
                      <div className="text-xs text-muted-foreground">
                        {t.occurred_at}{t.suggested_category ? ` · ${t.suggested_category}` : " · Sem categoria"}
                      </div>
                    </div>
                    <div className={`tabular-nums ${t.type === "income" ? "text-emerald-400" : ""}`}>
                      {t.type === "income" ? "+" : "−"}{formatBRL(t.amount)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setConfirmOpen(false)} disabled={importM.isPending}>
                Voltar para editar
              </Button>
              <Button onClick={() => importM.mutate({})} disabled={importM.isPending}>
                {importM.isPending
                  ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Importando…</>
                  : <><CheckCircle2 className="h-4 w-4 mr-1" /> Confirmar e importar {selectedCount}</>}
              </Button>

            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={!!dupes && dupes.length > 0} onOpenChange={(o) => { if (!o && !importM.isPending) setDupes(null); }}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{dupes?.length ?? 0} possíveis duplicatas detectadas</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground">
                Estes lançamentos parecem já existir nesta conta (mesma data ou próxima, mesmo valor e descrição similar). Você pode revisar e desmarcar individualmente, ou prosseguir.
              </p>
              <div className="max-h-[50vh] overflow-y-auto rounded-lg border border-border divide-y divide-border">
                {(dupes ?? []).map((d) => (
                  <div key={d.index} className="px-3 py-2 space-y-1">
                    <div className="flex items-center justify-between">
                      <div className="font-medium truncate">{d.candidate.description}</div>
                      <div className={`tabular-nums ${d.candidate.type === "income" ? "text-emerald-400" : ""}`}>
                        {d.candidate.type === "income" ? "+" : "−"}{formatBRL(d.candidate.amount)}
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {d.candidate.occurred_at} · já existente: “{d.existing.description ?? "Sem descrição"}” em {d.existing.occurred_at}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <DialogFooter className="flex-wrap gap-2">
              <Button variant="ghost" onClick={() => setDupes(null)} disabled={importM.isPending}>
                Revisar manualmente
              </Button>
              <Button
                variant="outline"
                disabled={importM.isPending}
                onClick={() => importM.mutate({ force: true, skip_indices: (dupes ?? []).map((d) => d.index) })}
              >
                Pular duplicatas e importar restante
              </Button>
              <Button
                disabled={importM.isPending}
                onClick={() => importM.mutate({ force: true })}
              >
                Importar todas mesmo assim
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>

  );
}
