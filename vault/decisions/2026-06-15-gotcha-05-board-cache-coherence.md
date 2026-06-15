---
type: adr
date: 2026-06-15
status: accepted
tags: [decision, gotcha]
related:
  [
    "[[2026-06-15-1259-phase2b-boards-interactive]]",
    "[[2026-06-15-phase-2b-boards-interactive-design]]",
  ]
---

# Gotcha 05 — with a staleTime:Infinity TanStack cache, every mutation must patch it (router.refresh() is ignored)

## Context

The board view (Phase 2b) reads from a TanStack Query cache `["board", boardId]` seeded from the
server payload with `staleTime: Infinity` + `initialData` and never refetched (it's kept fresh by
optimistic patches + the realtime channel). Two traps surfaced:

1. **`router.refresh()` does nothing visible.** A Server-Action mutation followed by
   `router.refresh()` re-runs the RSC and produces a new payload, but `useQuery` with `initialData`
   only seeds an EMPTY cache — it does not overwrite an existing entry. So add-item / rename appeared
   only via the realtime echo (fragile if realtime lags or drops). The e2e had to `reload()` to see
   a new item, which was the tell.
2. **Realtime effect resubscribe churn.** `boardKey(boardId)` returns a fresh array each render;
   putting it in a `useEffect` dep list re-ran the effect every render, tearing down + resubscribing
   the channel constantly.

## Decision

- **Every mutation path patches the cache directly** through the pure `cache.ts` helpers
  (`upsertCellValue`/`removeCellValue`/`insertItem`/`replaceItem`): cells optimistic; rename
  optimistic; add patch-on-success with the server-returned row (so no temp-id juggling). Do NOT
  rely on `router.refresh()` for anything the board view renders. (`router.refresh()` is still fine
  for OTHER consumers like the sidebar board list.)
- **Realtime handlers reconcile into the SAME cache via the SAME helpers**, with value-based
  echo-dedupe so a user's own write doesn't flicker.
- **Derive query keys inside the effect**, not from a render-scoped `const`, so realtime/effect
  deps stay stable (`[boardId, qc]`).

## Consequences

- Own edits reflect instantly without depending on realtime being connected; realtime is purely
  for OTHER users' changes (and is idempotent on re-apply).
- Every future surface that reads this cache (Kanban/Calendar in Phase 3, etc.) must follow the
  same rule: mutate → patch the cache, never assume a refetch.

## Related

- [[2026-06-15-1259-phase2b-boards-interactive]]
- [[2026-06-15-phase-2b-boards-interactive-design]]
