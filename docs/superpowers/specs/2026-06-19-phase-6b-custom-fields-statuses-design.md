---
type: spec
status: approved
date: 2026-06-19
phase: 6
slice: 6b
tags: [spec, phase/6, boards, columns, custom-fields, statuses]
related:
  - "[[00-north-star]]"
  - "[[2026-06-19-phase-6a-subitems-design]]"
  - "[[2026-06-17-phase-2c-column-management-design]]"
---

# Phase 6 / Slice B — Custom Fields & Statuses

> Phase 6 ("ClickUp depth") is five independent sub-projects: A subitems, **B custom
> fields/statuses**, C time tracking, D relations + mirror, E docs. Each gets its own spec → plan →
> build. This spec covers **only Slice B**. Time-tracking, relations/mirror, and docs stay out of
> scope here.

## 1. Goal & scope

Two gaps, built as **three independent unit-groups** under one spec:

1. **G1 — Option editing.** Today a Status/Dropdown column's option set (`{id, label, color}`) is
   stored in `columns.settings.options[]` and is fully customizable _in the data_, but there is **no
   UI and no server action to change it after the column is created** (you get the seeded
   "Working on it / Stuck / Done" and are stuck with it). G1 adds option add / rename / recolor /
   reorder / remove, with a color picker and safe handling of cells that referenced a removed option.
2. **G2 — New scalar kinds.** Add **Checkbox, Rating, Link, Email, Phone** column kinds — "simple
   scalar" fields, each a value-shape + editor + renderer + validation, no new subsystem.
3. **G3 — Files column.** Add a **Files** column kind whose cell shows file icons/thumbnails (click →
   preview), extending the Phase 4c attachments model with a `column_id`.

### Decisions (locked during brainstorming)

| Decision                  | Choice                                                                                           | Rationale                                                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Packaging                 | **One 6b spec, 3 unit-groups, one Execution DAG**                                                | Mirrors how 6a was specced; the three groups are largely independent → parallel batches. One brainstorm→spec→plan→build cycle.                         |
| Kind extensibility        | **Extend the existing discriminated-union / per-kind switch** (+ a small `COLUMN_KIND_META` map) | TS exhaustiveness turns "add a kind" into a compiler-guided checklist; no risky refactor of the 6 working kinds. The meta map only feeds the Add menu. |
| Option-delete integrity   | **Destructive: delete the option AND clear referencing cells, behind a count-confirm**           | Keeps `settings` + `cell_values` consistent, no silent data loss, no archived-option accumulation. Done atomically in an RPC.                          |
| Option colors             | **Fixed swatch palette** (`OPTION_COLORS`), no custom hex                                        | Mirrors the Phase-6 group-color decision (custom hex deferred). Keeps the picker trivial.                                                              |
| Rating scale              | **Fixed 5 stars** (no per-column setting)                                                        | Simplest; Rating needs no settings at all. Configurable max is YAGNI for now.                                                                          |
| Files cell storage        | **Extend `attachments` with `column_id`** (reuse bucket / RLS / signed URLs / lightbox)          | Attachments are item-scoped today (no `column_id`); a Files _column_ is per-(item, column). Reuse everything else — no new bucket, no duplicate UI.    |
| Files data on first paint | **One extra bounded board-scoped attachments query** folded into the board payload               | Files cells render with 0 per-cell round-trips; bounded per board, indexed (working-agreement §5).                                                     |

### Out of scope (deferred — YAGNI)

- Custom hex option colors (fixed palette only).
- Per-kind **Kanban grouping / Calendar / Timeline** participation for the new kinds — they render
  read-only in non-Table views; no grouping/date mapping. (Status/Date/People keep their existing
  view roles.)
- Configurable Rating max, half-stars, emoji scales.
- Tags, Vote, Progress, Formula, Country/Location/World-clock kinds.
- Soft-archiving deleted options (we delete-and-clear instead).
- Files: per-cell access control beyond org scope, versioning, inline document editing.

## 2. G1 — Status / Dropdown option editing

No schema change. Options already live in `columns.settings.options[]`
(`src/lib/validations/boards.ts` — `optionSchema = {id, label, color}`,
`statusSettingsSchema`, `dropdownSettingsSchema = statusSettingsSchema`).

### 2.1 Server action + RPC

- **`updateColumnSettings(columnId, settings)`** — new action in `src/lib/boards/actions.ts`,
  mirroring `renameColumn`'s shape: resolve the column (RLS) → derive `org_id`/`board_id`; validate
  `settings` against the **kind-discriminated** `updateColumnSettingsSchema`
  (`src/lib/validations/board-actions.ts`); write `columns.settings`. The `columns` table is already
  in the realtime publication, so peers reconcile. Used for add / rename / recolor / reorder (any
  non-destructive options edit, plus future per-kind settings).
