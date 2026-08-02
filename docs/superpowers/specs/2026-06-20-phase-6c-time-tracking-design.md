---
type: spec
status: approved
date: 2026-06-20
phase: 6
slice: 6c
tags: [spec, phase/6, boards, columns, time-tracking]
related:
  - "[[00-north-star]]"
  - "[[2026-06-19-phase-6b-custom-fields-statuses-design]]"
  - "[[2026-06-19-phase-6a-subitems-design]]"
  - "[[2026-06-17-phase-2c-column-management-design]]"
---

# Phase 6 / Slice C — Time Tracking

> Phase 6 ("ClickUp depth") is five independent sub-projects: A subitems, B custom
> fields/statuses, **C time tracking**, D relations + mirror, E docs. Each gets its own spec → plan →
> build. This spec covers **only Slice C**. Relations/mirror and docs stay out of scope here.

## 1. Goal & scope

Add a **Time Tracking column kind** (Monday-style): a board column whose cell shows an item's total
tracked time against an optional estimate, with a live start/stop timer and manual time logging.

The column follows the established Monolith pattern: a new value in the `column_kind` enum + the
discriminated-union / per-kind switch (exactly how 6b added its kinds). Its **session data lives in a
new `time_entries` side table** (the same "derive cell content from a side table" pattern 6b's Files
column uses for `attachments`), while a small per-item **estimate** rides in the column's
`cell_values` row.

### Decisions (locked during brainstorming)

| Decision              | Choice                                                                                      | Rationale                                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Attach model          | **Time Tracking column kind** (Monday-style), not a global per-item feature                 | Consistent with Monolith's column architecture and 6a/6b; a global timesheet subsystem is Phase-7-scale and deferred.                 |
| Session storage       | **New `time_entries` side table**, cell content derived per `(item_id, column_id)`          | Sessions are 1-item-to-many, richer than a scalar — same precedent as 6b's Files column deriving from `attachments`.                  |
| Estimate storage      | **The column's `cell_values` row** `{ estimateSeconds?: number }` (per item, optional)      | The estimate _is_ a per-(item, column) scalar → it belongs in `cell_values`; the tracked total is always derived from `time_entries`. |
| Capabilities (v1)     | **Live start/stop timer + manual entry (add / edit / delete)**                              | The two capabilities chosen during brainstorming. Per-person grouped breakdown and per-entry notes deferred.                          |
| Timer concurrency     | **One running timer per user**, starting a new one auto-stops the previous (logs its entry) | Matches ClickUp; prevents double-counting. Enforced by a partial unique index + an atomic `start_timer` RPC.                          |
| Session list UI       | **Flat chronological list** (date · duration · who), not grouped by person                  | Entries still record `user_id` for attribution + "your timer", but v1 renders a flat list — grouped-by-person rollup is YAGNI now.    |
| Estimate vs. tracked  | **In scope** — cell shows `tracked / estimate`                                              | Chosen during brainstorming. Lives in `cell_values`; no new estimate subsystem.                                                       |
| Parent rollup         | **In scope** — a collapsed parent sums its subitems' tracked totals (+ estimates)           | Reuses 6a's exhaustive `rollupCell` switch; low cost, high consistency.                                                               |
| Cross-board timesheet | **Deferred**                                                                                | A cross-board per-person/per-week report is a Phase-7/8-scale reporting subsystem; 6c is the column only.                             |
| Realtime              | **Optimistic patch + revalidate** (no live cross-client session sync in v1)                 | Mirrors the 6b/attachments decision; `time_entries` realtime publication is a noted follow-up.                                        |

### Out of scope (deferred — YAGNI)

- **Cross-board timesheet / reporting view** (per-person, per-week aggregation across boards).
- **Per-person grouped breakdown** in the cell (flat session list only; entries still carry `user_id`).
- **Per-entry notes** (free-text on a session).
- **Editing/deleting other users' entries** (v1: own entries only; org-admin override deferred).
- **Live cross-client session sync** via the realtime publication (optimistic + revalidate in v1).
- **Billable/rate, tags/labels on time, idle detection, Pomodoro, per-column estimate defaults.**
- Non-Table view participation beyond a read-only cell (no group-by / date mapping).

## 2. Data model

