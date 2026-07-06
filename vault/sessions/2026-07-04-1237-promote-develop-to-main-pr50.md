---
type: session
date: 2026-07-04-1237
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-07-04-1107-parallel-build-four-scoped-plans]]"
  - "[[2026-07-03-1924-import-wizard-v2]]"
---

# Promote develop → main (PR #50): import wizard v2 + four-plan wave to prod

## What changed

- Ran `/promote`. Shipped the full `develop` delta since promotion #48 to production via **PR #50**
  (squash): Import Wizard v2 + this session's four-feature batch (widget live-preview, PWA shell,
  shared-board rename fix, perf tier-3). 48 meaningful commits / 90-file tree delta.
- `main` advanced `f0f71f5 → 7d38b3f`; **Vercel production deploy succeeded**; main CI (`verify`)
  green.
- Ran the required **gotcha-32 squash-heal** (`git merge -s ours origin/main`) on develop →
  `46ea505`, pushed. Confirmed `main` is a clean ancestor of `develop` again, so the next promotion
  won't show CONFLICTING.
- Preflight note: pushed the earlier wrapup vault commit (`0e4ab0a`) to clear the "local develop
  ahead" hard stop (vault docs only, no prod impact).

## Why

The four scoped plans built + merged in the prior session (plus the already-merged Import Wizard v2)
were sitting on `develop` unshipped. Promotion is all-or-nothing, so this bundle went to prod
together. The `-s ours` heal is mandatory maintenance: without it every subsequent `develop → main`
PR 3-way-merges from a stale base and false-conflicts.

## How to test (for the user)

Production is live at the deployed Vercel URL. Smoke-test the shipped features in **prod**:

1. **Import Wizard v2** — create/import a board from an Excel/CSV file: the 3-step wizard (upload →
   map columns/sheets → confirm) should replace the old dialog; try the "import into existing board"
   mode with column auto-matching.
2. **Dashboard widget live-preview** — add/edit a widget, pick a source board → preview shows real
   data (not "Failed to load").
3. **PWA** — visit the site, check `/manifest.webmanifest` returns JSON; desktop "Install app" and
   iPad Add-to-Home-Screen show "Monolith" + the slab icon.
4. **Shared-board rename** — rename a shared board → recipients see the new name immediately.
5. **`/time`** — cell edits update row/day/week totals in the same frame.

## Open threads

- **Data sync not run.** `/sync-prod` (dev data → prod DB) was offered and declined-by-AFK — run it
  later if prod should mirror dev content. Code is deployed; prod data untouched.
- **Owed (unchanged):** re-apply import-wizard-v2 DEV migration (`20260703110000_…` → DEV SQL
  editor); prod Batch B migrations + migration-ledger repair on both projects.
- **Product call still open:** Phase 10 vs revive 6e Docs vs declare v1 feature-complete.
- Deferred: perf Task A (`unstable_instant`) needs its own spec
  ([[2026-07-04-gotcha-48-unstable-instant-blocked-by-shell-searchparams]]).

## Next session entry point

Make the v1-feature-complete call (or define Phase 10). If prod data should match dev, run
`/sync-prod`. Otherwise clear the owed migrations.
