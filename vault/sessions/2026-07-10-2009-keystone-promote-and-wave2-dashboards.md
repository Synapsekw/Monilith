---
type: session
date: 2026-07-10-2009
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-07-10-1727-keystone-secondary-surfaces-waves-0-1]]"
---

# Keystone: promote Waves 0–1 to prod + ship Wave 2 (Dashboards)

## What changed

- **Promoted Waves 0–1 to production** via `/promote` — PR#56 (`Promote develop → main: Keystone board-view polish + soft-chip primitives`), squash-merged; `main` `74db50a → e9ec8f2`. Main CI + Vercel prod deploy both green. Applied the gotcha-32 `-s ours` heal (`179a7b5`) so the next promotion stays clean.
- Also pushed the previously-local wrapup commit `3fcc202` (unblocked the promote hard-stop) before opening the PR.
- **Shipped Wave 2 · Dashboards to `develop`** (`6716ad7`, 3 commits): keystone-polished the widget **card** (14px radius + hover `card-lift` + brightening hairline, brand-wash kept; `data-testid="widget-card"`) + **canvas skeleton** (radius mirror); widget **contents** (NumberWidget unit label → `<Kicker>`; ListWidget colored cells → `<ColorChip>` soft chip; config-sheet "Live preview" → `<Kicker>` + 14px preview card); plus the just-in-time Wave 2 plan section.
- Recon reshaped the wave: **dashboards-nav = documented no-op** (spec §4.2's `:139` is a decorative avatar glyph, not a Kicker; section title is shell-owned `<NavSection>`). All `chart-*`/gauge/meter/dot data-colors preserved.
- Built via 2 parallel file-disjoint implementer subagents + a combined spec/quality reviewer (APPROVE, no scope creep). Gates green; `finish-task.sh` rebased/merged/pushed/removed worktree.

## Why

Approach-B: ship each Keystone cluster incrementally. User chose to promote Waves 0–1 to prod first (get the board-view polish + primitives live), then continue to Wave 2. Dashboards is the next cluster in the roughness×traffic sequence.

## How to test (for the user)

1. Pull `develop` and `pnpm dev` (DEV env). Open a workspace → **Dashboards** with several widgets.
2. **Widget cards:** 14px rounded corners + faint top-right brand-wash. In **Edit** mode, hover a widget → slight lift + brighter border/header hairline (hover-only; yields to active drag).
3. **Number widget:** the unit label under the big number is now a mono uppercase **Kicker**.
4. **List widget:** colored status/label cells render as **soft translucent chips** (`rounded-sm`), legible on any hue.
5. **Add/Edit widget sheet:** "LIVE PREVIEW" is a Kicker; preview card matches 14px radius.
6. **Loading:** hard-refresh → skeleton cards share the 14px radius (no pop on load).
7. Toggle **dark ↔ light** and re-check 2–5. Confirm charts/gauges/meters look unchanged.

## Open threads

- **Wave 2 not promoted** — on `develop` only; prod (`main` `e9ec8f2`) has Waves 0–1. Promote Wave 2 with 3+ or on its own later.
- **Keystone Waves 3–6 remain:** Admin & entry (Auth is roughest) → Planning → Personal/chrome → Core touch-ups. Each gets a just-in-time plan against then-current `develop`.
- Standing owed carried forward: forgot-password prod redirect allowlist; DRY board `OptionPill` onto `<ColorChip>`; Phase 10 AI scope-reconciliation; PF perf batches; Landing Keystone.

## Next session entry point

Start **Keystone Wave 3 — Admin & entry** (Settings · Auth · Onboarding): recon (Auth routes at `src/app/auth/*`, stock shadcn → brand-washed card + kicker eyebrow + panel elevation) → just-in-time plan → worktree → parallel subagents → gates → finish. Or `/promote` Wave 2 (+ any later clusters) to prod.
