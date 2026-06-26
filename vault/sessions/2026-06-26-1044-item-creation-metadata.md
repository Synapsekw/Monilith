---
type: session
date: 2026-06-26-1044
branch: develop
trigger: wrapup
status: complete
tags: [session]
related: []
---

# Item creation metadata — immutable Created by / Created at

## What changed

- New migration `20260625120000_item_created_by.sql`: adds `items.created_by` (backfilled to each org's creator), a BEFORE-INSERT trigger stamping creator + `created_at` from `auth.uid()` (anti-spoof), a BEFORE-UPDATE trigger making both immutable, and a `default auth.uid()` so `Insert` types stay optional. Applied to the DEV DB via SQL editor (not the ledger — see Open threads); types regenerated.
- New pure renderers `src/components/boards/cells/created.tsx` (`CreatedByCell`, `CreatedAtCell`, `formatDateTime`) reused by table + panel.
- `BoardTable.tsx`: two read-only virtual trailing columns (after the last user column, before `+`, scroll normally) wired into all five row paths for items and subitems; `ItemPanel.tsx` + `BoardViews.tsx`: read-only Created section in the Fields tab.
- Merged to develop as `c11d4e8` (8 commits); gates green (typecheck/lint/1734 tests/build).
- Post-merge polish (`b016d8b`): made the two created columns smaller (`text-xs`) and more transparent (`opacity-60`) in cells + headers, so they read as read-only audit metadata distinct from editable columns.
- Updates page (`b016d8b`/`6e147a3` + regens): added `Changelog:` trailers → `/updates` now lists "See who created each item", plus backfilled "Import and export boards as spreadsheets" (new) and "Snappier board interactions" (improved). Regenerated `src/lib/changelog/generated.ts` (4 entries).

## Why

Audit requirement: every item/subitem needs a permanent, unfalsifiable record of who created it and when. Modeled as virtual columns off the item row (like the Name column) with DB-enforced immutability, so the guarantee holds regardless of client or code path.

## How to test (for the user)

1. Pull `develop`, `pnpm install` (sibling work added `exceljs`), `pnpm dev`. Migration is already applied to the DEV DB.
2. Open a board, create an item; scroll right to the end → **Created by** (avatar+name) and **Created at** (date+time) appear before the `+` slot.
3. Add a subitem → same two columns, attributed to you.
4. Confirm read-only: cells don't edit on click; headers have no menu.
5. Open the item panel → Fields tab → **Created** section shows both values.
6. Pre-existing items show the org creator (backfill) + their original timestamp.

## Open threads

- **Ledger drift**: migration applied via SQL editor, not recorded in `supabase_migrations`. A future `db push` will try to re-apply `20260625120000` and fail. Run `supabase migration repair --status applied 20260625120000` when reconciling the broader pre-existing drift.
- The org-creator-fallback trigger idea was reverted; service-role item inserts must run as an authenticated actor (develop fixed the one failing test that way).

## Next session entry point

Item creation metadata is shipped on develop. No follow-up owed for this feature. Pick the next item from the roadmap / `/whats-next`.