### 2.1 `time_tracking` column kind

- **Migration** extends the DB enum: `alter type public.column_kind add value 'time_tracking';`
  (Postgres requires the `ADD VALUE` to commit before use — keep it in a clean enum-only step ahead of
  any statement that uses it; the plan validates ordering against Postgres docs). Then `pnpm db:types`
  regen + commit.
- **`COLUMN_KIND_META`** + `COLUMN_KIND_ORDER` (`src/lib/boards/column-kinds.ts`) gain a
  `time_tracking` entry (`label: "Time tracking"`, a clock `Icon`, `hasOptions: false`) so it appears
  in `AddColumnMenu` automatically.
- **`defaultColumn`** (`src/lib/boards/column-defaults.ts`): a `time_tracking` case returning `{}`
  settings (no per-column settings in v1).

### 2.2 `time_entries` table

New table (mirrors the `attachments` org-scoped, parent-consistent RLS shape):

```sql
create table public.time_entries (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs (id)    on delete cascade,
  board_id      uuid not null references public.boards (id)  on delete cascade,
  item_id       uuid not null references public.items (id)   on delete cascade,
  column_id     uuid not null references public.columns (id) on delete cascade,
  user_id       uuid not null references auth.users (id),
  started_at    timestamptz not null,
  ended_at      timestamptz,                       -- NULL ⇒ running timer
  duration_secs integer,                           -- set on stop / for manual entries; NULL while running
  created_at    timestamptz not null default now()
);

-- one running timer per user, ever
create unique index time_entries_one_running_per_user
  on public.time_entries (user_id) where ended_at is null;

-- cell-content derivation + board-payload query
create index time_entries_item_column_idx on public.time_entries (item_id, column_id);
create index time_entries_board_idx       on public.time_entries (board_id);
```

- **`duration_secs`** is stored (not generated) so manual entries can set an explicit duration
  independent of `started_at`/`ended_at`, and so a stopped timer records `ended_at - started_at`.
  Invariant (enforced in actions/RPC, asserted in tests): a completed entry has `ended_at` and
  `duration_secs` both set; a running entry has both `NULL`.
- **Storage of tracked total** is derived, never denormalized onto the item.

### 2.3 RLS

- Default-deny. `SELECT`/`INSERT`/`UPDATE`/`DELETE` gated on `is_org_member(org_id)` (same helper the
  rest of the schema uses).
- **Insert** additionally validates (server-side, in the action/RPC) that `column_id` belongs to
  `item_id`'s board and is a `time_tracking` column, and that `org_id`/`board_id` are consistent with
  the item — mirroring the attachments parent-consistency guard.
- **Update/Delete**: own rows only — policy predicate `user_id = auth.uid()` (in addition to org
  membership). Org-admin override is deferred.

## 3. Server layer

### 3.1 Actions (`src/lib/boards/actions.ts` or a new `time-actions.ts`)

All are Server Actions, validate at the boundary with Zod (`src/lib/validations/board-actions.ts`),
resolve the column via RLS to derive `org_id`/`board_id`, and return the data needed for an optimistic
cache patch.

- **`startTimer(itemId, columnId)`** → calls the **`start_timer` RPC** (below). Returns the new
  running entry **and** any auto-stopped entry (so the cache can patch the previously-running item's
  cell too).
- **`stopTimer(entryId)`** — sets `ended_at = now()`, `duration_secs = now() - started_at` on the
  caller's running entry. Idempotent if already stopped.
- **`addManualEntry(itemId, columnId, { startedAt, durationSecs })`** — inserts a completed entry
  (`ended_at = started_at + durationSecs`). `startedAt` defaults to "today" in the UI.
- **`editEntry(entryId, { startedAt?, durationSecs? })`** — own entries only; recomputes `ended_at`.
- **`deleteEntry(entryId)`** — own entries only.
- **`setEstimate(itemId, columnId, estimateSecs | null)`** — routes through the existing
  `setCell` / `clearCellValue` path writing `{ estimateSeconds }` (no new cell action).

### 3.2 `start_timer` RPC (`SECURITY DEFINER`)

One transaction, so the auto-stop and the new start never drift and the partial-unique index is never
violated mid-statement:

