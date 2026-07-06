# Import Wizard — Structure step, larger UI, pinned footer

**Date:** 2026-07-05
**Status:** Approved (brainstorming) — ready for implementation plan
**Supersedes/extends:** `2026-07-03-import-wizard-v2-design.md`

## Problem

Three usability gaps in the file-import wizard (`src/components/boards/import/`):

1. **The modal is too small.** `DialogContent` is `sm:max-w-6xl h-[85vh]` (~1152px). The
   mapping/structure grids are cramped and hard to operate.
2. **The primary action scrolls away.** Back/Next/Confirm are rendered _inside_ the single
   `flex-1 overflow-y-auto` body, so on a tall grid the "Next"/"Import" button is buried at the
   bottom and the user must scroll to reach it.
3. **Item/subitem and grouping are not user-controllable.** Today, item-vs-subitem is inferred from
   a `"↳ "` (`SUBTASK_MARKER`) prefix in the name cell, and groups come from a designated "group"
   _column_ (new-board only; existing-board dumps everything into one chosen group). There is no UI
   to say "this row is an item, that row is a subitem, these rows go in Group 1, those in Group 2."

## Goals

- Wider/taller import modal.
- A primary-action button (Next / Import) that is **always visible**, independent of grid height.
- A dedicated **Structure** step where the user explicitly assigns, per row, an **item/subitem**
  type and a **group**, with bulk actions for large imports. Works in **both** new-board and
  existing-board modes.

## Non-goals (v1)

- Row drag-and-drop / reordering. Subitem→parent attachment follows source row order.
- Auto-seeding groups from the file (the "group" column) or from the `"↳ "` marker. The user
  organizes from a flat start. (Possible future convenience: "group by column value".)
- Cross-sheet structure. Structure applies to the single active sheet being imported (unchanged).

## Decisions (locked in brainstorming)

| Question                                    | Decision                                                                           |
| ------------------------------------------- | ---------------------------------------------------------------------------------- |
| Interaction model for #3                    | **Dedicated "Structure" step** (Upload → Map columns → Structure → Confirm)        |
| Scope                                       | **Both** new-board and existing-board modes                                        |
| Initial grouping                            | **Start flat** — all rows are Items in one default group; user organizes           |
| Row mechanic                                | **Per-row selectors (Type, Group) + multi-select bulk actions.** No drag-and-drop. |
| Subitem parent rule                         | Attaches to the **nearest Item above it in the same group** (source order)         |
| Orphan subitem (no Item above in its group) | **Blocks** the step (inline flag + disabled Next). No silent auto-promote.         |
| Existing-board multi-group                  | **Included.** Requires a Postgres RPC migration the user applies by hand.          |

## UI / UX

### Modal sizing (#1)

`ImportWizard.tsx` `DialogContent`:
`className="flex h-[85vh] flex-col sm:max-w-6xl"` →
approximately `"flex h-[90vh] w-[95vw] flex-col sm:max-w-[1400px]"`.
Exact values confirmed against the `pulse-ui` design system at build time; the intent is
"noticeably wider and taller, still responsive, never wider than the viewport."

### Pinned footer (#2)

`DialogContent` becomes a three-region flex column:

```
┌ DialogHeader  (title + StepIndicator)     shrink-0
├ Body          (flex-1, overflow-y-auto)   scrolls
└ Footer        (border-t, shrink-0)        pinned — [Back]            [Next →]
```

The Back / Next / Confirm buttons move **out** of the individual step components (`MapStep`,
`ConfirmStep`) and into a single footer that `ImportWizard` renders based on `step`:

- Step 1 (Upload): no footer nav (upload auto-advances), or a disabled Next.
- Step 2 (Map): `[Back] [Next]`, `Next` disabled per existing gates (`!hasNameColumn`, empty sheet,
  over row cap).
- Step 3 (Structure): `[Back] [Next]`, `Next` disabled when there is an orphan subitem.
- Step 4 (Confirm): `[Back] [Import]` (label toggles to `Importing…`), disabled while pending.

Step components stop rendering their own nav buttons and instead surface their validation state up
to `ImportWizard` (they already receive/derive `nextDisabled`).

### Structure step (#3)

New component `StructureStep.tsx`. Renders one row per **included** row (rows excluded in the Map
step are omitted here), in source order.

