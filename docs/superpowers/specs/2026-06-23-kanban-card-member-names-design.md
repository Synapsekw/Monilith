# Kanban card member names — design

**Date:** 2026-06-23
**Topic:** Render resolved assignee **names** on the Kanban card's People/Owner summary field, closing the consistency gap left by the people-cell-assignee-names session (which fixed the Table cell only).
**Status:** Spec — ready for plan. Nothing built.
**Estimated size:** S (one component file edit + tests; no schema, no new data fetch).

---

## Problem

The people-cell-assignee-names session (vault session `2026-06-22-1955-people-cell-assignee-names.md`) made the **Table** People/Owner cell render resolved assignee **names** (full name → email → "Unknown" fallback) by threading the org `members` directory through `CellRenderer` → `PeopleCell`. It also added a deliberate **count-fallback**: when `members.length === 0` (no directory available, e.g. mirrored people cells), `PeopleCell` renders `"N people"` instead of a row of "Unknown".

The **Kanban card** was left behind. Each card renders its People/Date summary columns through `CellRenderer`, but `KanbanCard` does **not** pass `members`, so `PeopleCell` always hits the `members.length === 0` branch and shows a count ("1 person") even though the directory is already loaded and available one component up. This is purely a presentation inconsistency between two views of the same data.

Grounding (all paths relative to the worktree `.claude/worktrees/kanban-member-names`):

- `src/components/boards/cells/index.tsx`
  - `PeopleCell` (L73–95): takes `members?: EditorMember[]`; empty → blank, `members.length === 0` → count-fallback (L85–91), otherwise resolves ids → names via `memberLabel` (L69–71: `fullName || email || "Unknown"`) and joins with `", "`.
  - `CellRenderer` (L233–331): accepts `members?: EditorMember[]` (L242) and forwards it to `PeopleCell` for `kind === "people"` (L266–273).
- `src/components/boards/KanbanBoard.tsx`
  - `KanbanBoard` **already receives** `members` as a prop (L93–96) — passed from `BoardViews` (see below). The current doc-comment at L98–101 says the card summary is "count-only … so member identities aren't needed here yet"; this spec makes them needed.
  - `summaryColumns` (L144–147): People + Date columns surfaced on cards.
  - `KanbanColumnView` (L264–370) renders `KanbanCard` (L347–352) — `members` is **not** threaded through this layer.
  - `KanbanCard` (L372–429) maps `summaryColumns` to `CellRenderer` (L417–423) **without** `members`. This is the single root-cause line.
- `src/components/boards/BoardViews.tsx`
  - `<KanbanBoard … members={members} … />` (L94–100) — the directory already arrives at the Kanban view. **No upstream change needed.**
- `src/components/boards/cells/editors/index.tsx`
  - `EditorMember` type (L23–28): `{ userId; fullName: string | null; email: string | null; avatarUrl: string | null }`.
- Table reference for the exact pattern: `src/components/boards/BoardTable.tsx` resolves `members` into render controls (L558) and forwards to `CellRenderer` (L1976–1980) and the people editor (L1945).

So the directory is loaded once on the server and already passed to `KanbanBoard`. **This is a 0-round-trip prop-threading fix**, not a data-fetching change.

---

## Goal / non-goals

**Goal.** The Kanban card's People/Owner summary renders assignee **names** identically to the Table cell — same `memberLabel` resolution (`fullName || email || "Unknown"`), same `", "` join, same `members.length === 0` count-fallback — by threading the already-present `members` prop from `KanbanBoard` → `KanbanColumnView` → `KanbanCard` → `CellRenderer`.

**Non-goals (YAGNI).**

- No avatars/chips on the card — keep the existing plain-text summary treatment; only the text content changes from a count to names. (Avatars are a separate visual change; out of scope.)
- No editing of people cells on the card — the card summary stays read-only (`CellRenderer`, not the editor).
- No change to `PeopleCell`, `CellRenderer`, `memberLabel`, or the count-fallback semantics — they are already correct and shared; we only feed them `members`.
- No change to `BoardViews` or any data fetch — `members` already reaches `KanbanBoard`.
- No change to other views (Calendar/Gantt) — out of scope for this gap; can be a follow-up if they show the same count-only behavior.

---

## Design

Single, mechanical change: thread the existing `members` prop down the two intermediate layers to the leaf renderer.

1. **`KanbanBoard`** already has `members` (default `[]`). Remove/replace the stale "count-only … not needed here yet" doc-comment (L98–101) and pass `members` into each `KanbanColumnView` (the `kanbanColumns.map` at L246–257).
2. **`KanbanColumnView`** gains a `members: EditorMember[]` prop and forwards it to each `KanbanCard` (L347–352).
3. **`KanbanCard`** gains a `members: EditorMember[]` prop and forwards it to `CellRenderer` (L417–423) as `members={members}`.

`PeopleCell` then takes its existing non-empty-directory branch and renders names. Date cells are unaffected (`CellRenderer` ignores `members` for non-people kinds).

**Type.** Reuse `EditorMember` (already imported in `KanbanBoard.tsx` L40). Make the new intermediate props **required** (`members: EditorMember[]`, not optional) — the parent always has a concrete array (defaulted to `[]` at the `KanbanBoard` boundary), so requiring it internally is the stricter, clearer contract and avoids accidental `undefined` paths. The public `KanbanBoard` prop keeps its `members?: EditorMember[] = []` default for parity with the route's call shape.