1. Org-membership guard (caller `is_org_member` of the column's org); resolve/validate
   `org_id`/`board_id` from the item + assert `column_id` is a `time_tracking` column on that board.
2. **Stop** the caller's existing running entry, if any: `ended_at = now()`,
   `duration_secs = extract(epoch …)`.
3. **Insert** a new running entry (`started_at = now()`, `ended_at = NULL`).
4. Return the auto-stopped row (or null) + the new running row.

### 3.3 Duration parse/format helper

New pure module **`src/lib/boards/time-format.ts`**:

- `parseDuration(input: string): number | null` — `"1h 30m"`, `"90m"`, `"1.5h"`, `"45"` (→ minutes),
  `"2:30"` → seconds; invalid → `null`.
- `formatDuration(secs: number): string` — `secs → "2h 45m"` / `"4h"` / `"15m"` (drop zero parts).
- Fully unit-tested; the single source of truth for all time text in the cell.

## 4. UI — cell + popover (`src/components/boards/cells/`)

Follows the read-renderer (`cells/index.tsx`) + editable-cell pattern, and the Files-cell expand
precedent for the popover.

### 4.1 Collapsed cell

- Shows **`tracked / estimate`** — e.g. `2h 45m / 4h`; estimate omitted when unset → just `2h 45m`;
  fully empty → a faint **▶** only.
- Hover reveals a **▶ start / ■ stop** affordance for the current user.
- A **running** entry renders a **live-ticking** total (client `setInterval`, 0 round-trips) plus an
  "active" accent dot. The tick is pure client state derived from `started_at`.

### 4.2 Popover (click to expand)

- **Header:** total tracked; **estimate** inline-editable (uses `parseDuration`, writes via
  `setEstimate`); a **start/stop** button for the current user.
- **Session list:** flat chronological — each row `date · duration · who logged it`. The user's own
  rows expose edit / delete; a running entry renders live at the top.
- **"+ Add time":** a manual-entry row — duration input (`parseDuration`) + date picker (defaults
  today) → `addManualEntry`.
- Friendly inline error on an unparseable duration; no write on invalid input.

### 4.3 Rollup (6a exhaustive `rollupCell` switch, `src/lib/boards/rollup.ts`)

- A collapsed **parent**'s time cell = `Σ` of its subitems' tracked totals (`formatDuration`), with the
  estimate rollup = `Σ` subitem estimates (blank if none). The exhaustive switch forces the new case.

### 4.4 Other views

Kanban / Calendar / Timeline: the time-tracking cell renders **read-only** where those views show cell
content; it is **not** a group-by / date / people source. Any exhaustive kind switch in those view
modules gets a read-only case (compiler-driven).

## 5. Data loading & cache (perf budget — working-agreement §5)

- **(a) First paint vs interaction:** `getBoardPayload` gains **one bounded query** —
  `time_entries WHERE board_id = X` (indexed by `time_entries_board_idx`) — returned alongside
  cells/attachments. Time cells render the tracked total on **first paint with 0 per-cell
  round-trips**; the estimate rides in the already-batched `cell_values`. The running-timer tick is
  pure client state.
- **(b) Server-data changes:** start / stop / add / edit / delete / setEstimate are all **Server
  Actions + optimistic cache patch (+ `revalidatePath`)** — never RSC navigation.
- **(c) Bounded over indexed:** the board-scoped `time_entries` read is bounded per board and indexed;
  per-cell derivation keys on `(item_id, column_id)`; the estimate stays on the `(item_id, column_id)`
  cell PK.
- **Realtime:** v1 relies on optimistic local patch + revalidate (like attachments) — no live
  cross-client session sync. A follow-up can add `time_entries` to the realtime publication (noted,
  not in scope).

## 6. Testing (mandatory — written and run)

**Pure unit**

- `time-format`: `parseDuration` / `formatDuration` round-trips incl. invalid input, `"90m"`,
  `"1.5h"`, `"2:30"`, zero-part dropping.
- Tracked-total derivation over a set of entries (completed + one running ⇒ live tick).
- `rollupCell` `time_tracking` case: parent sums subitem totals + estimates.

**DB integration** (`*.integration.test.ts`, skips without `SUPABASE_SERVICE_ROLE_KEY`)

- `start_timer` RPC: atomically auto-stops the caller's prior running entry and inserts the new one;
  the partial-unique index never lets two open entries coexist.
- `time_entries` org-scoped: no cross-org read or write; insert validates `column_id` belongs to the
  item's board and is `time_tracking`.
- Update/delete restricted to the owning `user_id`.
- Invariant: completed entry ⇒ `ended_at` + `duration_secs` set; running ⇒ both NULL.

**Component**

- Collapsed cell renders `tracked / estimate` (and tracked-only when estimate unset).
- Start → stop creates an entry and updates the total; running entry live-ticks.
- Add manual entry; edit/delete own entry; estimate inline edit persists.

**e2e**

- Add a Time Tracking column → start timer → stop → see the logged session + updated total.
- Add manual time for a date; set an estimate → reload persists `tracked / estimate`.

**Gate** (working agreement): `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all green;
`get_advisors` clean after the migrations (enum extension + `time_entries`); `pnpm db:types`
regenerated + committed.

## 7. Execution DAG (working-agreement §6)

**Independent units**

- **U1 — DB + types:** `column_kind += 'time_tracking'`; `time_entries` table + RLS + indexes +
  partial-unique; `start_timer` RPC; `pnpm db:types` regen. _(foundation)_
- **U2 — Validation + scaffold:** Zod `time_tracking` cell value `{ estimateSeconds? }` + empty
  settings; `COLUMN_KIND_META` / `COLUMN_KIND_ORDER` entry; `defaultColumn` case; `time-format.ts`
  (pure). _(needs U1's enum for the type union)_
- **U3 — Server actions:** `startTimer` / `stopTimer` / `addManualEntry` / `editEntry` / `deleteEntry`
  / `setEstimate` + action-layer Zod. _(needs U1, U2)_
- **U4 — Payload + derivation:** board-scoped `time_entries` query into `getBoardPayload`; tracked-total
  - live-tick derivation helper keyed on `(item_id, column_id)`. _(needs U1, U2)_
- **U5 — Cell UI + popover:** renderer/editor (`cells/index.tsx`) + expand popover (session list,
  estimate inline edit, start/stop, manual add) + live tick. _(needs U3, U4)_
- **U6 — Rollup + view wiring:** `rollup.ts` `time_tracking` case; non-Table read-only cases;
  `AddColumnMenu` (auto via `COLUMN_KIND_META`). _(needs U2, U5)_

**Rough batches:** **[U1]** → **[U2]** → **[U3, U4]** → **[U5]** → **[U6]**. Critical path
≈ U1 → U2 → U4 → U5 → U6. The plan produces the full graph, parallel batches, and critical path.

**Hot-file serialization:** `cells/index.tsx`, `validations/boards.ts`, `rollup.ts`,
`column-defaults.ts`, `column-kinds.ts`, and `getBoardPayload` are touched by multiple units → the
plan sequences those edits or uses **git worktrees** so parallel agents don't clobber the shared
`develop` checkout (working-agreement #1).

## 8. Risks & notes

- **Postgres enum extension rules:** `ALTER TYPE … ADD VALUE` cannot be used in the same transaction
  that references the new value, and the value isn't usable until committed. Keep the enum addition in
  a clean migration step; the plan validates ordering before applying to cloud.
- **Partial-unique vs. auto-stop race:** stop-then-insert must be one transaction inside `start_timer`
  (`SECURITY DEFINER`), or a concurrent start could transiently violate
  `time_entries_one_running_per_user`. The RPC owns this atomicity; integration test asserts it.
- **Running-entry duration is derived, not stored** until stop — the live tick is client-only; the
  authoritative `duration_secs` is written on stop. Tests assert running ⇒ `duration_secs IS NULL`.
- **Blast radius:** `getBoardPayload` and the shared cell/validation/rollup files are touched by
  concurrent sessions — verify own scope before claiming green ([[develop-red-concurrent-work]]);
  worktree-isolate parallel batches.
- **Realtime deferred:** v1 is optimistic-patch + revalidate; another user's logged time appears on
  next load/revalidate, not instantly. Acceptable for v1; publication add is a noted follow-up.
- **Estimate is per-item, not per-column:** stored in `cell_values`; there is no column-level default
  estimate in v1 (YAGNI).
  </content>
  </invoke>
