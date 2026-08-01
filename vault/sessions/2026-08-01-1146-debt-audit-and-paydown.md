---
type: session
date: 2026-08-01-1146
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-08-01-gotcha-68-a-posix-path-join-silently-disables-a-windows-escape-hatch]]"
  - "[[2026-07-31-gotcha-66-an-uncalled-use-server-export-is-still-a-live-endpoint]]"
  - "[[2026-07-31-1708-quality-sweep-crlf-dead-code]]"
---

# Debt audit and paydown

## What changed

- **Audited for technical debt** and re-verified all four gates independently. Found: two orphaned
  `"use server"` endpoints, eight untested server-action modules, a ledger gate that had not run for
  two sessions, and 29 patch/minor-behind dependencies.
- **`57e2c4a4` — debt paydown** (8 tasks, 8 parallel subagents, one shared worktree; commits
  serialized centrally because git's index is not concurrency-safe). Removed `bulkDeleteItems` +
  `bulkPurgeItems` and their schemas; added **+107 net tests** across seven previously-untested
  server-action modules (3669 → 3776). Plan committed at
  `docs/superpowers/plans/2026-08-01-debt-paydown-and-promotion.md`.
- **`59997249` — contract fixes** (2 parallel subagents). `getStatusColumnsForBoard` now honours its
  `ActionResult` contract in **both** copies (`portfolios/`, `goals/`); `goals/actions.ts` gained its
  first test file. `PG_BIN`/`PATH` fixed in `check-migration-ledger.mjs` —
  [[2026-08-01-gotcha-68-a-posix-path-join-silently-disables-a-windows-escape-hatch]].
- **Ledger gate restored and verified**: 118 files = 118 DEV rows, no drift, exit 0 — its first real
  run in two sessions.
- Three audit findings were **wrong on inspection** and corrected rather than acted on: the "10
  untested modules" were 8 (two matched `"use server"` in a comment), `platform/search-action.ts` is
  a delegation layer already covered by four test files, and the ledger gate was broken rather than
  unconfigured.

## Why

The previous session left all four gates green, which is exactly when debt stops being visible. The
audit targeted what gates structurally cannot see: reachable-but-uncalled endpoints, untested
mutation surface, and a check that had quietly stopped checking. Two of the three had already
recurred since being written up.

## How to test (for the user)

No user-facing behavior to test — verified by the test suite. One narrow exception: on a DB/RLS
failure the status-column picker now shows its own error state instead of Next's generic error
boundary. That path is not reachable from the UI and is covered by unit tests.

## Open threads

- **Phase A is untouched and remains the promotion blocker.** `item_embeddings` = 0 vs 439 live prod
  items, while the pending changelog announces semantic search. Runbook is in the committed plan —
  it is precondition-gated because a missing Vault secret makes the sweep report success while
  draining nothing.
- **Advisory follow-ups recur.** gotcha-66's "worth a periodic sweep" found two more orphaned
  endpoints one session later; the ledger gate's exit-3 warning was ignored twice. Both the
  orphaned-export detector and a ledger-staleness check should become **gates, not advice**.
- Pinned-not-fixed, all now covered by tests: `archiveBoard`'s non-owner message says "delete";
  `reorderColumn` / `resizeNameColumn` delegate org-scoping entirely to RLS with no application-layer
  check; `getBoardStatusColumns` drops a column's **whole** option list when one option fails
  validation; `deleteBoard` / `purgeBoard` free Storage after the row delete, orphaning objects if
  the cleanup throws.
- 29 dependencies behind, all patch/minor, no majors. Widest: `lucide-react` 1.18 → 1.28,
  `radix-ui` 1.5.0 → 1.6.7.

## Next session entry point

Run Phase A of `docs/superpowers/plans/2026-08-01-debt-paydown-and-promotion.md` (owner-executed:
verify the two Vault secrets, enqueue, confirm the queue actually drains), then promote
`develop → main`. Everything else on `develop` is green and merged.
