# Priority field + auto-critical flagging — design

- **Date:** 2026-07-03
- **Status:** Spec complete, awaiting review
- **Branch:** `task/priority-critical`
- **Feature item:** MVP Final Features item **5**
  (`docs/superpowers/plans/2026-07-03-mvp-final-features.md`), from feedback F5.2.
- **Mode:** Non-interactive brainstorm — genuinely open product calls are recorded in
  "Open questions for review" instead of asked.

## Problem (feedback verbatim)

> "Priority Field + Auto-Critical Flagging — Add a new Priority field (separate from the existing
> Status field): Normal / Critical. Auto-set Priority to Critical when 2 or more items depend on
> it. Depends on Item 1 being built first (dependency data must exist)."

(The stated dependency is on finish-to-start dependency data, which shipped in Phase 3 — nothing
blocks this feature.)

## Verified context (explored in this worktree)

- **Dependency data already rides the board payload.** `item_dependencies`
  (`supabase/migrations/20260616192633_timeline_dependencies.sql`: FS-only, same-board,
  cycle-guarded RPC, indexed on `predecessor_id`/`successor_id`) is loaded wholesale per board by
  `getBoardPayload` (`src/lib/boards/queries.ts`) and lives client-side as
  `BoardCache.dependencies` (`src/lib/boards/cache.ts`). GanttBoard already filters this array at
  render time (`cache.dependencies.filter(d => d.successor_id === …)`). **Counting an item's
  dependents is therefore a zero-fetch, in-memory operation.**
- **"Add a column kind" is a well-trodden, compiler-enforced path** (percent 2026-06-23,
  currency 2026-07-03): one-line enum migration (`alter type public.column_kind add value`),
  then exhaustive switches force out every touchpoint — `columnKindSchema` /
  `columnSettingsSchema` / `cellValueSchema` (`src/lib/validations/boards.ts`),
  `COLUMN_KIND_META`/`COLUMN_KIND_ORDER` (`src/lib/boards/column-kinds.ts`), `defaultColumn`
  (`src/lib/boards/column-defaults.ts`), `allowedAggregations` (`src/lib/boards/aggregation.ts`),
  `CellRenderer` (`src/components/boards/cells/index.tsx`), `CellEditor`
  (`src/components/boards/cells/editors/index.tsx`), spreadsheet codec
  (`src/lib/boards/spreadsheet/cell-codec.ts`), rollup (`src/lib/boards/rollup.ts`).