```
┌ Structure ─────────────────────────────────────────────────────────┐
│ [+ Add group]        Selected (2): [Set type ▾]  [Move to group ▾]  │
├─────────────────────────────────────────────────────────────────────┤
│ ☐  Type       Group          Name              (read-only preview…) │
│ ☑ [Item ▾]  [Imported ▾]   Design homepage     …                    │
│ ☑ [Sub  ▾]  [Imported ▾]     ↳ Hero art        …                    │
│ ☐ [Item ▾]  [Group 2 ▾]    Ship API            …                    │
└─────────────────────────────────────────────────────────────────────┘
```

- **Type** select per row: `Item` | `Subitem`. Subitems render indented with a `↳` marker.
- **Group** select per row: current groups + a `New group…` entry. In existing-board mode the list
  also includes the board's real groups (targeting an existing group vs. creating a new one).
- **`[+ Add group]`** appends a new group `Group N` with an inline-editable name.
- **Selection + bulk**: a per-row checkbox and a header "select all"; when ≥1 row is selected, a
  bulk bar offers "Set type → Item/Subitem" and "Move to group → …".
- **Name** column is read from the name-role column chosen in the Map step (read-only here). A few
  data columns MAY be shown read-only for context (implementation detail; keep it light).
- **Validation:** an orphan subitem (a `Subitem` row with no `Item` above it in the same group) is
  flagged inline and disables `Next` with a footer message. Empty newly-created groups are dropped
  silently at commit (not a blocker).

The Map step's "Use as group" column-role option is removed (grouping is now explicit here). The
`ColumnRole` `"group"` value and marker-based `splitRows2` path are retired from the wizard flow.

### Confirm step simplification

The existing-board group picker (`ExistingGroupFields`) is removed from `ConfirmStep` — grouping is
decided in the Structure step. Confirm shows: summary counts (items / subitems / groups / columns /
invalid), the board-name field (new-board mode only), and the Import button.

## Data model

### Client state (`import-wizard-state.ts`)

`SheetState` gains two fields:

```ts
type GroupSpec = {
  key: string; // stable client id, shared client↔server via the commit payload
  name: string; // editable; new groups default to "Group N"
  existingGroupId: string | null; // set when targeting a real board group (existing mode); else null
};

type RowStructure = {
  groupKey: string; // references a GroupSpec.key
  type: "item" | "subitem";
};

type SheetState = {
  headerRow: number | null;
  excluded: number[];
  columns: ColumnState[];
  groups: GroupSpec[]; // NEW — ordered; determines group order on the board
  structure: Record<number, RowStructure>; // NEW — keyed by GRID ROW INDEX (same key as `excluded`)
};
```

Rows absent from `structure` fall back to `{ groupKey: <default group>, type: "item" }`. Keying by
grid row index (the same index space `excluded` uses) means the client and the server — which
re-parses the file with the same `headerRow`/`excludedRows` — resolve identical rows.

**Seeding (start flat):**

- new-board mode: one `GroupSpec { name: "Imported", existingGroupId: null }`; all rows → that
  group, `type: "item"`.
