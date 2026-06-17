---
type: adr
status: active
date: 2026-06-17
tags: [decision, gotcha]
related:
  [
    "[[2026-06-17-1929-phase2c-column-management]]",
    "[[2026-06-16-gotcha-09-rsc-nav-refetch-on-view-switch]]",
  ]
---

# Gotcha 13 — a create that renders only via the Realtime echo silently fails when the echo lags

## Symptom

Phase 2c's "Add column" passed typecheck, lint, 337 unit tests, build, and the live RLS
integration — but the Playwright e2e failed: after clicking a kind in the add-column menu, the new
column **never appeared** in the table. The page snapshot showed only the seeded columns. The DB row
was created; the UI just never learned about it.

## Context

`addColumnMutation` was written **server-authoritative**: `createColumn` returned only
`{ columnId }`, the mutation had no `onMutate`/`onSuccess` cache write, and the new column was meant
to arrive **solely** through the `columns` Realtime INSERT echo (`onColumn` → `insertColumn`). On a
freshly-created board the INSERT fires around the same time the per-board Realtime subscription is
still settling, so the echo is missed — and because there is no optimistic insert, nothing else ever
renders the column. (Unlike rename/resize/delete, which are optimistic and roll back, add had no
fallback.) Unit tests mock the action and never exercise the subscription, so only the e2e — the one
layer running the real Supabase Realtime channel — caught it.

The sibling `addItemMutation` already did it right: `createItem` returns the full row and
`onSuccess: ({ item }) => insertItem(prev, item)`, with the comment "Realtime INSERT echo is
idempotent via `insertItem`."

## Decision

For any create backed by a Realtime subscription, **insert the returned row optimistically on
success and let the echo de-dupe** — do not rely on the echo as the sole render path. Concretely
(commit `f2fa6f7`): `createColumn` returns the full row (`.select("*")` → `{ column }`), and
`addColumnMutation.onSuccess` calls `insertColumn(prev, column)`. `insertColumn`/`insertItem` are
no-ops when the id already exists, so the later Realtime echo never double-adds. Mirror `addItem`.

## Rationale

Supabase Realtime is best-effort and subscription setup is async: an INSERT can land before the
channel is ready, the socket can drop, or the row can be filtered out (e.g. DELETE payloads carry
only the PK — see the `REPLICA IDENTITY FULL` caveat). Treat the echo as **reconciliation for
peers**, never as the local actor's source of truth. The acting client already has the authoritative
result from the Server Action; render it immediately, idempotently.

## Consequences

- Positive: the column appears instantly and survives Realtime hiccups; peers still converge via the
  de-duped echo. Consistent with `addItem`.
- Process: **`pnpm e2e` is the gate that catches Realtime-render gaps** — unit/typecheck/lint/build
  cannot. Run it for any feature whose UI depends on a subscription.
- Pattern to copy for future create flows (subitems, relations, etc.): action returns the full row →
  `onSuccess` inserts via an id-idempotent cache mutator → Realtime echo de-dupes.

## Related

- [[2026-06-17-1929-phase2c-column-management]]
- [[2026-06-16-gotcha-09-rsc-nav-refetch-on-view-switch]]
