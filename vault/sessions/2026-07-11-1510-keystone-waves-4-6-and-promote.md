---
type: session
date: 2026-07-11-1510
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-07-10-2058-keystone-wave3-admin-entry]]"
  - "[[2026-07-10-2009-keystone-promote-and-wave2-dashboards]]"
---

# Keystone Waves 4–6 + promote Waves 2–6 to prod

## What changed

- **Wave 4 · Planning** (`develop` `328a2b1`): Portfolios `PriorityPill` → soft `StatusPill`; portfolios index → 14px elevated surface; `PLANNING` kicker eyebrows on Goals/Portfolios/Workload; keystone-eased progress + capacity bars (fill colors/widths preserved as data).
- **Wave 5 · Personal & chrome** (`develop` `6fe7d0e`): My Work soft `ColorChip` status + mono Kicker buckets (kept as `<h2>` for a11y) + 14px list; Time Kicker headers + mono numerics; Notifications Invitations kicker + translucent rows (unread dot already accent); Command palette mono Kicker groups + accent active-row wash (via shared `ui/command.tsx`).
- **Wave 6 · Core touch-ups** (`develop` `20559a6`): sidebar `MonolithMark` in expanded wordmark lockup + `ease-keystone` on collapse; item-panel OWNER/CREATED `MetaChip`s + accent Updates tab count; `@mention` accent-highlighting in updates (display-only tokenizer — longest-match + word-boundary, text preserved).
- **Promoted Waves 2–6 to production** via `/promote` — PR#57 squash-merged, `main` `e9ec8f2 → 77052bc`; main CI + Vercel prod deploy both green; gotcha-32 `-s ours` heal applied (`develop` `c0f3a39`).
- Each wave: recon → just-in-time plan → worktree → 3–4 parallel file-disjoint implementers → spec/quality reviewer (all APPROVE) → 4 gates green → finish-task. One reviewer-driven a11y fix (My Work bucket `<h2>`) and one typecheck fix (`renderBody` null-name filter) caught at integration.

## Why

Completes the Keystone secondary-surface polish (Approach B, cluster-by-cluster). Waves 0–6 now all in prod — the bespoke Keystone layer (`<Kicker>`, soft chips, elevation/hairlines, `card-lift`, accent-on-states) is applied across the whole app at the same depth the core surfaces got. Landing (`/landing`) remains the only out-of-scope surface (separate track).

## How to test (for the user)

Production is live (`main` `77052bc`). In the deployed app (or `develop`):

1. **Planning:** `/goals`, `/portfolios`, `/workload` show a mono `PLANNING` eyebrow; portfolio Priority is a soft colored pill; progress/capacity bars animate with keystone easing.
2. **Personal & chrome:** `/my-work` soft status chips + mono kicker buckets; `/time` mono numerics + kicker headers; header bell shows Invitations kicker; ⌘K shows mono kicker group labels + accent-washed active row (arrow-key nav intact).
3. **Core:** sidebar shows the cleaved-slab mark next to the MONOLITH wordmark (collapse animates with keystone easing); open an item → OWNER/CREATED meta chips + accent count on the Updates tab; an @mention in an update renders periwinkle.
4. Toggle dark ↔ light throughout.

## Open threads

- **Keystone pass DONE** (Waves 0–6 all in prod). Only remaining Keystone item: **Landing** (`/landing`) redesign + retire `brand-lab` — separate track, not part of this pass.
- **Wordmark mark** shipped to prod — if the cleaved-slab-beside-slab-I lockup reads as busy, it's a one-line revert in `brand.tsx` (drop the prepended `<MonolithMark>`), keeping the easing.
- Standing owed carried forward: forgot-password prod redirect allowlist (`/auth/callback`); DRY board `OptionPill` onto `<ColorChip>`; Phase 10 AI scope-reconciliation; PF perf batches.

## Next session entry point

Keystone is fully shipped. Next major tracks: **Phase 10 — AI & Agents E1** (scope-reconciliation first) or **PF — Polish & Fluidity** perf batches (`docs/superpowers/plans/2026-07-09-perf-polish-fluidity.md`). Or the **Landing** Keystone redesign.
