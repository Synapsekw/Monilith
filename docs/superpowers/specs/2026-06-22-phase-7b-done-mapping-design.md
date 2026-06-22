# Phase 7b follow-up — per-option "done" mapping for goal board-links

**Date:** 2026-06-22
**Status:** Design (ready for plan)
**Scope:** UI-only. One component file. No schema, no RPC, no data-layer change.

## Problem

Goals in `auto_boards` progress mode auto-track completion as the percentage of "done" items
across their linked boards. Linking a board today is **coarse**: in
`src/components/goals/GoalDetailDrawer.tsx`, the `onAddBoard` flow auto-picks the board's first
status column and marks options "done" purely by **name-matching** (`DONE_HINTS = ["done",
"complete", "closed", "shipped"]`). After that initial guess, the user **cannot revisit or
correct** which status options count as done — the only controls are "add board" (with the
name-guess) and "remove board". A board whose done status is called "Live" or "Approved", or a
board with multiple status columns, gets the wrong mapping with no recourse.

## The data layer already supports this fully (verified in code)

This is the load-bearing confirmation: **per-option done mapping is already a first-class part
of the persisted model.** No schema or RPC work is needed.

| Layer                 | Evidence                                                                                                                                                                                            |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Link model            | `GoalLink` in `src/lib/goals/queries.ts:54-58` has `doneColumnId: string \| null` **and** `doneOptionIds: string[]`.                                                                                |
| Read                  | `getGoalLinks()` (`queries.ts:61-77`) selects `done_column_id, done_option_ids` from `goal_links` and returns them per goal.                                                                        |
| Write (Server Action) | `setGoalLinks()` (`src/lib/goals/actions.ts:111-130`) maps each link to `{ board_id, done_column_id, done_option_ids }` and persists via the `set_goal_links` RPC, then `revalidatePath("/goals")`. |
| Validation            | `setGoalLinksSchema` (`src/lib/validations/goals.ts:52-63`) already validates `doneColumnId: uuid.nullable()` and `doneOptionIds: z.array(uuid)`.                                                   |
| Status options source | `getStatusColumnsForBoard()` (action wrapper `actions.ts:132-139` → `src/lib/portfolios/queries.ts:87-101`) returns `StatusColumn[] = { id, name, options: { id, label, color }[] }`.               |
| Rollup                | `goals_rollup()` (consumed in `queries.ts:99`) already computes `done` off the stored mapping.                                                                                                      |

**Conclusion: the gap is purely the editing UI.** The drawer writes a name-guessed
`doneOptionIds` once on add and never exposes it for editing.

There is a proven donor for exactly this UX already in the repo:
**`src/components/portfolios/AddBoardDialog.tsx`** maps a board's done options with a status-column
`<select>` + a per-option checkbox list (swatch via `style={{ backgroundColor: o.color }}` +
label), with a `DONE_RE` default and a `toggleOption` helper. The goal drawer should reuse this
exact interaction pattern.

## Goal

In the goal detail drawer, for an `auto_boards` goal, let the user **edit per-linked-board which
status column and which of its options count as "done"** — not just add/remove the board. The
initial name-guess on add stays as a sensible default; the user can now override it.

## Approaches considered

**A. Inline expandable mapping per linked board (recommended).**
Each linked board in the "Contributing boards" list becomes expandable. Expanding reveals the
status-column `<select>` + the per-option "done" checkbox list (the `AddBoardDialog` body,
factored into a shared presentational component). Editing a checkbox / column calls the existing
`setGoalLinks` Server Action with the full updated links array.
_Pros:_ lowest surface area, mapping lives next to the board it configures, one reusable picker
component shared with portfolios, matches the drawer's existing inline-edit idiom (everything
else in `GoalEditor` edits in place). _Cons:_ the list row grows when expanded — acceptable in a
scrollable drawer.

**B. Per-board "edit mapping" popover** (mirror of `EditPlacementPopover`).
A `⋯` button on each linked board opens a Popover containing the column + options picker.
_Pros:_ keeps the list compact; visually consistent with portfolios' placement editor. _Cons:_ a
Popover inside a Radix Sheet adds a focus-trap/portal nesting wrinkle to test; mapping is hidden
behind an extra click; slightly more chrome.

