---
type: session
date: 2026-08-04-1907
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-08-04-1443-board-dock-and-ai-move-verb]]"
  - "[[2026-08-04-decision-34-a-docked-thread-belongs-to-its-boards-org]]"
  - "[[2026-08-04-gotcha-75-a-zero-row-repair-reports-success]]"
---

# Promotion, then the three AI-write follow-ups

## What changed

- **Promoted `develop → main`** — PR #83, squash `bfc238d3`, 31 commits. Board agent-thread dock +
  `propose_move_item` are live. The squash divergence was healed with `-s ours` (`46c8b117`).
  The vault said `main` was at `7d98230c` with four features pending; it was actually at `0548bdfb`
  — PR #82 had already shipped E6 billing + the Keystone wash on 2026-08-03.
- **`query_items` now emits item ids** (`1645b694`). `runQueryItems` had `item.id` in hand and
  dropped it, leaving `semantic_search_items` as the only id source for the whole write path. All
  four write verbs' descriptions were also wrong about where an id comes from —
  `propose_set_item_fields` named **no source at all**. Guarded by `id-sources.test.ts`, which runs
  each named read tool's real handler and asserts the id is in the JSON the model receives.
- **A docked thread is now coupled to its board's org** (`b3dd8a44`, [[2026-08-04-decision-34-a-docked-thread-belongs-to-its-boards-org]]).
  Composite FK `(board_id, org_id) → boards (id, org_id)` with the PG15+ column-list action
  `ON DELETE SET NULL (board_id)`, plus an app-layer guard. 0 drifted rows on DEV, measured three
  times.
- **An approved AI write renders without a reload** (`e84e34ee`). `executeAction` returns a transient
  `BoardEffect` beside its `ExecutionResult`; one hook folds it into the board's TanStack cache via
  the mutators drag-and-drop already uses. Zero new round-trips, both approve surfaces.
- 4329 tests passing, ledger 131/131, all three worktrees merged and cleaned.

## Why

`propose_move_item` shipped yesterday and was dead in practice — the owner hit it the same day
("none of my tools returned the item's internal ID"). That is [[2026-08-04-gotcha-73-a-tool-description-is-untested-surface-and-can-ship-a-dead-verb]]
one layer down: the verb was reachable, the id feeding it was not. Fixing it exposed the next two
gaps in the same path, so all three were closed as one batch before more verbs get added.

## How to test (for the user)

Pull `develop`. Needs a board with at least two groups and one item.

1. Open the board, click **Open agent dock** on the right edge.
2. Type `move "<item name>" to <other group>` and send.
3. Expect a confirm card naming the item and target group. (Before `1645b694` the agent refused,
   saying it could not find the item's id.)
4. Click **Approve** — the row should move **behind the dock immediately**, with no reload, no
   flicker, and no loss of scroll position.
5. Repeat via **⌘K** — that path uses a different Server Action and must behave identically.
6. Click **Cancel** on a proposal instead: the board must not change at all.
7. Multi-org only: switch the org picker to another org, return to this board, and send in the dock
   → `This board is in a different organization. Switch to it to chat here.`

## Open threads

- **`reconcile-migration-version.sh` is broken as printed** — its `WHERE name = '<slug>'` matches
  zero rows and reports success ([[2026-08-04-gotcha-75-a-zero-row-repair-reports-success]]).
  `apply_migration` mis-stamping is now **5 for 5**, so this sits on every future migration.
- **`finish-task.sh`, two faults.** Its `rm -f vault/sessions/_draft-*.md` runs before the clean-tree
  check, so a *committed* draft breaks the script for every session in the repo (one had been
  committed in `023b4676`; removed). And it can exit 0 leaving an **orphaned vitest running against
  live DEV** — killed and DEV re-verified at 12 rows / 0 drifted.
- **The "Directory not empty" worktree failure has two causes on Windows**, distinguished by the
  error text: *"used by another process"* is a real lock; *"Could not find a part of the path ..."*
  is the `MAX_PATH` limit on deep `node_modules`, which no amount of process-killing fixes.
  `cmd /c rd /s /q "\\?\<path>"` clears it — this also removed `keystone-wash`, stuck since an
  earlier session.
- **Four stale remote branches** — `task/perf-tier3`, `task/pwa-shell`,
  `task/rename-board-shared-tag`, `task/widget-preview-live` — 1 unmerged commit each, untouched
  since 2026-07-03, despite §3 having claimed everything was cleaned up.
- The Realtime echo diagnostic was **not** run: whether `board:<id>` already echoes an AI write to
  the acting client is still unknown. The fix is correct either way; an echo de-dupes idempotently.
- The `e2e/ai-write-visibility.spec.ts` proof was **authored but never executed** — it needs a live
  model, so it is gated behind `E2E_AI_WRITES=1`.
- `resolveCreateItem`'s "That group isn't on this board." still has the archived-group inaccuracy
  that was fixed for move.

## Next session entry point

`develop` @ `e84e34ee` leads `main` by all three fixes — **`/promote`** when ready. Then the real
choice is **Report Builder v2** (the stated critical path) or the **E6 Stripe track**, which is not
blocked on credentials. The tooling fixes above are small and would pay for themselves immediately.
