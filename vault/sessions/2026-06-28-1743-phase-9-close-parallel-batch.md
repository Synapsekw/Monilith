---
type: session
date: 2026-06-28-1743
branch: develop
trigger: wrapup
status: complete
tags: [session, phase9, perf]
related:
  - "[[2026-06-26-0812-phase-9-5a-snappy-interactions]]"
  - "[[2026-06-26-0822-board-spreadsheet-export-import]]"
---

# Phase 9 close — 9.3b cache + 9.6 Web-Vitals + spreadsheet follow-ups (parallel batch)

## What changed

- `/whats-next` triage on a clean slate (vault said "run /promote" but #37 had already shipped it). Recommended batch built in **three parallel worktrees**, each TDD + locally gated, then **serialized `finish-task` merges**:
  - **9.6 Web-Vitals gate** (`a264fee`): Lighthouse CI budget job (`.lighthouserc.json` + `ci.yml`, asserts LCP/CLS/TTFB/TBT/script-size/perf-score, scoped to `/`) + real-user reporting via `next/web-vitals` mounted in `providers.tsx`; new optional `NEXT_PUBLIC_WEB_VITALS_ENDPOINT`.
  - **9.3b widget aggregation caching** (`b546595`): `getWidgetAggregationCached` wrapped in `use cache` + `cacheLife("widget")` (~30s TTL) + per-widget org-scoped tag; `getWidgetData` delegates; widget-config mutations `updateTag` for read-your-own-writes. No UI/schema change.
  - **Spreadsheet review follow-ups** (`384ccf1`): cells-error rollback test; tightened date/status over-detection; people-column export now resolves assignee names.
- **Docker ruled out** (user decision): dropped triage item #2 (local-Docker test DB — no Docker on this machine) and scrubbed all Docker references from the vault, north-star, `sync-prod` dump scripts, and auto-memory, replacing them with "dedicated isolated test database via `.env.test`" (`2850a6f`).
- Recorded a finish-task gotcha as auto-memory: typecheck-runs-before-build trips on a rebased-in `cacheLife` profile (stale uncommitted `.next/types`) → `pnpm build` then re-run finish-task.
- End state: `develop == origin/develop` at `384ccf1`; every merge gated green incl. the live-DB integration suite.

## Why

The clean-slate triage put Phase 9 closure (the two remaining slices, 9.3b + 9.6) on the roadmap critical path; this session built that batch end-to-end. The spreadsheet items cleared review debt; the Docker cleanup reflects the decision not to use Docker for the durable test-DB fix.

## How to test (for the user)

1. Pull `develop`, `pnpm install`, `pnpm dev`.
2. **Spreadsheet people export:** open a board with a People column + assignees → header **Export → Excel** → the People column now shows assignee names (previously blank).
3. **Import detection:** **+ New board → Import** a CSV/xlsx where one column is month-name strings (`"May 2024"`) → detected as **Text**, not Date; a single-value column → **Text**, not Status.
4. **Web-Vitals RUM:** open any page, DevTools console → `[web-vitals]` debug lines (LCP/CLS/INP/TTFB) appear as metrics settle.
5. **Web-Vitals CI:** open a PR → the new **lighthouse (perf budget)** check runs against `/`.
6. 9.3b is not directly observable — server-side recompute is avoided within the ~30s TTL; widgets render unchanged.

## Open threads

- Lighthouse budget numbers confirm on the **first CI run**; if `/` exceeds a threshold, expect a one-line tune.
- **Migration-ledger repair still owed:** `supabase migration repair --status applied 20260625120000`.
- Optional carryover #4 (optimistic board mutations) — recommended **skip**: `updateTag` already gives instant sidebar updates.

## Next session entry point

Run `/promote` to ship the unpromoted `develop` bundle to production (item-creation tracking + 9.5a + spreadsheet io + flake fix + sidebar share-icons + 9.3b + 9.6 + the roast/iPad docs). Phase 9 is closed.