- **The overdue-tint precedent** (`src/lib/boards/overdue.ts` + `DateCell`'s `overdue` prop,
  threaded through BoardTable's row-render site): a pure derived render-time signal computed from
  the already-loaded payload — zero schema, self-clearing, `aria-label`/`title` so color is never
  the sole carrier. This feature copies that shape exactly for the auto part.
- **`isItemComplete` keys on the board's FIRST `status` column** — a load-bearing heuristic this
  design must not break (see approach comparison).
- **Kanban cards** split columns into colored `pills` (status/dropdown) and quiet icon `meta`
  (`src/lib/boards/kanban-card.ts`); the board header has **no filter infrastructure** (nothing to
  extend — filters are out of scope, as they were for the overdue tint).
- **The item panel's Fields tab is a placeholder** ("Edit fields in the board grid") — it is not a
  cell-rendering surface today, so it is not a surface for this feature.
- **pulse-ui** already reserves a priority color mapping (gray = low/normal, red = urgent) and
  sanctions option-pill color only on status-label surfaces; `text-destructive`/status-red must be
  earned.

## Central decision: derived render-time auto signal, on a dedicated column kind

The feedback decomposes into two halves with different natures:

1. **"Add a new Priority field … Normal / Critical"** — a plain, user-editable value. That is
   server data: a column + cell values, edited through the existing cell-editing Server Action.
2. **"Auto-set Priority to Critical when 2 or more items depend on it"** — a _fact derivable at
   any moment_ from data already in the payload. Persisting it (triggers on `item_dependencies`,
   automation rules, backfills, un-set-on-delete logic) is exactly the health-flag machinery the
   owner descoped on this same goal (see the status-intelligence spec's "Descoped by product
   decision"). Derived-at-render is self-clearing, needs zero engine work, and can never drift
   from the dependency graph.

**Decision (a): the auto-Critical state is a DERIVED, render-time display state** — the overdue
red tint precedent — computed from `cache.dependencies`, layered over **a real, manually editable
Priority column**. Nothing auto is ever written to the database.

### Which kind of "field"? Dedicated `priority` column kind

Three candidates were weighed:

| Option                                                                      | Verdict    |
| --------------------------------------------------------------------------- | ---------- |
| **(1) Dedicated built-in `priority` column kind** (one-line enum migration) | **Chosen** |
| (2) Preset `status`-kind column named "Priority" (zero migration)           | Rejected   |
| (3) Item property (`items.priority` DB column)                              | Rejected   |

- Option 2 fails on three counts: a status-kind "Priority" column **breaks the overdue tint's
  `isItemComplete` heuristic** (first status column by position — a Priority column placed before
  Status makes every item read incomplete forever); its options are user-editable, so the
  Normal/Critical contract the auto rule renders against can be renamed/extended out from under
  it; and detecting "the priority column" needs a name regex — a heuristic where option 1 gets
  `kind === "priority"` for free. The migration option 2 avoids is one additive line with two
  direct precedents.
- Option 3 fights the house architecture: every user-facing field is an EAV column; a special
  item property needs bespoke UI on every surface instead of riding the column registries, and
  "field the user adds/sees like any other" matches the feedback better.
- The feedback's "separate from the existing Status field" reads naturally as a distinct field
  type, which option 1 satisfies literally.

### Precedence: manual vs auto (normative)

Stored cell value: `{ level: "normal" | "critical" }`, or no cell (unset).

```
effective(item) = "critical"  iff  stored.level === "critical"
                                   OR dependents(item) >= 2
                  "normal"    otherwise
```

- `dependents(item)` = count of **direct** `item_dependencies` rows with
  `predecessor_id === item.id` (successors that depend on it; not transitive).
- Threshold constant `AUTO_CRITICAL_MIN_DEPENDENTS = 2` (a named export, not a magic number).
- **Auto overrides manual Normal for display** — "auto-set" verbatim: if 2+ items depend on it,
  it shows Critical even if the user set Normal. The stored value is **never mutated** by the
  rule; when dependents drop below 2, display falls back to the stored value (self-clearing).
- Manual Critical always shows Critical (auto adds nothing on top).
- The auto state is **visually distinguished and explained** (see UI) so "I set Normal and it
  still says Critical" reads as intentional, not broken: the pill carries
  `title`/`aria-label` "Critical (auto) — N items depend on this".

## Design

### 1. Data model (one additive migration)

`supabase/migrations/20260703110000_priority_enum.sql`:

```sql
-- MVP Final item 5: add the priority column kind.
alter type public.column_kind add value if not exists 'priority';
```

- Version slot **20260703110000** is deliberately reserved per
  `vault/decisions/2026-07-03-gotcha-43-parallel-branch-migration-version-collision.md` — the
  parallel health-summary branch may also mint `202607031xxxxx` migrations; this branch owns
  `…110000` and nothing else.
- Enum-only, additive, no RLS change (columns/cell_values policies are kind-agnostic), no new
  table, no index (reads ride the existing per-board payload queries).
- **Manual-apply gate:** the agent cannot push migrations (memory: classifier denies); the user
  applies the SQL, then this branch regenerates `src/types/database.types.ts` (`pnpm db:types`)
  as the schema-owning branch (gotcha-43 rule 2; possible union with sibling enum values is a
  known, planned artifact).

Cell value (Zod, `src/lib/validations/boards.ts`):

```ts
export const priorityValueSchema = z.object({
  level: z.enum(["normal", "critical"]),
});
```

Settings: `emptySettingsSchema` (fixed two-value vocabulary — **no options array**, nothing to
edit, `hasOptions: false`). Default column name: "Priority". Writes go through the existing
`upsertCell` Server Action path untouched — adding the schema case is the entire write surface.

### 2. Derived helper (pure module, mirrors `overdue.ts`)

`src/lib/boards/priority.ts`:

- `AUTO_CRITICAL_MIN_DEPENDENTS = 2`
- `buildDependentsCountMap(dependencies): Map<string, number>` — one O(E) pass over
  `cache.dependencies`, keyed by `predecessor_id`. Built once per render pass and memoized on
  `cache.dependencies` (same pattern GanttBoard already uses for its dependency lookups), so
  per-row lookup is O(1) — no per-row array scans in a virtualized table.
- `effectivePriority(stored, dependentsCount): { level: "normal" | "critical"; auto: boolean }`
  — `auto: true` only when the threshold (not a manual Critical) is what made it critical; drives
  the distinguishing marker + tooltip.

### 3. UI (pulse-ui: color is earned; red only where it means something)

- **`PriorityCell`** (in `src/components/boards/cells/index.tsx`, dispatched by `CellRenderer`
  via a `dependents?: number` prop threaded exactly like `DateCell`'s `overdue`):
  - **Effective Critical:** a status-red pill — `bg-status-red` + white label text "Critical"
    (the sanctioned label-pill pattern; label text carries meaning, never color alone).
  - **Auto variant:** same pill plus a small inline lucide icon (`Network`, `size-3`) and
    `title`/`aria-label` `"Critical (auto) — N items depend on this"`. The icon is the visual
    "this came from the dependency graph" cue.
  - **Explicit Normal:** quiet `text-muted-foreground` text "Normal" — no pill, no color;
    chrome stays monochrome.
  - **Unset (and not auto):** blank cell, like an empty status cell — the default state is
    silent, not a row of gray "Normal" noise.
- **`PriorityEditor`** (in `cells/editors/`): the existing `PopoverSurface` selector with two
  fixed rows (Critical — red pill preview; Normal) + the standard clear affordance. When the
  auto state is active, the popover shows a non-interactive `text-muted-foreground` note:
  "Auto-critical: N items depend on this item. Setting Normal is kept but overridden while 2+
  dependents exist." Commit path = `onCommit({ level })`, identical to StatusEditor's shape.
- **Add-column menu:** `COLUMN_KIND_META.priority = { label: "Priority", Icon: Flag,
hasOptions: false }`, appended to `COLUMN_KIND_ORDER`. No board seeding — the user adds a
  Priority column like any other kind (see open question 3).
- **Kanban card:** `priority` joins the pill zone (`PILL_KINDS`), but a card shows the pill
  **only when effective-Critical** (explicit Normal/unset render nothing — cards stay scannable;
  `KanbanBoard` has the cache in scope to compute the dependents map). Same auto icon + label.
- **Gantt (optional, droppable unit):** dependencies are _drawn_ in this view, so a minimal
  effective-Critical marker on the name rail (small `bg-status-red` dot + `sr-only`/"title"
  text) is included as an isolated, cuttable task — explicitly NOT the descoped badge/ring/filter
  machinery. See open question 2.
- **Not in scope:** item panel (Fields tab is a placeholder today), calendar, filters (no filter
  infrastructure exists; the overdue tint set this precedent), notifications/automations (the
  `status_changed` trigger family is status-column-specific; nothing here writes cells).

### 4. Secondary registries (compiler-forced, all small)

- `allowedAggregations("priority")` → `["distribution", ...COUNT_FAMILY]` with synthesized
  fixed segments (Normal gray / Critical red) over **stored** values.
- Spreadsheet codec: `cellToText` → "Critical" / "Normal" (stored value); import: `priority`
  joins `ImportableKind`, parsing "critical"/"normal" case-insensitively (anything else →
  blank cell) — keeps export → import round-trips lossless.
- `rollupCell`: collapsed-parent rollup renders blank (no meaningful aggregate pill), matching
  the quiet default.
- `isCardCellEmpty("priority", …)`: empty unless effective-Critical (needs the dependents count
  at the call site — signature gains an optional param or the card branches before the check).
- Mirror columns targeting a priority column render the **stored** value through the existing
  mirror path (no auto — the mirror board's payload has no foreign dependency data). Documented
  limitation, not a bug.

## Performance & data-fetching budget (working agreement #5)

- **(a) First paint vs interaction: 0 new server round-trips anywhere.** `cache.dependencies`
  is already in every board payload (`getBoardPayload` fetches it today for the Gantt); the
  dependents map is a memoized O(E) in-memory pass. No new queries, no new payload fields, no
  polling. No new interactions are added (no filter, no toggle).
- **(b) Server data vs client state:** the only server-data change is the user editing a
  priority cell → the **existing** `upsertCell` Server Action (one action per edit, optimistic
  update + realtime echo, unchanged). The auto-Critical display is pure client derivation —
  nothing persisted, nothing to invalidate; dependency create/delete already flows through the
  existing realtime channel and updates `cache.dependencies`, which recomputes the memoized map.
- **(c) Bounded + indexed:** no new reads at all. The payload's `item_dependencies` read is the
  existing per-board, `board_id`-indexed query. Rendering cost is O(E) once per dependencies
  change + O(1) per row.

## Security

- No RLS changes; the enum value is inert. Cell writes ride the existing org-scoped
  `cell_values` policies and Zod boundary (`cellValueSchema("priority")`).
- The auto signal reveals nothing the viewer's RLS-scoped payload doesn't already contain (the
  Gantt draws the same edges).

## Testing strategy

- **Unit (Vitest, all pure):**
  - `priority.ts`: threshold boundary (0/1 dependents → not auto; 2/3 → auto), manual-Critical
    wins, auto-overrides-manual-Normal, self-clearing fallback to stored, map correctness with
    duplicate predecessors and empty edge lists.
  - `cells.test.tsx` additions: Critical pill renders label + `bg-status-red`; auto variant
    carries icon + "Critical (auto) — N items depend on this" title/aria; explicit Normal is
    quiet text; unset renders blank; `dependents` prop threading through `CellRenderer`.
  - Editor: two options render, commit shape `{ level }`, clear works, auto note shown when
    active.
  - Zod: `priorityValueSchema` accepts both levels, rejects junk; `columnKindSchema` includes
    `priority`; `defaultColumn("priority")` name/settings.
  - Kanban card: pill only when effective-Critical; codec: export labels + (if included) import
    parsing; aggregation: distribution segments.
- **No integration/migration tests:** the migration is enum-only (no behavior to pin); cell CRUD
  for the new kind rides paths already covered by columns/cell_values RLS integration tests.
- Migration gate at build time: typecheck fails until types are regenerated after the user
  applies the migration — the plan sequences this explicitly.

## Independent units (feeds the plan's Execution DAG)

- **U1** Migration file + manual apply + `pnpm db:types` regen (the only serial gate).
- **U2** Validation + registries: Zod schemas, kind meta/order, default column, aggregation,
  codec, rollup (compiler-forced sweep; depends on U1's regenerated `ColumnKind`).
- **U3** Derived helper `src/lib/boards/priority.ts` + tests (pure; depends on nothing but
  existing cache types — fully parallel with U1/U2).
- **U4** `PriorityCell` + `PriorityEditor` + `CellRenderer`/`CellEditor` dispatch (after U2, U3).
- **U5** Surface wiring: BoardTable dependents-map threading, kanban card, add-column menu
  entry (after U4).
- **U6 (optional/droppable)** Gantt name-rail marker (after U3 only).

## Open questions for review

1. **Auto overrides manual Normal** (chosen — "auto-set" verbatim, with an explanatory
   tooltip + editor note). Alternative: manual Normal suppresses the auto flag ("dismiss"
   semantics). If the owner prefers dismissal, only `effectivePriority` and two tests change.
2. **Is the Gantt name-rail dot in or out?** Dependencies are drawn there, so it's the most
   contextual surface — but the descoped health design died partly on Gantt badge scope. Kept as
   an isolated droppable unit; cutting it costs nothing else.
3. **No auto-seeded Priority column on new boards** (chosen: user adds it via the Add-column
   menu, like every other kind). Alternative: seed it in `create_board` — rejected as noise for
   boards that never use dependencies, but cheap to add later.
4. **Threshold fixed at 2, direct dependents only** (verbatim reading). Not configurable, not
   transitive. Confirm nobody expects "2+ anywhere downstream".
5. **Exports show the STORED value, not the effective one** (keeps export → import lossless and
   matches mirrors). Alternative: export effective priority (the export path has the payload, so
   it's computable) at the cost of a re-import writing auto states as manual Critical. Confirm.
6. **Unset renders blank** (not a gray "Normal" on every row). Explicit Normal renders quiet
   muted text. Confirm the quiet default.
