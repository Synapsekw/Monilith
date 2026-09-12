---
type: session
date: 2026-09-12-0100
branch: develop
trigger: wrapup
status: complete
tags: [session]
related: []
---

# Agent dock atmosphere — retire DockTabs/AgentSwitcher, close the plan

## What changed

- Deleted the four files the tile-band dock rebuild made obsolete: `src/components/boards/dock/DockTabs.tsx` + its test, `src/components/boards/dock/AgentSwitcher.tsx` + its test — confirmed by grep first that nothing still imported them (`DockBody.tsx` already pulled `DockAgent` from `./DockTiles`, per Task 4).
- Committed the retirement (`refactor(boards): retire the dock pill tabs and the native agent switcher`) with a user-facing `Changelog: improved | Your agents front and centre in the board dock | …` trailer, then regenerated and committed `src/lib/changelog/generated.ts` (one new entry, dated today).
- Ran the full gate twice — once pre-rebase in the task worktree, once inside `finish-task.sh` against the rebased-onto-`develop` state: `pnpm typecheck` clean, `pnpm lint` 0 errors, `pnpm test` 809 files / 7610 tests passed (1 skipped, no failures), `pnpm build` succeeded (67 pages).
- `scripts/finish-task.sh` merged `task/agent-dock-atmosphere` into `develop` (`348dd546`), pushed, and removed the worktree + branch — this closes the 5-task agent-dock-atmosphere plan (T1 slot/portal/mini-rail shell, T2 `DockTiles`+pulse-ring, T3 chat `surface`/`onBusyChange`, T4 `DockBody` relayout/wiring/motion, T5 this closing task).
- Housekeeping: deleted two stale auto-generated session drafts (`_draft-2026-09-11-1728.md`, `_draft-2026-09-11-1930.md`) left by the Stop hook from unrelated Board Intelligence Phase 2 / gotcha-99 work already captured in real session notes and an ADR.

## Why

Closing task of a plan (`docs/superpowers/plans/2026-09-11-agent-dock-atmosphere.md`) that replaced the board's pill-tab dock switcher and native `<select>` persona picker with a tile band (Board Intelligence · Ask · one tile per agent). This task's job was purely to retire the now-dead code once the rebuild (Tasks 1–4) had re-pointed every import, prove the repo builds clean without it, and announce the visible change on `/updates`.

## How to test (for the user)

Pull `develop`, `pnpm dev`, sign in, open a board on a desktop-width window; check dark and light.

1. **Placement:** the dock sits to the right of the board card on the periwinkle wash with no divider; the card's right gutter matches its left.
2. **Band:** tiles read Intelligence · Ask · your agents; hovering shows names; the active tile has a periwinkle bar under it. Press → / ← to move (focus and selection move together); Home/End jump to the ends.
3. **Talk:** click an agent tile — a new thread starts on that agent; the title row reads "New thread" with the agent's name as the kicker; ask something — the agent's tile dot pulses while it answers and stops when the answer lands. Click the same tile again — nothing changes. Click Ask — a new plain thread.
4. **Threads:** click the THREADS ledger — the list unfolds under the title (count on the right); pick an older thread — the ledger folds again and the transcript shows that thread; its title and persona are in the title row.
5. **Collapse:** click the close icon — the column folds to a thin rail of the same tiles over ~0.4s; drag the left edge of the open dock — it resizes instantly (no easing). Click any tile in the rail — it opens on that tile.
6. **Intelligence:** the first tile shows the suggestion count ("Intelligence · N suggestions" on hover); clicking it opens the Intelligence body on the wash, unchanged inside; New is hidden on that tab.
7. **Phone width:** narrow the window below 768px — the floating button still opens the full-screen sheet with the same interior (band, title, ledger, transcript).
8. **`/ask`:** open `/ask` — the centred column, muted user bubbles and the composer strip with its top hairline are exactly as before.
9. **`/updates`:** the new "Your agents front and centre in the board dock" entry appears under today's date.

## Open threads

- None from this task. The plan is fully closed: merged, pushed, worktree + branch removed. The browser walkthrough above is still owed (no authenticated browser this session) — it's the first thing to run before promoting.
- This work adds to `develop`'s unpromoted delta alongside the already-queued Anthropic-adapter fix, Board Intelligence Phase 2, and the sidebar Keystone polish — see north-star §3 Branch/Next.

## Next session entry point

Promote `develop → main` — it now also carries the agent-dock-atmosphere rebuild — and add this task's walkthrough (above) to the pre-promotion manual-test batch alongside the three already queued in the north-star's Next bullet.
