---
type: session
date: 2026-07-10-1727
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-07-10-1011-keystone-promote-changelog]]"
  - "[[dark-first-monday-reskin]]"
---

# Keystone secondary-surface polish — spec, plan, Waves 0–1 shipped

## What changed

- **Brainstormed + spec'd + planned** the Keystone secondary-surface polish: full-bespoke Keystone treatment for ~14 app surfaces + core touch-ups, **Approach B** (cluster worktrees, ship incrementally). Spec `docs/superpowers/specs/2026-07-10-keystone-secondary-surfaces-polish-design.md`, plan `docs/superpowers/plans/2026-07-10-keystone-secondary-surfaces-polish.md` (Waves 0–1 in full TDD detail; 2–6 just-in-time).
- **Wave 0 — Foundation** shipped to `develop` (`bb87ac5`): two tested primitives — `<MetaChip>` (mono `LABEL value`) and `<ColorChip>` (arbitrary-hue AA-safe soft pill, extracted from board `OptionPill`'s `softPillText` pattern). Token-export audit confirmed all utilities present (no globals.css change).
- **Wave 1 — Board views** shipped to `develop` (`bccae63`): Calendar, Gantt, Kanban each got the four cross-cutting moves (labels→`<Kicker>`, chips→`<ColorChip>`/soft, `.card-lift`+brightening hairlines, `rounded-sm`/`shadow-card`) via 3 parallel subagents. Decorative color dots + gantt milestone diamond intentionally left solid.
- **Execution:** subagent-driven in nested worktrees; parallel implementers built disjoint surfaces _without touching git_ (avoids index.lock races), orchestrator committed each surface sequentially + ran spec/quality review + gates + `finish-task`. All gates green throughout (test 2582 passing). Killed one orphaned Playwright test-server.

## Why

The core Keystone reskin shipped to prod (PR#55) but every other app surface only inherited the palette — none got the bespoke layer. This pass adds it at full depth, shipping cluster-by-cluster so each is verifiable in isolation and prod churn stays low.

## How to test (for the user)

1. `git checkout develop && git pull`, then restart `pnpm dev` (the morning dev server serves pre-Wave-1 code) and log in; open a board with dated/statused items.
2. **Kanban:** column headers are mono kickers; colored column label is a soft translucent chip; count chip is `rounded-sm` (not a pill); hovering a card lifts it + brightens its hairline; drag/drop still works.
3. **Timeline/Gantt:** name-rail + "Blocked by" labels are kickers; task bars are soft translucent tints (`rounded-sm`), brighten on hover; milestone diamonds stay solid; drag/resize unchanged.
4. **Calendar (Month/Week/Agenda):** weekday headers are kickers; colored events are soft chips that lift on hover and still open the panel; small event dots stay solid.
5. Toggle **dark ↔ light** across all three views — soft chips stay AA-legible, no layout breakage.

## Open threads

- **Waves 2–6 remain:** 2 Dashboards (next; preserve `chart-*` data) · 3 Admin & entry (Settings/Auth/Onboarding; Auth roughest) · 4 Planning (Goals/Portfolios/Workload) · 5 Personal & chrome (My Work/Time/Notifications/Command palette) · 6 Core touch-ups (sidebar wordmark, item-panel `<MetaChip>` + tab counts, `@mention` accent, sidebar easing).
- **Not promoted:** `main` is behind `develop` — decide promote-now vs. batch more clusters before `/promote`.
- **Deferred cleanup:** DRY board `OptionPill` onto `<ColorChip>` (kept Wave 0 surface-free on purpose).
- **Owed (unchanged, blocking prod):** add `/auth/callback` to Supabase **PROD** Auth Redirect URLs allowlist.
- Gotchas logged for reuse: `pnpm test -- <path>` doesn't filter (use `pnpm exec vitest run --project unit <path>`); untracked `_draft-*.md` blocks `finish-task`.

## Next session entry point

Start Wave 2 (Dashboards): recon → write its plan section → `scripts/start-task.sh keystone-dashboards` → parallel subagents → gates → `finish-task`. Or run `/promote` first to ship Waves 0–1 to prod. A full handover prompt covering the workflow + gotchas was produced this session.
