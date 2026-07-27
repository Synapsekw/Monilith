---
type: spec
status: approved
phase: 6d-2
date: 2026-06-21
tags: [spec, phase/6, relations, mirror, columns]
related:
  - "[[2026-06-21-phase-6d1-relations-design]]"
  - "[[2026-06-20-phase-6c-time-tracking-design]]"
  - "[[2026-06-20-board-level-sharing-design]]"
---

# Phase 6d-2 — Mirror columns

## Summary

A new **read-only `mirror`** column kind that **displays a field value from the linked items on a
target board**, surfaced **through an existing `relation` column** on this board (Monday's "Mirror" /
ClickUp's "Rollup" pattern). Config picks a **source relation column** (on this board) and a **target
column** (on the relation's already-configured target board); each mirror cell renders the target
field's value(s) for the linked item(s), **read-only**, delegating to the underlying field kind's
renderer. No new table and no new RPC — mirror is a pure **derivation** off the same
`relation_links` join table 6d-1 already shipped (whose `(linked_item_id)` index exists precisely to
support this reverse read). The single new piece of stored state is the `mirror` enum value and the
column's `settings`.

This is slice **6d-2** and builds directly on **6d-1** (`relation` kind, `relation_links` table,
`set_relation_links` RPC, 0-round-trip link/name hydration, `RelationCell`/`RelationColumnConfig`).
Read the 6d-1 spec first: `docs/superpowers/specs/2026-06-21-phase-6d1-relations-design.md`.

## Goals

- Add a `mirror` column kind to the Add-column menu (read-only; no inline editor).
- Per-column config: pick a **source relation column** on this board + a **target column** on the
  relation's target board to mirror.
- Render the mirrored value(s) by **delegating to the target field kind's existing cell renderer**
  (`CellRenderer` from `src/components/boards/cells/index.tsx`), so a mirrored `status` shows the
  status pill, a mirrored `date` shows the formatted date, etc.
- Multi-value: when the source relation links **N** items, show the mirrored value from each (a
  small inline list, capped with a "+K more" overflow like `RelationCell`'s chips).
- **Cross-board, sharing-aware:** a viewer of the owning board who cannot read the target board sees
  **no mirrored value** — exactly as 6d-1 nulls the linked-item name. This is the high-risk surface.
- **0 server round-trips** on board first paint (mirror values hydrate with the board payload) and on
  in-cell view interactions.

## Non-goals (deferred)

- **Mirroring through a multi-target relation** — relations are single-target (a 6d-1 non-goal), so
  this is moot in v1.
- **Aggregating** multiple mirrored values into one (sum / average / min / max / "and N others") —
  v1 shows the per-item list, not a reduced scalar. (Open question Q1.)
- **Mirroring a derived/computed source kind** (`files`, `time_tracking`, `relation`, another
  `mirror`) — v1 supports mirroring only **scalar `cell_values`-backed kinds**
  (text/status/people/date/numbers/dropdown/checkbox/rating/link/email/phone). The target-column
  picker hides non-mirrorable kinds. (Open question Q2.)
- **Real-time / live cross-board refresh** — when a source cell on the **target** board changes,
  the owning board's mirror updates on its **next load or next owning-board mutation**, not live.
  (See Performance budget; matches Monday's eventual mirror refresh.)
- Filtering/sorting board views by a mirror column; mirror in dashboards/rollups (`rollupCell`
  returns `blank` for `mirror`, as it does for `relation`).

## Decisions (locked in brainstorming)

| Decision                | Choice                                                                                                                                                                  |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Storage                 | **None new** — derived from `relation_links` + the target cells' `cell_values`. Mirror has no `cell_values` row (like `relation`/`files`).                              |
| New table / RPC         | **None.** Migration adds only the `mirror` enum value.                                                                                                                  |
| Config shape            | `columns.settings = { source_relation_column_id: uuid, target_column_id: uuid }`                                                                                        |
| Indirection             | Mirror points at a **local relation column**, not directly at a board — the relation column owns `target_board_id`. Re-pointing the relation re-points all its mirrors. |
| Rendering               | **Delegate** to the target kind's `CellRenderer` (reuse, no per-kind mirror renderers).                                                                                 |
| Multi-value display     | Inline list of rendered values, capped with "+K more" (mirror of `RelationCell` overflow).                                                                              |
| Editability             | **Read-only.** Special-cased in `BoardTable` `EditableCell` like `relation`/`files`; never reaches `CellEditor`.                                                        |
| RLS                     | Inherited from board-level sharing: mirrored source values are read through the **user's** RLS-scoped client → unreadable target board yields no value.                 |
| First-paint cost        | **+1 bounded query** (target cells for this board's linked items × the mirror configs' target columns).                                                                 |
| Collapsed-parent rollup | `blank` (no aggregate in v1), same as `relation`.                                                                                                                       |

## Architecture

### Data model

- **Enum:** add `mirror` to `public.column_kind` in its own migration
  (`ALTER TYPE … ADD VALUE IF NOT EXISTS 'mirror'`), mirroring `20260621060000_relation_enum.sql`.
  No other DDL — **no table, no RPC, no new RLS policy**. Existing `relation_links` RLS and the
  board-level `can_read_board` boundary are the security primitives mirror reuses.
- **Column config** in `columns.settings` jsonb:
  `{ "source_relation_column_id": "<uuid>", "target_column_id": "<uuid>" }`.
  - `source_relation_column_id` references a column on **this** board whose `kind = 'relation'`.
  - `target_column_id` references a column on the relation's `target_board_id` (a different board)
    whose kind is a mirrorable scalar kind.
- **No `cell_values` row** for a mirror cell — `mirrorValueSchema = z.object({}).strict()`, exactly
  like `relationValueSchema`/`filesValueSchema` (kept only to make the `cellValueSchema` switch
  exhaustive; never written by `upsertCell`).

### What a mirror cell derives from

For owning item `I` with a mirror column `M` configured `{ source_relation_column_id: R, target_column_id: T }`:

1. The links on `(I, R)` from `relation_links` → a set of `linked_item_id`s on the target board.
2. For each `linked_item_id L`, the `cell_values` row `(L, T)` on the target board.
3. The mirror renders, per linked item, the target value via the **kind of column `T`**.

All three are already-RLS-bounded reads; (1) is already in the board payload (`relationLinks`), and
(2) is the single new query.

### RLS (the careful part) — reuses 6d-1's proven boundary

A mirror surfaces data that lives on a **different board** than the cell. The security rule is
identical to 6d-1's linked-name resolution and the board-sharing storage-RLS fix
([[2026-06-20-gotcha-26-per-board-privacy-all-board-scoped-tables]]):

- The owning board's `relation_links` are readable iff `can_read_board(owning board)` — already true
  for anyone viewing the board.
- The **target cell values** `(L, T)` are read through the **caller's RLS-scoped Supabase client**
  (the `cell_values` SELECT policy gates on `can_read_board(board_of(L))`). A viewer of the owning
  board who is **not** a member of the target board gets **zero rows** back for those cells →
  `mirrorValueFor(L)` resolves to **absent**, and that linked item contributes **nothing** to the
  mirror cell. No service-role read, no JS-side board check, no cross-tenant leak, no error — exactly
  how 6d-1's name join nulls the chip label.
- **There is no new write path**, so there is no new `with check` / `can_edit_board` surface to get
  wrong. Mirror is select-only.

The single proof obligation (integration test, below): _a viewer of board A who cannot read board B
sees the relation chips' link rows but the mirror cell for those links is empty._

### First paint (0 round-trips) — payload hydration

`getBoardPayload` (`src/lib/boards/queries.ts`) already issues the parallel RLS-scoped reads and the
two-query relation-name join. Mirror adds:

1. **Compute the mirror plan** from `columns` (cheap, in-memory): the set of
   `(source_relation_column_id, target_column_id)` pairs for every `mirror` column on this board.
2. **Collect the target item ids** = the `linked_item_id`s of every link belonging to a referenced
   source relation column (already in `relationLinks`).
3. **One bounded query** `cell_values where item_id IN (<linked ids>) AND column_id IN (<target
column ids>)`, RLS-filtered → returns only target cells the caller may read. Bounded by the same
   first-paint budget posture as `relationLinks` (`.limit(...)`, indexed on `(item_id, column_id)`).
4. **Also fetch the target columns' metadata** (`id, kind, settings`) for the referenced
   `target_column_id`s — needed so the cell can render with the correct kind + settings (e.g. a
   mirrored `status` needs the **target column's** options to resolve the pill). One small
   `columns where id IN (<target column ids>)` read (RLS-scoped; a column on an unreadable board
   returns nothing → mirror renders empty, consistent with the value filter).

The payload gains a `mirrorSource` slice: the readable target `cell_values` + the referenced target
`columns` (id/kind/settings). Hydrated into each mirror cell client-side via a new cache accessor —
no per-cell fetch.

```
BoardPayload += {
  mirrorTargetCells: CellValue[];      // (linked item, target column) values the caller can read
  mirrorTargetColumns: Pick<Column,    // referenced target columns' render metadata
    "id" | "kind" | "settings">[];
}
```

### Cache + accessors + cascade-invalidation

`BoardCache` (`src/lib/boards/cache.ts`) gains the same two arrays. A new accessor:

```ts
// Resolve the mirrored values for one mirror cell:
//   1. find links on (itemId, source_relation_column_id)
//   2. for each linked item, look up (linkedItemId, target_column_id) in mirrorTargetCells
//   3. return [{ linkedItemId, value | null }] in link position order
mirrorValuesForCell(cache, itemId, mirrorColumn): MirrorValue[]
```

Plus the target column's render metadata (`mirrorTargetColumns.find(c => c.id === target_column_id)`)
so the cell can delegate to `CellRenderer`.

**Cascade-invalidation — the two trigger sources:**

1. **Relation links change on THIS board** (link/unlink/reorder via `setRelationLinks`): the existing
   Server Action calls `revalidatePath('/boards/<owning board>')`, which re-runs `getBoardPayload`
   and **re-derives** the mirror values from the new link set — so mirrors are correct after any
   link edit with **no new code**. The client-side optimistic path additionally needs the mirror to
   recompute when `setRelationLinksForCell` updates the cache: because `mirrorValuesForCell` reads
   live from `cache.relationLinks` + `cache.mirrorTargetCells`, a React re-render after the optimistic
   `relationLinks` update **already** reflects added/removed links (newly-linked items show a value
   once their target cell is present in `mirrorTargetCells`; if it isn't yet — a freshly linked item
   whose target cell wasn't in the first-paint set — the mirror shows empty until the post-mutation
   `revalidatePath` refresh lands). This is acceptable and documented; no optimistic mirror-value
   fetch in v1.

2. **The mirrored SOURCE cell changes on the TARGET board** (someone edits `(L, T)` on board B):
   `upsertCell`'s `revalidatePath('/boards/<board B>')` does **not** revalidate board A, so an open
   board A is **stale** until its next load or its next own mutation (which triggers A's
   `revalidatePath`). This is the **accepted v1 limitation** (Non-goals: real-time). It matches
   Monday's mirror refresh latency. A future enhancement (out of scope) could `revalidateTag` a
   per-target-cell tag that mirrors subscribe to.

### Components

- **`MirrorCell`** (`src/components/boards/cells/MirrorCell.tsx`) — read-only. Props:
  `{ values: MirrorValue[]; targetKind: ColumnKind; targetSettings: Settings; maxItems?: number }`.
  Renders each readable value through `<CellRenderer kind={targetKind} value={v} settings={targetSettings} />`,
  laid out inline with a "+K more" overflow (mirror of `RelationCell`); empty/absent values
  contribute nothing. A subtle read-only affordance (muted text / no hover-edit cursor). **Not**
  registered in the `CellRenderer` switch — special-cased in `EditableCell` like `relation`.
  - Guard: if `targetKind` is itself non-renderable here (`files`/`time_tracking`/`relation`/`mirror`),
    render a muted "—" (defensive; the config picker already excludes these).
- **`MirrorColumnConfig`** (`src/components/boards/MirrorColumnConfig.tsx`) — add-column dialog step.
  Two dependent selects:
  1. **Source relation column** — a `<select>` over this board's columns where `kind = 'relation'`
     (from `board.columns`, in-memory; no fetch). If the board has **no** relation column, show an
     empty state ("Add a Relation column first") and disable confirm.
  2. **Target column** — once a relation is chosen, resolve its `target_board_id` and fetch that
     board's mirrorable columns via a new bounded server query `listMirrorableColumns(targetBoardId)`
     (RLS-scoped; returns `{ id, name, kind }` for scalar kinds only). One lazy fetch on relation
     selection (a different board's metadata — same posture as 6d-1's `listRelationCandidates`).
  - Confirm disabled until both are set. Props mirror `RelationColumnConfig`
    (`{ relationColumns, loadTargetColumns, onConfirm, onCancel }`).
- **Add-column wiring** in `BoardTable.tsx`: selecting "Mirror" from `AddColumnMenu` opens the
  `MirrorColumnConfig` dialog (parallel to the relation branch at the existing modal).
- **Registry:** `COLUMN_KIND_META.mirror = { label: "Mirror", Icon: FoldHorizontal, hasOptions: false }`
  and append `"mirror"` to `COLUMN_KIND_ORDER` (`src/lib/boards/column-kinds.ts`). The
  `column-kinds.test.ts` META↔ORDER parity test must stay green.
- **Validation:** add `"mirror"` to `columnKindSchema`; add `mirrorSettingsSchema`
  (`{ source_relation_column_id: uuid, target_column_id: uuid }`) to `columnSettingsSchema`; add
  `mirrorValueSchema = z.object({}).strict()` to `cellValueSchema`
  (`src/lib/validations/boards.ts`).
- **Exhaustive-switch fallout (compile-graph):** adding `mirror` to the enum forces a new arm in
  **every** exhaustive `switch (kind: ColumnKind)`. Known sites to update: `columnSettingsSchema`,
  `cellValueSchema`, `rollupCell` (return `{ kind: "blank" }`), `COLUMN_KIND_META`/`ORDER`, and
  column-default seeding (`column-defaults.ts`). The plan's first task greps for all `ColumnKind`
  switches so none is missed (stale switches are a compile error — good).
- **Editors index:** `mirror` returns `null` (no inline editor), like `files`/`relation`.

### Deletion / integrity semantics

- Mirror config holds raw ids in jsonb (no FK), so deleting the **source relation column** or the
  **target column** leaves a dangling reference. The cell renders **empty** (the derivation finds no
  links / no target column) — no crash. v1 accepts dangling-config-renders-empty (matches how a
  relation with a deleted target board renders empty). A nicety (warn/auto-clear on column delete)
  is deferred. Note in the plan as a known edge; covered by a unit test (config pointing at a
  missing column → empty render).
- Deleting a linked target item cascades its `relation_links` (6d-1 FK) → the mirror drops that
  item's value automatically.

## Performance & data-fetching budget (AGENTS.md #5)

- **First paint:**
  - (a) Mirror values hydrate **with** the board payload at **0 extra round-trips for the user** — it
    is part of the single `getBoardPayload` server fetch. Concretely **+1 bounded `cell_values`
    query** (target cells for this board's linked items × mirror target columns) **+1 small
    `columns` metadata query** (referenced target columns) inside the already-batched
    `Promise.all`. No per-cell fetch, no N+1.
  - (b) Reads are **bounded over indexed columns:** the target-cell query filters
    `item_id IN (…) AND column_id IN (…)` — both covered by `cell_values`'s `(item_id, column_id)`
    PK/index; `.limit(...)` caps it on the same posture as `relationLinks.limit(2000)`. No
    `select *` on a growing table beyond the board's linked set.
- **In-page interactions (scroll, view switch, collapse/expand, opening the relation picker):**
  **0 new server round-trips.** Mirror values are derived client-side from the hydrated cache by
  `mirrorValuesForCell`; nothing about a mirror is interactive/editable.
- **Does the interaction change server data?** **No** — mirror is read-only, so there is **no Server
  Action on the mirror cell** (AGENTS.md #5(b): no server data change → client state only). The only
  writes that affect a mirror are (i) editing the underlying **relation links** (already a 6d-1
  Server Action with `revalidatePath` → re-derives mirrors) and (ii) editing the **target source
  cell** (a 6d-1/earlier Server Action on the target board). Mirror itself adds no mutation surface.
- **Config dialog:** **1 lazy** `listMirrorableColumns(targetBoardId)` query on relation selection
  (a different board's column metadata, not the current page's data) — acceptable, cached for the
  dialog's lifetime. Identical posture to 6d-1's lazy `listRelationCandidates`.
- **Cross-board staleness:** a source-cell edit on the target board does not push to an open owning
  board (no live refresh in v1). Refreshes on next owning-board load / mutation. Documented
  limitation, not a budget violation (it's a _freshness_ tradeoff, deliberately chosen to keep the
  hot path at 0 round-trips).

## Cross-board RLS — proof obligations

The integration suite (live, CI-skipped, extends `relation-links.rls.integration.test.ts`'s harness:
admin/service-role + per-user anon clients; owner with board A (owning) + board B (target); outsider
= org member, viewer of A, **non-member of B**) MUST prove:

1. **Mirror respects target-board RLS (the core test):** owner links `itemA → [b1]` and sets a value
   on `(b1, T)` on board B. Reading board A's mirror-source slice **as the outsider** (viewer of A,
   not B) returns **no row** for `(b1, T)` → `mirrorValuesForCell` yields empty → the rendered mirror
   is blank. The **owner** (who can read B) gets the value. This is the 6d-1 null-name analogue,
   asserted at the data layer.
2. **A non-viewer of A sees nothing at all** (the owning-board `relation_links` SELECT already gates
   this — re-asserted for the mirror slice).
3. **Re-pointing / dangling config:** deleting target column `T` (or the source relation column)
   makes the mirror slice empty without error (RLS + derivation both degrade to empty).
4. **No write path exists:** assert there is **no** RPC/endpoint that writes a mirror value
   (negative/design assertion — mirror is select-only; this is the structural guarantee that there
   is no `can_edit_board` surface to bypass).

The crucial #1 must mirror, verbatim in spirit, 6d-1's "viewer of A can read link rows but not the
linked-item name" test — that test is the template.

## Testing (TDD)

- **Unit (Vitest):**
  - `mirrorValuesForCell` derivation: single link, multi-link ordering by position, link to an item
    whose target cell is absent (→ that entry empty), config pointing at a deleted column (→ empty).
  - `MirrorCell` render: delegates to the right `CellRenderer` per `targetKind` (status pill, date,
    number, etc.); "+K more" overflow; all-empty → blank; non-renderable `targetKind` → muted "—".
  - `MirrorColumnConfig`: disabled-confirm until both selects set; empty state when board has no
    relation column; target-column list excludes non-mirrorable kinds.
  - Validation: `mirrorSettingsSchema` accepts/rejects; `cellValueSchema('mirror')` is empty-strict;
    `columnKindSchema` includes `mirror`; `COLUMN_KIND_META`↔`ORDER` parity stays green.
  - `rollupCell('mirror')` → `{ kind: "blank" }`.
- **Live RPC/RLS integration (CI-skipped suite):** the four proof obligations above, on the extended
  6d-1 harness. (No RPC to test for mirror itself — these assert the **read** boundary.)
- **e2e (Playwright):** add a relation column on board A → link an item from board B → add a mirror
  column pointing at the relation + a target column on B → assert the mirrored value renders in the
  mirror cell (and that it is non-editable).

## Independent units (for the plan's execution DAG)

- **U1 — DB enum + types + validation + registry:** `mirror` enum migration; regenerate
  `database.types.ts`; `columnKindSchema`/`mirrorSettingsSchema`/`mirrorValueSchema`; `COLUMN_KIND_META`/
  `ORDER`; `rollupCell` arm + every other `ColumnKind` exhaustive-switch arm; column-default seed.
  Unit tests for schemas + registry parity. **(Root — everything below depends on it.)**
- **U2 — payload + cache derivation:** `mirrorTargetCells`/`mirrorTargetColumns` in `getBoardPayload`
  - `BoardPayload`/`BoardCache`; `mirrorValuesForCell` accessor + `listMirrorableColumns` query.
    Unit tests for the derivation. **(Depends on U1's types.)**
- **U3 — `MirrorCell`:** presentational read-only cell delegating to `CellRenderer` + overflow + unit
  tests. **(Depends on U1 for `ColumnKind`; consumes the `MirrorValue` shape U2 produces — so depends
  on U2's type export.)**
- **U4 — `MirrorColumnConfig` + add-column wiring:** dual-select config + `BoardTable` add-column
  branch + unit tests. **(Depends on U1 for the kind + U2 for `listMirrorableColumns`.)**
- **U5 — `BoardTable` `EditableCell` special-case + parent-rollup arm:** route `mirror` to
  `MirrorCell` (read-only), wire the collapsed-parent rollup to blank. **(Depends on U2 + U3.)**
- **U6 — RLS integration tests:** the four cross-board proof obligations on the 6d-1 harness.
  **(Depends on U1 + U2 — needs the payload read path; independent of UI U3/U4/U5.)**
- **U7 — e2e + full gate:** Playwright flow + `typecheck/lint/test/build`. **(Depends on all.)**

U3/U4 are mutually independent once U1+U2 land (a parallel wave); U6 runs in parallel with the UI
units; U5 joins U2+U3; U7 is the final join. The plan owns the formal DAG.

## Resolved decisions (locked 2026-06-21 — "as close to Monday/ClickUp/Asana as possible")

The five open questions are resolved as follows; the rationale is fidelity to Monday's Mirror /
ClickUp's Rollup behavior.

- **Q1 — Aggregation → DEFER to a committed 6d-3.** Ship the **per-item value list** (capped "+K
  more") in 6d-2. This is Monday's mirror _default_ (the column shows the connected items' values);
  sum/avg/min/max/count belong in the column **summary footer** (ClickUp's Rollup calc), scheduled
  as **6d-3** — not optional.
- **Q2 — Mirrorable source kinds → all `cell_values`-backed kinds** (text, long-text, number,
  status, dropdown, date, **people**, checkbox, rating, link, email, phone). status/people/date are
  _the_ core Monday mirror targets and already have `CellRenderer` arms + payload-resident data
  (org members included), so near-zero extra hydration. **Exclude** `files`, `time_tracking`,
  `relation`, and `mirror` (no 2-hop chains / side-table reads in v1).
- **Q3 — Multi-link → SUPPORT, capped.** A multi-link relation mirrors all N values with a "+K more"
  overflow, matching Monday's multi-connect mirror and our shipped 6d-1 relation chips.
- **Q4 — Cross-board freshness → ACCEPT v1 refresh-on-load.** Re-derives on the owning board's next
  load / mutation (`revalidatePath` already re-runs the payload on link edits); no live cross-board
  push in v1. Keeps the hot path at 0 round-trips; matches Monday's mirror-refresh latency. A
  `revalidateTag` cross-board push is a later enhancement.
- **Q5 — Label "Mirror", icon `FoldHorizontal`** (Lucide — reads as reflect/mirror across a vertical
  axis). Monday's column name.

## Open risks

- **Cross-board RLS** is the highest-risk surface — proof obligation #1 (viewer of A, non-member of
  B, mirror empty) is the gate, mirroring how 6d-1 proved the name-join filter and how board-sharing
  proved the storage-RLS fix. If the mirror-source `cell_values` read were ever done with the
  service-role client (it must **not** be), it would leak target-board data; the test exists to catch
  exactly that regression.
- **First-paint query growth** — the mirror-source `cell_values` `IN (…)` list scales with the
  board's total linked items. Bounded by `.limit(...)`; if a board mirrors thousands of links, a
  server-side projection is the documented follow-up (same tradeoff as `relationLinks.limit(2000)` /
  `timeEntries.limit(1000)`).
- **Exhaustive-switch drift** — missing a `ColumnKind` switch arm is a **compile error**, so the
  type system enforces completeness; the plan's grep-first task is belt-and-suspenders.
