---
type: session
date: 2026-06-23-2110
branch: develop
trigger: wrapup
status: complete
tags: [session]
related: ["[[2026-06-23-2017-percent-progress-board-column]]"]
---

# Column-add error surface

## What changed

- `addColumn` (`use-board-mutations.ts`) now accepts a `callbacks?.onError` and forwards it to react-query's `mutate`, adopting the same convention `addGroup`/`addDependency`/`addItem` already use. Previously a failed `createColumn` threw into an unhandled mutation — zero user feedback.
- `BoardTable.tsx` gained a board-level `columnError` state + a dismissible `role="alert"` banner (semantic tokens, `text-destructive`; mirrors `AddItemRow`'s inline-error pattern — no toast primitive in the project). Wired into all three add-column paths: direct add, relation config, mirror config.
- TDD: added `addColumn` success + `onError`-surfacing tests to `use-board-mutations.test.tsx` (mocked `createColumn`); confirmed red→green. Merged to `develop` as `354c0a0` (fix `14b68e2`, 3 files, +116/−5).
- finish-task's first pass aborted on the known flaky shared-DB integration suites (automations/RLS contention, unrelated); retried in a quiet window → full gate green (1360 tests).

## Why

Triggered by a real report: "nothing happens when I click add percent column." Root cause was a stale dev server serving a pre-merge `columnKindSchema`, but the reason it was invisible (not an error) was this silent swallow. Surfacing the failure turns a 30-minute mystery into a one-line message for any future column-add failure.

## How to test (for the user)

1. Pull `develop` and restart the dev server (`pnpm dev`).
2. Open a board → click the **+** (add column) → pick any kind. On success the column appears as before (no regression).
3. To see the error surface: temporarily break a column add (e.g. a relation column targeting a board you can't access, or simulate a failing `createColumn`) → a dismissible red banner appears under the board header: "Couldn't add column: <reason>".
4. Click the **×** on the banner → it dismisses; starting another add clears it automatically.

## Open threads

- `dash-chart-measure-fix` worktree still active (another session).
- `develop` bundle still owed a production `/promote` (now includes this fix).
- The optimistic mutations (rename/resize/delete/reorder) still only roll back silently on error — they give visual feedback but no message. Out of scope here; a follow-up could route them through the same surface. Broader infra fix for the flaky gate tracked in [[2026-06-23-gotcha-43-shared-db-integration-test-flake]].

## Next session entry point

`develop` is green at `354c0a0`. Run `/promote` to ship the accumulated bundle, or continue Phase 9.3 cache / 9.4 skeletons.
