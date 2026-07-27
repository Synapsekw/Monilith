---
type: session
date: 2026-06-16-2009
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-06-16-decision-08-dark-first-monday-reskin]]"
  - "[[2026-06-16-gotcha-10-stage-untracked-subagent-files]]"
---

# Dark-first reskin + Calendar & Timeline views

## What changed

- **Dark-first reskin (RS):** translated the in-repo Monday prototype's near-black palette into `.dark` `@theme`/OKLch tokens + elevation/scrollbar/animations; default theme set to dark; applied "direction C" density to the board surfaces (table rows, pills, kanban, chrome). Commits `bd11add`, `3f2fc78`.
- **Calendar view:** `view_kind` enum migration + `dates.ts`/`calendar.ts` pure logic + `CalendarBoard` (month grid, drag-reschedule, add-on-day, Unscheduled) + per-kind view config + ViewSwitcher menu. Commits `2738f24`, `e4ba1fa`.
- **Timeline/Gantt + dependencies:** `item_dependencies` migration (cycle-safe RPC + RLS), dependency data layer (payload/cache/realtime/mutations/actions), `gantt.ts` logic, `GanttBoard` (bars, milestones, dep arrows + violation flags, drag/resize), RLS integration tests (23 green). Commits `d427af8`, `30c60ec`, `82a3a26`, `a74b71a`, marker fix `3d0658e`.
- **Process:** brainstormed the reskin via the visual companion (chose "direction C"); wrote spec + plan; built via subagent-driven dev with per-task verification; two migrations applied by the user (MCP is read-only).

## Why

This session turned the planned-but-light "dark Monday" intent into reality: the user loves the prototype's look, so we made dark the lead and shipped the two missing Phase 3b views. Reuse map (decision-08) kept us porting the prototype's UI/logic onto Monolith's Supabase spine, never its Zustand/localStorage architecture.

## Open threads

- **#2 remaining:** Dashboard view (needs a `dashboard` view_kind migration + `recharts` dep) and ItemPanel (needs an updates/comments schema migration).
- **#4:** light-mode reskin to match direction C (no prereqs) — still pending.
- Untracked `docs/superpowers/plans/2026-06-16-board-view-perf-amplifiers.md` appeared mid-session (not mine) — left as-is for the owner.
- Visual: reskin + Calendar + Timeline verified by the user; markers fixed.

## Next session entry point

Pick up from the next-step menu: light-mode reskin (cheapest), or Dashboard (migration + recharts), or ItemPanel (schema). All board view/logic patterns now live in `src/components/boards/*Board.tsx` + `src/lib/boards/{dates,calendar,gantt}.ts`.
