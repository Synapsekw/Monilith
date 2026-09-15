/**
 * A minimal PostgREST query-builder double that resolves to `row` ONLY when
 * every `.eq(column, value)` filter chained onto it actually matches the
 * row — not merely when the row is satisfiable in principle.
 *
 * Used to prove a scoping filter (e.g. `.eq("org_id", org.id)`) is genuinely
 * SENT by the code under test, rather than assumed. A double that returned
 * the row regardless of which filters were chained could not tell a scoped
 * read from an unscoped one, so a test built on THAT double would still pass
 * if the scoping filter were silently dropped from the implementation — the
 * whole point is that dropping `.eq("org_id", …)` (or whichever filter a
 * cross-tenant test exists to pin) makes that test fail, which is the only
 * way such a test means anything.
 *
 * Thenable rather than terminated by one specific method, so it supports
 * whatever chain shape the caller under test builds —
 * `.select().eq().maybeSingle()`, `.select().eq().eq().maybeSingle()`,
 * `.select().order().limit().maybeSingle()`, etc. — without needing a new
 * double per call shape.
 *
 * Shared by `src/lib/ai/board-intelligence/ask-route.test.ts` and
 * `src/lib/ai/board-intelligence/qa-thread.test.ts`, which both prove the
 * same org-scoping shape on the same table (`board_intelligence_runs`) for
 * two different call sites.
 */
export function filteringChain(row: Record<string, unknown> | null) {
  const filters: [string, unknown][] = [];
  const q: Record<string, unknown> = {};
  for (const m of ["select", "order", "limit", "maybeSingle", "single"])
    q[m] = () => q;
  q.eq = (column: string, value: unknown) => {
    filters.push([column, value]);
    return q;
  };
  (q as { then: (res: (v: unknown) => void) => void }).then = (res) =>
    res({
      data: row && filters.every(([c, v]) => row[c] === v) ? row : null,
      error: null,
    });
  return q;
}