- existing-board mode: default group references the board's first existing group
  (`{ name, existingGroupId: firstGroup.id }`), or a new `"Imported"` group when the board has none
  (mirrors today's `defaultGroupChoice`). All rows → that group, `type: "item"`. The per-row Group
  dropdown exposes the board's other groups + `New group…`.

**Pure helpers (unit-tested, no React):**

- seed structure from a derived `SheetState`
- add group / rename group / drop empty groups
- bulk set type / bulk move-to-group over a set of grid indices
- resolve subitem parents: for each `subitem` row, the nearest preceding `item` row in the same
  group (source order) → parent grid index
- detect orphans: subitem rows with no such parent

### Commit payload

`commitImport` currently receives `columns` (`buildCommitColumns`) + `destination`. It gains the
explicit structure:

```ts
{
  // …existing fields (fileBase64, fileName, sheetName, headerRow, excludedRows, columns, destination)
  groups: {
    key: string;
    name: string;
    existingGroupId: string | null;
  }
  [];
  structure: {
    gridIndex: number;
    groupKey: string;
    type: "item" | "subitem";
  }
  [];
}
```

Validated by new Zod schemas in `src/lib/validations/board-spreadsheet.ts`. The server re-parses,
re-runs `selectRows(headerRow, excludedRows)`, then applies `structure` by grid index — it does not
trust the client's row _contents_, only the structural assignment.

### Payload builders

- **New-board** (`build-import-payload.ts`): a new explicit-structure builder (e.g.
  `buildImportPayloadV3`) consumes `groups` + per-row `{groupKey,type}` instead of `splitRows2`, and
  computes subitem parents via the nearest-item-above rule. It feeds the existing
  `create_board_from_template` RPC (already multi-group) + the phase-2 subitems insert. **No DB
  change.**
- **Existing-board** (`build-append-payload.ts`): `AppendPayload` changes from a single group
  (`newGroup?` / `groupId?`) to a **groups array**:

  ```ts
  type AppendPayload = {
    groups: {
      id: string;                 // uuid to create with, OR the existing group's id
      existingGroupId: string | null; // null → create; set → reuse existing group
      name: string;
      color: string;
      position: number;
    }[];
    newColumns: …;                // unchanged
    optionAdditions: …;           // unchanged
    items:    { id; groupId; name; position; cells }[];   // groupId NEW per item
    subitems: { id; parentId; name; position; cells }[];  // parent's group inferred from parentId
  };
  ```

## Database migration (existing-board multi-group)

The `import_rows_into_board` Postgres RPC currently accepts a single target group. It must be
extended to accept an **array of groups** — creating the ones flagged `existingGroupId: null` and
reusing referenced existing groups — and to place each item into its `groupId`.

- Author a new versioned migration in `supabase/migrations/`.
- **The agent cannot apply migrations** (classifier blocks `db push`/DDL — see
  `migration-apply-blocked-by-classifier`). The **user applies the SQL manually**, then the agent
  runs `pnpm db:types` and commits regenerated `src/types/database.types.ts` in the same PR.
- New-board mode needs **no** migration (`create_board_from_template` already handles multiple
  groups + subitems).

## Testing

- **Unit** (`import-wizard-state`, payload builders): seeding; add/rename/drop-empty group; bulk set
  type / move to group; subitem-parent resolution (nearest item above in group); orphan detection;
  `buildImportPayloadV3` (multi-group + subitems, correct parent/group ids); `buildAppendPayload`
  multi-group (existing + new groups mixed, per-item groupId, subitem parentage).
- **Component** (`StructureStep`): per-row Type/Group selectors mutate state; `[+ Add group]`;
  bulk set-type / move-to-group over a selection; orphan subitem flags the row and disables Next;
  pinned footer renders the correct action per step.
- **Integration** (`import-rows-into-board.integration.test.ts`): existing-board append distributing
  rows across ≥2 groups (one existing, one new) with subitems, against the migrated RPC.
- **Regression**: update existing wizard tests for the 4-step flow, removed "group" column role,
  simplified Confirm step, and pinned footer.
- Gates: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

## Performance / data-fetching budget

The wizard is entirely client-side over already-loaded preview data. Step transitions
(Map ↔ Structure ↔ Confirm) and every per-row/bulk edit are **client state only — zero new server
round-trips**. The only server calls remain `previewImport` (on upload) and `commitImport` (on
Import). The Structure grid caps live rows the same way the Map grid does (render a bounded slice;
the hard import cap is enforced server-side at commit). No RSC navigation is used for in-page
interactions (per gotcha-09).

## Affected files (indicative)

- `src/components/boards/import/ImportWizard.tsx` — 4 steps, pinned footer, sizing
- `src/components/boards/import/StructureStep.tsx` — **new**
- `src/components/boards/import/MapStep.tsx` — drop own nav buttons + "group" role affordance
- `src/components/boards/import/MappingGrid.tsx` — remove "Use as group" role option
- `src/components/boards/import/ConfirmStep.tsx` — remove group picker, drop own nav buttons
- `src/components/boards/import/import-wizard-state.ts` — structure state + helpers + commit shape
- `src/lib/boards/spreadsheet/build-import-payload.ts` — explicit-structure builder (V3)
- `src/lib/boards/spreadsheet/build-append-payload.ts` — multi-group AppendPayload
- `src/lib/boards/spreadsheet-actions.ts` — `commitImport`/`previewImport` payload wiring
- `src/lib/validations/board-spreadsheet.ts` — Zod for the new commit shape
- `supabase/migrations/<new>.sql` — `import_rows_into_board` multi-group (**user-applied**)
- `src/types/database.types.ts` — regenerated after migration
- Tests across the above.

## Open risks

- The exact contract of `import_rows_into_board` (params, return shape) must be read before writing
  the migration so the change is additive/back-compatible where possible.
- Sizing tokens must be validated against `pulse-ui` (avoid magic px if a token exists).
