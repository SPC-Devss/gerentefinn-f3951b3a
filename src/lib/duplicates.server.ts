/**
 * Verificação compartilhada de possíveis lançamentos duplicados.
 *
 * Critério:
 * - Mesma conta (ou ambos sem conta)
 * - Mesmo tipo
 * - Mesmo valor (com tolerância de 1 centavo)
 * - Data com diferença de até 1 dia
 * - Descrição com similaridade >= SIM_THRESHOLD (normalização: lower + sem
 *   acento + espaços colapsados; similaridade = 1 - dist. Levenshtein / max(len)).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type DuplicateCandidate = {
  account_id: string | null;
  type: "income" | "expense" | "transfer";
  amount: number;
  occurred_at: string; // YYYY-MM-DD
  description: string;
};

export type ExistingTx = {
  id: string;
  description: string | null;
  occurred_at: string;
  amount: number;
  type: string;
  account_id: string | null;
};

export type DuplicateMatch = {
  candidate: DuplicateCandidate;
  index: number;
  existing: ExistingTx;
};

const SIM_THRESHOLD = 0.7;

function normalize(s: string): string {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const m = a.length, n = b.length;
  const prev = new Array<number>(n + 1);
  const curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }
  return prev[n];
}

function similarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na && !nb) return 1;
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const max = Math.max(na.length, nb.length);
  return 1 - levenshtein(na, nb) / max;
}

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

/**
 * Para cada candidato, retorna no máximo um match (o de maior similaridade).
 */
export async function findPossibleDuplicates(
  sb: SupabaseClient,
  userId: string,
  candidates: DuplicateCandidate[],
): Promise<DuplicateMatch[]> {
  if (candidates.length === 0) return [];

  // Coleta janela de datas (±1 dia) e contas envolvidas
  const dates = new Set<string>();
  const accountIds = new Set<string>();
  let hasNullAccount = false;
  for (const c of candidates) {
    dates.add(addDays(c.occurred_at, -1));
    dates.add(c.occurred_at);
    dates.add(addDays(c.occurred_at, 1));
    if (c.account_id) accountIds.add(c.account_id);
    else hasNullAccount = true;
  }

  let query = sb
    .from("transactions")
    .select("id,description,occurred_at,amount,type,account_id")
    .eq("user_id", userId)
    .in("occurred_at", Array.from(dates));

  // Filtra por contas envolvidas se possível (reduz payload)
  if (accountIds.size > 0 && !hasNullAccount) {
    query = query.in("account_id", Array.from(accountIds));
  } else if (accountIds.size > 0 && hasNullAccount) {
    // mistura: precisamos pegar tudo nas datas, não restringe
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const existing = (data ?? []) as ExistingTx[];

  const matches: DuplicateMatch[] = [];
  candidates.forEach((c, index) => {
    let best: { row: ExistingTx; score: number } | null = null;
    for (const e of existing) {
      // Mesmo tipo
      if (e.type !== c.type) continue;
      // Mesma conta (ou ambos null)
      const accMatch =
        c.account_id == null ? e.account_id == null : e.account_id === c.account_id;
      if (!accMatch) continue;
      // Valor com tolerância de 1 centavo
      if (Math.abs(Number(e.amount) - c.amount) > 0.01) continue;
      // Diferença de até 1 dia
      const diffMs = Math.abs(
        new Date(e.occurred_at + "T00:00:00Z").getTime() -
          new Date(c.occurred_at + "T00:00:00Z").getTime(),
      );
      if (diffMs > 24 * 60 * 60 * 1000) continue;
      // Similaridade da descrição
      const sim = similarity(e.description ?? "", c.description ?? "");
      if (sim < SIM_THRESHOLD) continue;
      if (!best || sim > best.score) best = { row: e, score: sim };
    }
    if (best) matches.push({ candidate: c, index, existing: best.row });
  });

  return matches;
}
