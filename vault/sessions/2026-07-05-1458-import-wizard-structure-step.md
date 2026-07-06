---
type: session
date: 2026-07-05-1458
branch: develop
trigger: wrapup
status: complete
tags: [session, import, boards]
related: []
---

# Import Wizard — Structure step, larger UI, pinned footer

## What changed

- Shipped a 4-step import wizard (Upload → Map → **Structure** → Confirm). New `StructureStep.tsx`
  lets users set per-row Item/Subitem + group with multi-select bulk actions; flat-start, orphan
  subitems block Next. Merged to `develop` (origin `42e5739`, 14 commits, spec+plan under
  `docs/superpowers/`).
- Wider modal (1400px / 90vh) + a pinned footer so Next/Import never scrolls off.
- New shared `resolveStructuredRows` replaces marker/`splitRows2` derivation; `buildImportPayloadV3`
  (new-board) + rewritten multi-group `buildAppendPayload` (existing-board); `commitImport` now takes
  explicit `groups`/`structure`; `findStructureValidationError` extracted to a plain module
  (`spreadsheet/structure-validate.ts`) — a sync export from a `"use server"` file breaks `pnpm build`.
- Migration `20260705120000_import_rows_multi_group.sql` makes `import_rows_into_board` multi-group;
  applied to DEV manually by the user (ledger may drift → repair before next `db push`).
- Executed via subagent-driven development: 10 tasks, per-task review + fix loops caught a CRITICAL
  cross-board write hole in the RPC and an Important export→import round-trip bug; final opus review
  = ready-to-merge.

## Why

The import UI was cramped, its action button was buried below a tall grid, and item/subitem +
grouping were inferred from a `↳` marker / group column with no user control. Users needed explicit,
UI-driven structuring of imported rows into items, subitems, and multiple groups.

## How to test (for the user)

1. Pull `develop`; open a board you can edit → **Import** (or new board → Import).
2. Upload a `.csv`/`.xlsx` — note the larger modal and the pinned Next/Import footer.
3. Map columns (mark the name column) → **Next**.
4. Structure step: rows start as Items in one group. **+ Add group**, rename, move rows in (per-row
   dropdown or select rows → **Move to group**). Set a row to **Subitem** → it indents under the item
   above it.
5. Make a subitem with no item above it in its group → **Next is blocked** with the orphan message; fix it.
6. Existing board: the per-row Group dropdown lists the board's real groups + "New group…".
7. Confirm → **Import**; verify rows/subitems/groups landed correctly (existing board shows reused +
   new groups).

## Open threads

- North-star bump SKIPPED this wrapup: shared checkout has a concurrent `nav-declutter` session with
  uncommitted `vault/00-north-star.md` edits — didn't clobber. That session owns the north-star update.
- Non-blocking follow-ups: export still writes `↳` marker (round-trip asymmetry, intended); delete
  dead `buildImportPayloadV2`/`splitRows2`; optional RPC hardening (coalesce NULL-unsafe `NOT IN`
  guards; enforce subitem group == parent group).
- Migration applied manually → watch for supabase ledger drift on next `db push`/sync-prod.

## Next session entry point

Import feature is done and merged. If touching it next: consider dropping the `↳` export marker (or
having `seedStructure` pre-mark subitems) to restore export→import round-trip fidelity, and delete the
dead V2 payload builder.