**C. Full "link board" dialog reused on edit.**
Open the `AddBoardDialog`-style dialog both for add and for edit (pre-filled).
_Pros:_ literally one component for add+edit. _Cons:_ a modal dialog launched from within a
drawer is heavy; the add flow today is a lightweight inline `<select>` + button, and replacing it
with a modal is a bigger UX change than the brief asks for.

**Recommendation: A.** It is the smallest, most consistent change, keeps the existing
lightweight "add a board" affordance, and the only genuinely new UI is an expand/collapse plus
the reused picker body. It also satisfies the performance budget cleanly (see below).

## Design (Approach A)

### Component decomposition

1. **`DoneMappingFields` (new, presentational, client) — `src/components/goals/DoneMappingFields.tsx`.**
   Extracted from the body of `AddBoardDialog`. Pure controlled component, no Server Action calls,
   no data fetching — it just renders and reports changes:
   - **Props:** `columns: StatusColumn[]`, `loading: boolean`, `doneColumnId: string | null`,
     `doneOptionIds: string[]`, `onColumnChange(columnId: string | null): void`,
     `onToggleOption(optionId: string): void`, plus an `idPrefix: string` so multiple instances
     have unique `id`/`htmlFor`/`legend` associations.
   - **Renders:** the "Completion status" column `<select>` (with `"No mapping (progress n/a)"`
     option), and when a column is active, a `<fieldset>`/`<legend>` "Statuses that count as
     done" with one `<label><input type="checkbox"> <swatch> {label}</label>` per option. Swatch =
     `<span aria-hidden className="size-2.5 rounded-full" style={{ backgroundColor: o.color }} />`.
   - **States handled:** loading, no status columns ("progress will show as n/a"), column with no
     options.
   - **Why extract:** the portfolio dialog and the goal drawer then share one tested picker; the
     swatch+label+checkbox markup and a11y associations live in exactly one place.
   - **Refactor `AddBoardDialog` to consume it** (no behavior change) so we don't fork the markup.

2. **`GoalEditor` (edit) — `src/components/goals/GoalDetailDrawer.tsx`.**
   The `auto_boards` branch (currently lines ~211-257) changes from a flat
   add/remove list to an **expandable list**:
   - Each linked board row keeps its name + remove (`X`) button, and gains an expand toggle
     (chevron `button`, `aria-expanded`, `aria-controls`). Expanded state is local
     `useState<string | null>` (the expanded boardId; at most one open at a time, or a `Set` —
     decide in plan; single-open is simpler and fine).
   - On expand, if that board's status columns aren't cached yet, fetch them **once** via the
     existing `getStatusColumnsForBoard` action and cache in a
     `Record<boardId, StatusColumn[]>` client state. Subsequent expands of the same board are
     instant (no refetch).
   - The expanded body renders `<DoneMappingFields>` wired to **the live link** (`doneColumnId`,
     `doneOptionIds` from `links[i]`).
   - **Column change** → build the next links array with that board's `doneColumnId` updated and
     `doneOptionIds` reset to the column's name-guess default (reuse `DONE_HINTS`/`DONE_RE`
     semantics; consolidate to one shared regex/helper) → call `setGoalLinks`.
   - **Option toggle** → build the next links array with that option added/removed from the
     board's `doneOptionIds` → call `setGoalLinks`.
   - The existing `saveLinks(next)` + `router.refresh()` path is reused verbatim for both.
   - The "add a board" `<select>` + Add button and the name-guess default on add stay exactly as
     today (the guess is now just the _initial_ value the user can edit).

### Data flow

```
/goals page (RSC, unchanged)
  └─ getGoalLinks() → links incl. doneColumnId + doneOptionIds  ──► GoalDetailDrawer (props)
       └─ GoalEditor (auto_boards)
            • expand board ─(first time only)→ getStatusColumnsForBoard(boardId)  [Server Action read]
                 └─ cached in component state: Record<boardId, StatusColumn[]>
            • column change / option toggle → setGoalLinks({ goalId, links })  [Server Action write]
                 └─ revalidatePath("/goals") + router.refresh()  → fresh links flow back as props
```

### Performance & data-fetching budget (AGENTS.md #5)

- **First paint of the drawer:** 0 new server round-trips. Links (incl. `doneColumnId` +
  `doneOptionIds`) are already loaded by the page's `getGoalLinks()` and passed as props. The
  drawer renders entirely from props.