- **`removeColumnOption(columnId, optionId)`** — new action calling a new **`SECURITY DEFINER` RPC
  `delete_column_option(p_column_id, p_option_id)`** that, in one transaction: removes the option
  from `columns.settings.options`, and **clears every `cell_values` row** on that column whose value
  references the option (Status: `value->>'optionId' = optionId`; Dropdown: remove the id from
  `value->'optionIds'`, deleting the row if it becomes empty). Atomic so settings and cells never
  drift. RLS-equivalent guard inside the RPC (caller must be an org member of the column's org).
  Returns the affected-cell count for the toast.
  - A **read helper `countColumnOptionUsage(columnId, optionId)`** (or the RPC's dry-run path) backs
    the confirm dialog's "N items use this label" copy.

### 2.2 UI — `ColumnOptionsDialog`

Opened from the existing `ColumnHeader` overflow menu — a new **"Edit labels"** entry shown only for
`status` / `dropdown` columns (next to Rename / Delete / Resize).

- Lists the current options; each row: a **color swatch button** (opens an `OPTION_COLORS` swatch
  popover), an inline-editable **label**, a **`GripVertical`** drag handle, and a **remove** (×).
- **Add option** button appends `{ id: crypto.randomUUID(), label: "New label", color: <next palette
color> }` and focuses its label input.
- **Reorder** via `@dnd-kit` `SortableContext` + `verticalListSortingStrategy`, using
  **`CSS.Translate.toString` only** (per [[2026-06-19-gotcha-20-dnd-kit-transform-scale-stretch]]).
- **Remove** with usage > 0 → `AlertDialog` confirm ("3 items use 'Stuck'. Deleting clears them.")
  → `removeColumnOption`. Remove with usage 0 → immediate.
- Non-destructive edits (add / rename / recolor / reorder) batch into a single
  `updateColumnSettings` call on dialog save (optimistic), keeping per-keystroke writes off the wire.

### 2.3 Color picker

New shared module `src/lib/boards/option-colors.ts` exporting `OPTION_COLORS` (a fixed Monday-style
swatch set, same shape as `GROUP_COLORS`). The swatch popover renders the grid; selection sets the
option's `color`. Reuses the existing `pillTextColor()` contrast helper for previewing the pill.

### 2.4 Cache & realtime

`columns` UPDATE already flows through the board realtime path and the column cache; option edits are
a `columns.settings` change, so **no new cache plumbing** beyond an optimistic settings patch in the
relevant mutation. `removeColumnOption` also changes `cell_values` → its mutation optimistically drops
the affected cell values locally; the realtime `cell_values` DELETE echoes are idempotent.

## 3. G2 — New scalar kinds (Checkbox, Rating, Link, Email, Phone)

### 3.1 Enum + scaffold (the G2 foundation task)

- **Migration** extends the DB enum: `alter type public.column_kind add value 'checkbox';` … for each
  of the five (Postgres requires each `add value` in its own statement; enum additions can't run in a
  txn block with their use — keep the migration enum-only or split, per Postgres rules; the plan
  validates ordering). Then `pnpm db:types` regen + commit.
- **`COLUMN_KIND_META`** — new map (`src/lib/boards/column-kinds.ts`): `kind → { label, icon,
hasOptions }`. Feeds `AddColumnMenu` (which currently hardcodes the 6 kinds) so new kinds appear in
  the picker with an icon/label. This is the only "registry-ish" piece; rendering/editing stay
  switch-based for exhaustiveness.
- **Validation** (`src/lib/validations/boards.ts`): add a value-schema member per kind to the cell
  discriminated union, and a settings member (all five use **empty settings** `{}`):
  - `checkbox` → `{ checked: boolean }`
  - `rating` → `{ rating: number }` (1–5 int; 0/absent = unset)
  - `link` → `{ url: string (http/https), text?: string }`
  - `email` → `{ email: string (email format) }`
  - `phone` → `{ phone: string (1..40, loose) }`
- **`defaultColumn`** (`src/lib/boards/column-defaults.ts`): a case per kind returning `{}` settings.

### 3.2 Renderers + editors (fan-out, one per kind)

In `src/components/boards/cells/index.tsx` (read renderer) and the editable-cell path (inline editor):

| Kind     | Renderer                                                            | Editor                                        |
| -------- | ------------------------------------------------------------------- | --------------------------------------------- |
| Checkbox | check icon / empty box                                              | inline toggle (click → `setCell`/`clearCell`) |
| Rating   | 1–5 star row (filled to `rating`)                                   | clickable stars; click same value → clear     |
| Link     | anchor, shows `text ?? url`, `_blank` + `rel="noopener noreferrer"` | popover with `url` + optional `text` inputs   |
| Email    | `mailto:` anchor                                                    | text input (email-validated on blur)          |
| Phone    | `tel:` anchor                                                       | text input                                    |

Each routes writes through the existing `setCell` / `clearCellValue` actions (no new per-kind
actions). Editors validate at the boundary and surface a friendly inline error on bad input.

### 3.3 Rollups (6a `rollupCell`)

`src/lib/boards/rollup.ts` switches on kind; exhaustiveness forces a case for each new kind:

- `checkbox` → "✓ 3/5" (count checked / total non-empty).
- `rating` → average (one-decimal) shown as a partial star or "4.2".
- `link` / `email` / `phone` → blank (like `text`).

### 3.4 Other views

Kanban / Calendar / Timeline: the new kinds appear as **read-only** cells where those views show cell
content; they do **not** become group-by / date / people sources. Any exhaustive kind switch in those
view modules gets a no-op/read-only case (compiler-driven).

## 4. G3 — Files column

### 4.1 Data model

Extend Phase 4c attachments (`supabase/migrations/20260617110000_attachments.sql`):

```sql
alter table public.attachments
  add column column_id uuid references public.columns (id) on delete cascade;

create index attachments_item_column_idx
  on public.attachments (item_id, column_id)
  where column_id is not null;
```

- **Item-panel attachments** (4c) keep `column_id IS NULL` — unchanged behavior.
- **Files-cell attachments** have **both** `item_id` and `column_id` set.
- **Storage path** gains a column segment:
  `<org_id>/<board_id>/<item_id>/<column_id>/<uuid>-<name>`. Org is still path-segment 1, so the
  existing path-based **Storage RLS is unchanged**. Table RLS unchanged (still `is_org_member` +
  parent-consistency on insert); `column_id` validated server-side to belong to the item's board.
- Migration `column_kind` already extended in G2 — G3 adds `'files'` there too (its enum value lives
  with the G2 enum migration to keep all enum additions in one place; the plan sequences this).

### 4.2 Server actions

Extend the existing collaboration actions (`src/lib/collaboration/actions.ts`) to accept an optional
`columnId`:

- `createAttachment({ itemId, columnId?, storagePath, fileName, mimeType, sizeBytes })` — when
  `columnId` is set, validate it belongs to the item's board and is a `files` column; the path-prefix
  guard extends to include the column segment.
- `deleteAttachment`, `getAttachmentDownloadUrl`, `getAttachmentPreviewUrls` — unchanged signatures;
  work for column-scoped rows as-is.
- A **board-scoped list** for first paint (see §4.4).

Upload stays **client-direct to Storage** (authorized by the Storage INSERT policy) then a metadata
action — same flow as 4c.

### 4.3 Files cell UI

`src/components/boards/cells/` Files cell:

- Renders up to ~3 file **icons/thumbnails** (reuse `fileKind()` + thumbnail-via-signed-URL from
  `attachments-format.ts`) with an overflow **`+N`** and a small count.
- Hover reveals a **"＋" upload** affordance (file input / dropzone) → client-upload →
  `createAttachment({ columnId })` → optimistic cache patch.
- Click a thumbnail → the **existing `FilePreviewLightbox`**, scoped to that cell's files.
- Empty cell → a faint "＋" only.

### 4.4 Data loading & cache (perf budget)

- The board payload (`getBoardPayload`) gains **one bounded query**: `attachments where board_id = X
and column_id is not null`, returned alongside cells. Files cells render on **first paint with 0
  per-cell round-trips**. Bounded per board, indexed by `attachments_item_column_idx`.
- The Files column carries **no `cell_values` row** — its content is derived from this attachments
  slice keyed by `(item_id, column_id)`. (Rollup for `files` = file count; rollup switch gets a
  `files` case.)
- Upload / delete = Server Action + optimistic patch of the board's attachments slice +
  `revalidatePath`. Realtime: attachments are not currently in the board realtime path; v1 relies on
  optimistic local patch + revalidate (a follow-up can add `attachments` to the publication if
  cross-client live sync on Files cells is wanted — noted, not in scope).

## 5. Testing (mandatory — written and run)

**Pure unit**

- Each new kind's value + settings Zod round-trip (valid + invalid: bad URL, bad email, rating out of
  1–5).
- `rollupCell` cases: checkbox count, rating average, files count, link/email/phone blank.
- Option-edit reducers (add / rename / recolor / reorder produce correct `options[]`).

**DB integration** (`*.integration.test.ts`, skips without `SUPABASE_SERVICE_ROLE_KEY`)

- `updateColumnSettings` is org-scoped (no cross-org write); rejects malformed settings.
- `delete_column_option` RPC: removes the option **and** clears Status cells / strips Dropdown ids /
  deletes emptied Dropdown cells, atomically; returns the right count; org-scoped guard holds.
- `attachments.column_id`: column-scoped rows are still org-RLS-protected (no cross-org read); insert
  validates the column belongs to the item's board.
- Regression: the existing attachments + columns RLS suites stay green after the `column_id` add.

**Component**

- `ColumnOptionsDialog`: add / rename / recolor / drag-reorder / remove; delete-with-confirm shows
  the usage count and calls `removeColumnOption`.
- Each new editor/renderer (checkbox toggle, star set/clear, link popover + anchor, email/phone
  mailto/tel, validation errors).
- Files cell: icon row + overflow, upload affordance, click → lightbox.

**e2e**

- Edit a Status label + color live → board cells reflect it.
- Add a Rating column → set stars → reload persists.
- Add a Files column → upload a file → see the icon → open preview → delete.

Gate (working agreement): `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all green;
`get_advisors` clean after both migrations (enum extension + `attachments.column_id`); `pnpm db:types`
regenerated + committed.

## 6. Performance & data-fetching budget (working-agreement §5)

- **(a) First paint vs interaction:** Option editing, all five scalar kinds, and their rendering are
  **0 new server round-trips** — options ride in the already-loaded `columns.settings`; scalar cell
  values ride in the existing batched `cell_values`. The **only** addition is G3's single bounded
  board-scoped attachments query on first paint.
- **(b) Server-data changes:** option edits, cell sets, file upload/delete are **Server Actions +
  optimistic cache patch (+ realtime / revalidate)** — never RSC navigation.
- **(c) Bounded over indexed columns:** option/settings reads are per-column (tiny); the Files query
  is board-scoped and indexed by `attachments_item_column_idx`; cells stay on the
  `(item_id, column_id)` PK.

## 7. Execution DAG (working-agreement §6)

**Independent units**

- **U1 — DB migrations + types:** `column_kind` += {checkbox, rating, link, email, phone, files};
  `attachments.column_id` + index; `delete_column_option` RPC; `pnpm db:types` regen. _(foundation)_
- **U2 — Validation + meta scaffold:** Zod value/settings members for all 6 new kinds;
  `updateColumnSettingsSchema`; `COLUMN_KIND_META`; `defaultColumn` cases; `OPTION_COLORS`. _(needs
  U1's enum for the type union)_
- **U3 — G1 actions:** `updateColumnSettings`, `removeColumnOption` (+ usage count). _(needs U1, U2)_
- **U4 — G1 UI:** `ColumnOptionsDialog` + color-swatch popover + `ColumnHeader` "Edit labels" entry +
  mutations. _(needs U3)_
- **U5 — G2 renderers/editors:** five cell renderer+editor pairs in `cells/` + rollup cases. _(needs
  U2)_
- **U6 — G3 actions + payload:** extend `createAttachment` for `columnId`; board-scoped attachments
  query into `getBoardPayload`. _(needs U1, U2)_
- **U7 — G3 Files cell UI:** Files renderer/editor (upload + lightbox) + rollup `files` case. _(needs
  U6)_
- **U8 — Add-menu + view wiring:** `AddColumnMenu` reads `COLUMN_KIND_META`; non-Table view
  read-only cases. _(needs U2, U5, U7)_

**Rough batches:** **[U1]** → **[U2]** → **[U3, U5, U6]** → **[U4, U7]** → **[U8]**. The plan
produces the full graph, parallel batches, and critical path (≈ U1→U2→U6→U7→U8).

**Hot-file serialization:** `cells/index.tsx`, `validations/boards.ts`, `column-defaults.ts`,
`BoardTable.tsx`, and `getBoardPayload` are touched by multiple units (esp. U5/U6/U7) → the plan
sequences those edits or uses **git worktrees** so parallel agents don't clobber the shared `develop`
checkout (working-agreement #1).

## 8. Risks & notes

- **Postgres enum extension rules:** `ALTER TYPE … ADD VALUE` cannot run inside a transaction block
  alongside statements that _use_ the new value, and new enum values aren't usable until committed.
  The plan keeps the enum additions in a clean migration and validates ordering against
  `node_modules`/Postgres docs before applying to cloud.
- **Membership/blast radius:** G3's `attachments.column_id` add touches a 4c table — the existing
  attachments + Storage RLS suites are a **regression gate** (must stay green).
- **Shared single checkout:** the listed hot files are touched by concurrent sessions — verify own
  scope before claiming green ([[develop-red-concurrent-work]]); worktree-isolate parallel batches.
- **Realtime on Files cells:** v1 is optimistic-patch + revalidate (no live cross-client Files sync) —
  acceptable; a follow-up can add `attachments` to the realtime publication.
- **Option delete is destructive by design** (clears referencing cells) — gated behind a
  count-confirm; the RPC makes settings/cells consistent atomically.
