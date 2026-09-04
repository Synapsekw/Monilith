---
type: session
date: 2026-09-04-1253
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-08-27-1327-admin-route-skeletons]]"
  - "[[2026-08-26-1705-sidebar-board-folders]]"
---

# Close the three stalled worktrees

## What changed

- **Found three `task/*` worktrees frozen since 2026-08-27**, each with committed work AND
  uncommitted changes, none merged. All three closed out and merged to `develop` one at a time:
  `sidebar-folders-hardening` (`bef8033d`), `agent-pdf-output` (`d9d129d1`), `agent-memory-2c`
  (`b2d00dec`). 35 commits now unpromoted, 31 of them source. Ledger **152/152**, no worktrees,
  no `task/*` branches.
- **`agent-pdf-output` had died with HTML escaping switched off.** `escapeHtml` in
  `src/lib/boards/markdown-html.ts` short-circuited to `return s;` behind a comment promising it
  would be "RESTORED IMMEDIATELY AFTER" a CSP experiment. That module is shared with board markdown
  rendering. Restored before committing — see [[2026-09-04-gotcha-98-a-disabled-guard-outlives-the-session-that-disabled-it]].
- **An applied-but-uncommitted migration was one `git worktree prune` from being lost.**
  `20260827105257_agent_forget_and_memory_containment.sql` was live on DEV with its file untracked
  in a worktree. Committed first, before any other work.
- **Spec 2c (agent memory) is complete on `develop`** — all 7 plan tasks, plus the review-repair
  pass that was sitting uncommitted: `agent_forget()` closing a delete-then-rewrite bypass of the
  owner-note refusal, the marker guard rejecting the LABEL rather than the colon-terminated
  sentinel, all seven line-break characters, and `token_estimate` pricing the rendered `- key:
  value` line instead of the bare value. `MEMORY_MAX_VALUE_CHARS` 500 → 380, derived from the
  proposal-summary clamp.
- **Sidebar folders hardening**: nav sync key made unforgeable with a length prefix, a failed
  folders read now distinguishable from a user with no folders (a Supabase blip used to wipe every
  persisted `folder:*` collapse key permanently), and the delete dialog closes when the folder is
  already gone.
- **Announced 4 entries on `/updates`** dated 2026-09-04 — the three board fixes and agent PDF
  output. Agent memory deliberately NOT announced: it ships inert.

## Why

Three sessions had been killed mid-task eight days earlier and left ~8,900 lines of finished,
tested work stranded on branches nobody would find. Two carried real hazards that a deleted
worktree would have converted into silent damage: an XSS hole one commit from landing, and a DEV
ledger row whose DDL existed in no git object anywhere.

## How to test (for the user)

Setup: `git pull` on `develop`, then `pnpm install && pnpm dev`.

1. Create a board folder and collapse it. Hard-refresh — the collapse state should survive.
2. Open a second tab, delete that folder there, then delete the same folder in tab one. The dialog
   should **close and refresh**, not dead-end on "That folder no longer exists." with only Cancel.
3. Drag a board into a folder. Then do it by keyboard: Tab to a board's drag handle, Space to lift,
   arrows to move, Space to drop.
4. Run a personal agent and ask it to produce a PDF. Approve the `create_pdf` proposal — the PDF
   should attach and open in the viewer.
5. Agent memory: nothing to see, by design. Confirm `/settings/agents` loads without errors.

## Open threads

- **35 commits unpromoted on `develop`** (31 source) — Spec 2c, agent PDF output and the sidebar
  hardening are all waiting on a `develop → main` promotion.
- **Agent memory ships installable-but-inert** by the 2026-08-27 owner ruling: the ceiling backfill
  was never run, so every memory write is denied by the org clamp and no proposal is recorded. An
  admin must open the org ceiling before the feature does anything. Not announced on `/updates`
  for that reason.
- The `agent_memory` RLS integration test only runs with `PULSE_TEST_DB` set, so it did not execute
  in any gate this session; `agent_forget`'s owner-note refusal is covered by the emulating fake in
  `memory-db.fake.ts` instead.
- Two stale `_draft-*.md` stubs folded in and deleted.

## Next session entry point

Promote `develop → main` (`/promote`) — the 31 source commits include two security repairs that are
worth getting in front of users. Then `/whats-next` for the Spec 3 vs E6 Stripe call.