- **Expand a board's mapping:** at most **one** read round-trip (`getStatusColumnsForBoard`),
  and only the first time that board is expanded in the session — results are cached in component
  state, so re-expanding is **0** round-trips. (This matches the existing `onAddBoard` cost; we
  add caching so editing doesn't refetch.) Note this is a _board metadata_ read, not the goals
  list — it does not re-run the page's heavy `goals_rollup`.
- **Edit (column change / option toggle):** this changes **server data** → it must be a Server
  Action (`setGoalLinks`, existing) with targeted revalidation (`revalidatePath("/goals")`,
  existing) + `router.refresh()`. This is correct per AGENTS.md: server-data change ⇒ Server
  Action, not History API.
- **Bounded reads:** `getStatusColumnsForBoard` reads one board's status columns (already bounded
  by `board_id` + `kind = "status"`, indexed). `getGoalLinks` is the existing page read,
  unchanged. No new unbounded `select *`.

### Validation, security, RLS

- No new boundary. `setGoalLinksSchema` already validates `doneColumnId` (nullable uuid) and
  `doneOptionIds` (array of uuid). Option ids are board-defined strings; they already pass as
  uuids today via the add flow.
- RLS unchanged: `set_goal_links` / `getStatusColumnsForBoard` / `goal_links` reads remain
  org-scoped server-side; the client never gains new authority.
- `SUPABASE_SERVICE_ROLE_KEY` not involved; all calls go through the standard server client.

### Design / UI conventions (pulse-ui + frontend-design, applied at build time)

- Semantic tokens only — reuse the donor's `SELECT_CLASS`, `bg-accent/40` hover, `bg-muted/40`
  row, `text-muted-foreground` hints. Status swatch is the **one** place color is allowed and it
  comes from the option's own `color` (status palette), paired with the text label (AA + not
  color-only). The chevron/expand control is a ghost icon button (`size-3.5`/`size-4`, lucide
  `ChevronDown`/`ChevronRight`), monochrome chrome — never branded.
- a11y: expand toggle has `aria-expanded` + `aria-controls`; the options fieldset has a `<legend>`;
  checkboxes are real `<input type="checkbox">` inside `<label>`; icon-only remove keeps its
  existing `aria-label`. `idPrefix` keeps every `id`/`htmlFor` unique across multiple boards.
- Reduced motion respected globally; expand can be a simple show/hide or a subtle height/opacity
  transition (≤200ms) — not required.

### Error handling

- `getStatusColumnsForBoard` failure on expand: show the donor's inline `text-destructive` hint
  ("Couldn't load statuses") and leave the row collapsible; do not throw.
- `setGoalLinks` failure: keep current behavior (no `router.refresh()` on `!res.ok`); optionally
  surface a small inline error. Decide granularity in plan; minimum bar = no silent data loss
  (the props re-flow on refresh is the source of truth, so a failed save simply leaves the prior
  mapping shown after the next render).

## Out of scope (YAGNI)

- No multi-column "done" (a link maps exactly one status column, as today).
- No bulk "apply this mapping to all boards".
- No change to the add-board affordance or the name-guess defaulting.
- No schema/RPC/migration, no `database.types.ts` regen.
- No portfolio behavior change (the `AddBoardDialog` refactor is mechanical extraction only).

## Independent units (for the plan's DAG)

- **Unit 1 — `DoneMappingFields` extraction + `AddBoardDialog` refactor** (shared picker, no
  behavior change to portfolios). _Produces_ the presentational component the goal drawer
  consumes.
- **Unit 2 — goal drawer wiring** (expandable list, per-board column cache, edit → `setGoalLinks`).
  _Consumes_ Unit 1.

Unit 2 depends on Unit 1's component interface, so they are sequential, not parallel (see plan).

## Acceptance

1. Opening an `auto_boards` goal with linked boards shows each board expandable; expanding shows
   the current done-column + checked done-options reflecting persisted `doneOptionIds`.
2. Unchecking/checking an option, or changing the column, persists via `setGoalLinks` and the
   change survives a reload (round-trips through `getGoalLinks`).
3. Re-expanding a board already expanded this session does **not** refetch its columns.
4. Portfolio `AddBoardDialog` behavior is unchanged.
5. `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all pass; the picker and the drawer
   edit flow have tests.