**Behavior preserved by construction.** Because the only change is supplying `members`, the `members.length === 0` count-fallback is automatically retained for any caller (or test) that passes `[]` — no regression to "Unknown" rows. With a populated directory, the card shows `"Ada Lovelace, Grace Hopper"` exactly like the table.

### Data flow

```
BoardViews (members loaded server-side, already a prop)
  └─ KanbanBoard(members)                     [already receives — no upstream change]
       └─ KanbanColumnView(members)           [NEW prop, forward]
            └─ KanbanCard(members)            [NEW prop, forward]
                 └─ CellRenderer(members)     [existing param — now fed]
                      └─ PeopleCell(members)  [existing branch — now resolves names]
```

---

## Performance & data-fetching budget (AGENTS.md #5)

- **First paint:** unchanged. `members` is already fetched server-side and already passed to `KanbanBoard`; we add no query, no `select`, no Server Action.
- **Per interaction:** **0 new server round-trips.** Dragging a card, quick-add, and re-render on realtime/optimistic cache patches all run on the already-loaded `members` array (a prop, not a fetch). Resolution is an in-memory `Map` lookup inside `PeopleCell` (built per render from `members`), O(assignees) per card.
- **Server data vs. client state:** this changes **rendered output only**, no server data — so it is correctly client-side prop threading, not a Server Action / revalidation. (Matches the in-page-state invariant.)
- **Bounded hot path:** the Kanban card list is already virtualized via `useVirtualizer` (`KanbanColumnView`, L294–299), so only visible cards call `PeopleCell`. Threading a prop does not change that bound. The `members` array is org-membership-sized (small, bounded), already in memory.

Net: this is the cheapest possible fix — a prop reaches one layer deeper.

---

## Testing (mandatory — AGENTS.md #4)

Add to `src/components/boards/KanbanBoard.test.tsx` (the existing suite already renders the Kanban with a status group; current `renderKanban` passes `members={[]}` at L120 and the fixture at L76–110 has no people column — extend the fixture/helper to add a people column + a populated directory). Tests must prove **both** branches:

1. **Names render with a directory.** Add a `people` column to the fixture and a people cell value (`{ userIds: ["u1", "u2"] }`) on a visible card; render `KanbanBoard` with `members=[{ userId: "u1", fullName: "Ada Lovelace", … }, { userId: "u2", fullName: null, email: "grace@x.com", … }]`. Assert the card shows `"Ada Lovelace, grace@x.com"` (proves name resolution + email fallback reach the card, and that `members` is threaded all the way down).
2. **Count-fallback with empty directory (no regression).** Same fixture/people cell, but render with `members={[]}`. Assert the card shows `"2 people"` (and crucially **not** `"Unknown"`), proving the `members.length === 0` fallback still holds through the new threading.
3. **Singular grammar (cheap edge).** One assignee + empty directory → `"1 person"` (guards the singular/plural branch end-to-end on the card). Optional if covered indirectly, but cheap.

These are component-render assertions (Testing Library), the same style as the existing Kanban tests. `PeopleCell`'s own unit logic is already covered for the table in `cells.test.tsx`; the new tests specifically prove the **threading through `KanbanCard`** that this change introduces. No new test file.

Gates that must pass before merge: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

---

## Edge cases & decisions

- **No people column on a board** → `summaryColumns` has no people entry; nothing to resolve; behavior unchanged. Covered by existing tests not breaking.
- **Empty people cell** (`userIds: []` or null) → `PeopleCell` returns blank `<span>` (L82) regardless of `members`. Unchanged.
- **Assignee id not in directory** (stale membership) → `memberLabel(undefined)` → `"Unknown"` (L70). Identical to the table's behavior; acceptable and consistent. The `members.length === 0` guard only suppresses the all-Unknown row when the **whole** directory is absent, not per-id misses — matching the table exactly.
- **Mirrored people cells / contexts with no directory** → caller passes `members=[]` → count-fallback. Preserved.
- **Truncation/overflow** → the card summary uses the existing `truncate`/`flex-wrap` container (L411); long name lists wrap/truncate as today. No layout redesign in scope.
- **Stale doc-comment** at `KanbanBoard.tsx` L98–101 must be updated — it currently asserts the opposite of the new behavior and would mislead future readers.

---

## Execution DAG (AGENTS.md #6)

This is a **single, indivisible task** — one component file (`KanbanBoard.tsx`) plus its colocated test file, no shared-state subsystems, no independent units to parallelize.

- **Tasks:** `T1` — thread `members` through `KanbanColumnView` → `KanbanCard` → `CellRenderer` and add the two/three render tests.
- **Dependency graph:** none (single node).
- **Parallel batches:** Batch 1 = { T1 }. No concurrency available or warranted.
- **Critical path:** T1 (the whole task). Wall-clock floor = one small TDD cycle.

Explicitly: **no parallel dispatch** — dispatching subagents here would add coordination cost for zero wall-clock gain.

---

## Open questions

None are blocking. Defaults chosen to match the existing people-cell implementation:

1. **Avatars on the card?** Assumed **no** — plain-text names only, matching the table cell's text rendering and the card's current text-summary treatment. (If avatar chips are wanted later, that's a separate visual spec.)
2. **Calendar/Gantt views** also pass `members` and may show the same count-only behavior. **Out of scope** here (the named gap is the Kanban card); flagged as a possible identical follow-up, not part of this task.
3. **Per-id "Unknown" suppression** (when the directory is present but an individual id is missing) is intentionally **left as-is** to stay byte-for-byte consistent with the table. No change requested.
