---
type: session
date: 2026-06-18-1128
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-06-18-0818-dashboards-d3b-list-filter]]"
  - "[[2026-06-18-1128-gotcha-16-use-server-sync-export]]"
---

# Phase 8 — built-in board templates

## What changed

- Shipped the **templates** slice of Phase 8 (subagent-driven, commits `d678094..f99ccb6`, pushed):
  a built-in catalog of 4 templates (Blank/Sprint/Content/CRM, donor-ported, mapped to Pulse's 6
  column kinds), a `createBoardFromTemplate` Server Action + pure `buildTemplatePayload` (mints
  uuids, resolves date offsets), an atomic `create_board_from_template` RPC (security definer,
  membership-checked — **applied to cloud + types regenerated**), and a sidebar template picker.
- Tests: catalog integrity + payload unit + live RLS integration (2/2: full seed + `42501`) + e2e
  (Sprint board create). Full gate green: typecheck, lint (0 err), **424 tests**, build.
- Caught a real bug: `buildTemplatePayload` (sync) exported from the `"use server"` actions module
  500'd board pages at runtime; moved it to `src/lib/boards/template-payload.ts` (`daafafa`). ADR
  [[2026-06-18-1128-gotcha-16-use-server-sync-export]].
- Bundled a parallel session's **completed** work found uncommitted in the shared checkout: inline
  group/board-header rename (`03137fb`, fixed a `set-state-in-effect` lint error) + command-palette
  `<Command>` wrapper fix (`962c4ff`).
- Allowlisted test/lint/build/git commands in `.claude/settings.json` (`ed41d53`) — background
  subagents can't answer permission prompts, so unlisted commands hard-block them.
- Final review verdict **SHIP WITH NITS**; fixed both nits (`cells === 14`; unknown-template unit test).

## Why

Closes the templates portion of Phase 8 (dashboards + templates + ⌘K). Templates were the missing
"new board" on-ramp — before this, every board started as the bare Group-1 + Status/Owner/Date seed.

## Open threads

- Non-blocking review follow-ups: `buildTemplatePayload` uses non-null assertions on option lookups
  (covered by the catalog test, no runtime guard); the New-board dialog uses `workspaces[0]` so
  multi-workspace users only target the first (pre-existing, same as old `createBoard`); `createBoard`
  / `createBoardSchema` may now be dead code — verify before removing.
- Not yet **user-verified in the live app** (picker + seeded boards). People cells seed empty by
  design; sample dates resolve relative to creation day.

## Next session entry point

Phase 8 remaining: **⌘K polish** (wire real navigation / create / search into the existing command
palette stub) — that was the planned "templates first, ⌘K next" split. Then light-mode reskin or
Phase 5 (Automations).
