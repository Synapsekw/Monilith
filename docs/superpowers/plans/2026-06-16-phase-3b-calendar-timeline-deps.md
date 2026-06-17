# Phase 3b — Calendar + Timeline/Gantt + Dependencies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Calendar and Timeline/Gantt board views plus a first-class finish-to-start item-dependency model (with cycle prevention and a visual violation flag), all on the existing board cache + realtime + view-switcher infrastructure.

**Architecture:** A new `item_dependencies` table (cycle-safe via a SECURITY DEFINER RPC) + two new `view_kind` values. Dependencies join the `["board", boardId]` payload/cache/realtime exactly like cells/items. Both views are driven by a single Date column's `{ date, end? }` value via pure builder functions (`calendar.ts`, `gantt.ts`) and pure drag handlers, so the logic is unit-tested without driving real dnd-kit drags. Built as three ordered units: Calendar → dependencies data layer → Gantt.

**Tech Stack:** Next.js 16 (App Router, RSC), React 19, Supabase (Postgres + RLS + RPC), TanStack Query, dnd-kit (installed), Zod, Vitest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-06-16-phase-3b-calendar-timeline-deps-design.md`

**Workflow:** Build on **`develop`** (two-branch model — no feature branch). Commit with conventional messages; **subjects must start lowercase** (commitlint `subject-case` rejects leading upper/Pascal — see `vault/decisions/2026-06-15-gotcha-06-commitlint-subject-case.md`). Stage only your task's files by explicit path.

**Conventions:**

- Next.js 16 — confirm App-Router APIs against `node_modules/next/dist/docs/` before use.
- RLS / RPC / action shapes mirror Phase 2/3a exactly — read `supabase/migrations/20260615155909_board_views.sql`, `src/lib/boards/view-actions.ts`, `src/lib/boards/actions.ts`.
- Date cell value shape: `{ date: string; end?: string }` (`dateValueSchema` in `src/lib/validations/boards.ts`).
- View-component pattern (cache hydration + dnd-kit + pure handlers + `BoardHeader`): read `src/components/boards/KanbanBoard.tsx`.
- UI tasks: load the `pulse-ui` + `frontend-design` skills first.

---

## File Structure

**Create:**

- `supabase/migrations/<ts>_dependencies_and_views.sql`
- `src/lib/boards/dates.ts` + `.test.ts` — `resolveDateColumn`, `itemDateRange`.
- `src/lib/boards/calendar.ts` + `.test.ts` — `buildCalendarMonth`, `onEventDropped`.
- `src/lib/boards/gantt.ts` + `.test.ts` — `buildGanttRows`, `detectViolations`, `onBarMoved`, `onBarResized`.
- `src/lib/validations/dependency-actions.ts`
- `src/lib/boards/dependency-actions.ts` + `.test.ts`
- `src/components/boards/CalendarBoard.tsx` + `.test.tsx`
- `src/components/boards/GanttBoard.tsx` + `.test.tsx`
- `e2e/calendar-timeline.spec.ts`

**Modify:**

- `src/lib/boards/queries.ts` — `ItemDependency` type + `dependencies` in payload.
- `src/lib/boards/cache.ts` — `addDependency`/`removeDependency`; `BoardCache.dependencies`.
- `src/lib/boards/use-board-realtime.ts` — 3rd subscription (`item_dependencies`).
- `src/lib/boards/use-board-mutations.ts` — `addDependency`/`removeDependency`.
- `src/lib/validations/view-actions.ts` — extend `viewKindSchema`; add `calendarConfigSchema`/`timelineConfigSchema`; per-kind `updateBoardView` config.
- `src/lib/boards/view-actions.ts` — `updateBoardView` validates config by the view's kind.
- `src/components/boards/ViewSwitcher.tsx` — add-view kind menu + calendar/timeline icons.
- `src/app/boards/[boardId]/page.tsx` — render `CalendarBoard`/`GanttBoard` branches.
- `src/types/database.types.ts` — regenerated (`pnpm db:types`).

---

## Task 1: Migration — enum values, `item_dependencies`, cycle-safe RPC

**Files:**

- Create: `supabase/migrations/<ts>_dependencies_and_views.sql`
- Modify (regenerate): `src/types/database.types.ts`

- [ ] **Step 1: Generate the migration file**

Run: `pnpm exec supabase migration new dependencies_and_views`

- [ ] **Step 2: Write the SQL**

```sql
-- Phase 3b: two more view kinds + the item_dependencies model (finish-to-start).
-- ALTER TYPE ADD VALUE is additive and must not be USED as a value later in the
-- same migration; the item_dependencies DDL below does not reference these values.
alter type public.view_kind add value if not exists 'calendar';
alter type public.view_kind add value if not exists 'timeline';

create table public.item_dependencies (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations (id) on delete cascade,
  board_id       uuid not null references public.boards (id) on delete cascade,
  predecessor_id uuid not null references public.items (id) on delete cascade,
  successor_id   uuid not null references public.items (id) on delete cascade,
  type           text not null default 'FS' check (type in ('FS')),
  created_at     timestamptz not null default now(),
  unique (predecessor_id, successor_id),
  check (predecessor_id <> successor_id)
);
create index item_dependencies_board_id_idx     on public.item_dependencies (board_id);
create index item_dependencies_org_id_idx        on public.item_dependencies (org_id);
create index item_dependencies_predecessor_idx   on public.item_dependencies (predecessor_id);
create index item_dependencies_successor_idx     on public.item_dependencies (successor_id);

alter table public.item_dependencies enable row level security;

create policy "item_dependencies: read if member" on public.item_dependencies
  for select using (public.is_org_member(org_id));
create policy "item_dependencies: insert if member" on public.item_dependencies
  for insert with check (
    public.is_org_member(org_id) and public.board_in_org(board_id, org_id)
  );
create policy "item_dependencies: delete if member" on public.item_dependencies
  for delete using (public.is_org_member(org_id));

-- RPC: create_item_dependency — same-board + self-link + cycle guards, then insert.
-- Cycle = successor can already reach predecessor through existing edges.
create or replace function public.create_item_dependency(
  p_predecessor uuid, p_successor uuid
) returns public.item_dependencies
language plpgsql security definer set search_path = '' as $$
declare
  v_uid       uuid := (select auth.uid());
  v_board_id  uuid;
  v_org_id    uuid;
  v_succ_board uuid;
  v_row       public.item_dependencies;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_predecessor = p_successor then
    raise exception 'an item cannot depend on itself' using errcode = 'P0001';
  end if;

  select board_id, org_id into v_board_id, v_org_id
  from public.items where id = p_predecessor;
  if v_board_id is null then
    raise exception 'predecessor not found' using errcode = 'P0002';
  end if;
  if not public.is_org_member(v_org_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;

  select board_id into v_succ_board from public.items where id = p_successor;
  if v_succ_board is null or v_succ_board <> v_board_id then
    raise exception 'items must be on the same board' using errcode = 'P0001';
  end if;

  -- Cycle check: does p_successor already reach p_predecessor?
  if exists (
    with recursive reach (node) as (
      select successor_id from public.item_dependencies where predecessor_id = p_successor
      union
      select d.successor_id
      from public.item_dependencies d
      join reach r on d.predecessor_id = r.node
    )
    select 1 from reach where node = p_predecessor
  ) then
    raise exception 'this would create a dependency cycle' using errcode = 'P0001';
  end if;

  insert into public.item_dependencies (org_id, board_id, predecessor_id, successor_id, type)
  values (v_org_id, v_board_id, p_predecessor, p_successor, 'FS')
  returning * into v_row;
  return v_row;
end; $$;

grant execute on function public.create_item_dependency(uuid, uuid) to authenticated;
```

- [ ] **Step 3: Apply** — Run: `pnpm exec supabase db push --linked`
      Expected: `Finished supabase db push.` (CLI is linked + authed; if it errors on auth, STOP and report BLOCKED — manual gate.)

- [ ] **Step 4: Regenerate types** — Run: `pnpm db:types`
      Verify: `grep -c item_dependencies src/types/database.types.ts` ≥ 1; `grep "create_item_dependency" src/types/database.types.ts` present; `view_kind` union now includes `calendar`/`timeline`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/ src/types/database.types.ts
git commit -m "feat(boards): item_dependencies table + cycle-safe rpc; calendar/timeline view kinds"
```

---

## Task 2: RLS integration tests for dependencies

**Files:** Modify `src/lib/boards/boards.rls.integration.test.ts`

- [ ] **Step 1: Add a `describe("item_dependencies RLS")` block** mirroring the file's existing harness (service-role `admin`, per-user `userA`/`userB` clients, two orgs, pre-provisioned `userA.boardId`). Create two items on `userA.boardId` (via the `create_item` RPC or direct insert as admin) for the dependency cases. Assert:
  1. Member can read own-org dependencies; cross-org read returns `[]`.
  2. Non-member insert (forged org/board) rejected by RLS.
  3. `create_item_dependency(a, b)` as member returns a row `{ type: "FS" }`.
  4. `create_item_dependency(a, a)` raises (self-link).
  5. After `create_item_dependency(a, b)`, `create_item_dependency(b, a)` raises (cycle).
  6. `create_item_dependency` with items from two different boards raises (same-board guard).

```ts
// sketch — adapt to the file's real helpers/names
describe("item_dependencies RLS", () => {
  it("create_item_dependency inserts FS and blocks cycles + self-links", async () => {
    const a = await createItemOn(userA, userA.boardId);
    const b = await createItemOn(userA, userA.boardId);
    const ok = await userA.anon.rpc("create_item_dependency", {
      p_predecessor: a,
      p_successor: b,
    });
    expect(ok.error).toBeNull();
    expect(ok.data).toMatchObject({ type: "FS" });

    const cycle = await userA.anon.rpc("create_item_dependency", {
      p_predecessor: b,
      p_successor: a,
    });
    expect(cycle.error).not.toBeNull();

    const self = await userA.anon.rpc("create_item_dependency", {
      p_predecessor: a,
      p_successor: a,
    });
    expect(self.error).not.toBeNull();
  });

  it("denies cross-org reads", async () => {
    const { data } = await userB.anon
      .from("item_dependencies")
      .select("*")
      .eq("board_id", userA.boardId);
    expect(data ?? []).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run** — `pnpm test src/lib/boards/boards.rls.integration.test.ts` → all green (schema already applied in Task 1).

- [ ] **Step 3: Commit**

```bash
git add src/lib/boards/boards.rls.integration.test.ts
git commit -m "test(boards): rls coverage for item_dependencies (cycle, self, cross-org, same-board)"
```

---

## Task 3: Data layer — payload, cache helpers, realtime

**Files:**

- Modify: `src/lib/boards/queries.ts`, `src/lib/boards/cache.ts`, `src/lib/boards/use-board-realtime.ts`
- Test: `src/lib/boards/cache.test.ts`

- [ ] **Step 1: queries.ts** — add `export type ItemDependency = Tables<"item_dependencies">;`, add `dependencies: ItemDependency[]` to `BoardPayload`, add a 6th entry to the `Promise.all` and destructure it:

```ts
      supabase
        .from("item_dependencies")
        .select("*")
        .eq("board_id", boardId)
        .order("created_at", { ascending: true }),
```

Destructure as `depsRes`; return `dependencies: depsRes.data ?? []`.

- [ ] **Step 2: cache.ts** — add `dependencies: CacheDependency[]` to the `BoardCache` type, the type alias, and two pure helpers:

```ts
export type CacheDependency = Tables<"item_dependencies">;

/** Append a dependency; idempotent on id. Immutable. */
export function addDependency(
  cache: BoardCache,
  dep: CacheDependency,
): BoardCache {
  if (cache.dependencies.some((d) => d.id === dep.id)) return cache;
  return { ...cache, dependencies: [...cache.dependencies, dep] };
}

/** Remove a dependency by id. No-op if absent. Immutable. */
export function removeDependency(cache: BoardCache, id: string): BoardCache {
  return {
    ...cache,
    dependencies: cache.dependencies.filter((d) => d.id !== id),
  };
}
```

(Add `dependencies: CacheDependency[];` to the `BoardCache` type.)

- [ ] **Step 3: cache.test.ts** — add tests: `addDependency` appends + is idempotent on id; `removeDependency` filters + is a no-op when absent. Run `pnpm test src/lib/boards/cache.test.ts` → green.

- [ ] **Step 4: use-board-realtime.ts** — import `addDependency`, `removeDependency`, `type CacheDependency`; add an `onDependency` handler and a 3rd `.on("postgres_changes", { event: "*", schema: "public", table: "item_dependencies", filter }, onDependency)` to the channel:

```ts
function onDependency(p: RealtimePostgresChangesPayload<CacheDependency>) {
  if (p.eventType === "DELETE") {
    const oldRow = p.old as Partial<CacheDependency>;
    if (oldRow.id) patch((prev) => removeDependency(prev, oldRow.id!));
    return;
  }
  const row = p.new as CacheDependency;
  patch((prev) => addDependency(prev, row)); // idempotent on id (echo-safe)
}
```

- [ ] **Step 5: typecheck + tests** — `pnpm typecheck && pnpm test src/lib/boards/cache.test.ts`. Note: making `dependencies` required on `BoardPayload`/`BoardCache` may break fixtures that cast `payload as unknown as BoardCache` (those tolerate extras) or build a `BoardPayload` literal. Fix any such fixtures by adding `dependencies: []`. Search: `rg "views: \[" src --type ts` and component test fixtures.

- [ ] **Step 6: Commit**

```bash
git add src/lib/boards/queries.ts src/lib/boards/cache.ts src/lib/boards/cache.test.ts src/lib/boards/use-board-realtime.ts
git commit -m "feat(boards): load item_dependencies into payload/cache + realtime reconcile"
```

---

## Task 4: Dependency validations + actions + mutations

**Files:**

- Create: `src/lib/validations/dependency-actions.ts`, `src/lib/boards/dependency-actions.ts`, `src/lib/boards/dependency-actions.test.ts`
- Modify: `src/lib/boards/use-board-mutations.ts`

- [ ] **Step 1: validations** (`src/lib/validations/dependency-actions.ts`):

```ts
import { z } from "zod";
const uuid = z.string().uuid();
export const createDependencySchema = z.object({
  predecessorId: uuid,
  successorId: uuid,
});
export const deleteDependencySchema = z.object({ dependencyId: uuid });
```

- [ ] **Step 2: action tests** (`src/lib/boards/dependency-actions.test.ts`) — mock `@/lib/supabase/server` + `next/cache` (as `view-actions.test.ts` does). Assert: `createDependency` rejects invalid ids without calling rpc; on success calls `rpc("create_item_dependency", { p_predecessor, p_successor })` and returns `{ ok: true, data: { dependencyId } }`; on rpc error returns `{ ok:false, error }` with the rpc message (cycle message passes through). `deleteDependency` deletes by id (and reads board_id for revalidate). Write these first; run → fail (module missing).

- [ ] **Step 3: actions** (`src/lib/boards/dependency-actions.ts`):

```ts
"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  createDependencySchema,
  deleteDependencySchema,
} from "@/lib/validations/dependency-actions";
import type { ActionResult } from "@/lib/boards/actions";

function fail(message: string): { ok: false; error: string } {
  return { ok: false, error: message };
}

export async function createDependency(input: {
  predecessorId: string;
  successorId: string;
}): Promise<ActionResult<{ dependencyId: string }>> {
  const parsed = createDependencySchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_item_dependency", {
    p_predecessor: parsed.data.predecessorId,
    p_successor: parsed.data.successorId,
  });
  if (error || !data)
    return fail(error?.message ?? "Could not create dependency.");
  revalidatePath(`/boards/${data.board_id}`);
  return { ok: true, data: { dependencyId: data.id } };
}

export async function deleteDependency(input: {
  dependencyId: string;
}): Promise<ActionResult> {
  const parsed = deleteDependencySchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");
  const supabase = await createClient();
  const { data: dep, error: readErr } = await supabase
    .from("item_dependencies")
    .select("board_id")
    .eq("id", parsed.data.dependencyId)
    .maybeSingle();
  if (readErr || !dep) return fail("Dependency not found.");
  const { error } = await supabase
    .from("item_dependencies")
    .delete()
    .eq("id", parsed.data.dependencyId);
  if (error) return fail(error.message);
  revalidatePath(`/boards/${dep.board_id}`);
  return { ok: true, data: undefined };
}
```

Align the Step 2 mocks to these exact chains. Run `pnpm test src/lib/boards/dependency-actions.test.ts` → green.

- [ ] **Step 4: mutations** — in `use-board-mutations.ts`, import `addDependency`, `removeDependency`, `type CacheDependency` from `cache.ts` and the two actions. Add an `addDependencyMutation` (patch-on-success with the returned row — mirror `addItemMutation`) and a `removeDependencyMutation` (optimistic remove + rollback — mirror `clearCellMutation`). Expose:

```ts
addDependency: (
  vars: { predecessorId: string; successorId: string },
  callbacks?: { onError?: (err: Error) => void },
) => addDependencyMutation.mutate(vars, { onError: (e) => callbacks?.onError?.(e) }),
removeDependency: (vars: { dependencyId: string }) => removeDependencyMutation.mutate(vars),
```

The `addDependencyMutation.mutationFn` calls `createDependency`, throws on `!ok` (so the picker can surface cycle errors via `onError`), returns `{ dep: res.data ... }` — note the action returns only `{ dependencyId }`, so to patch the cache you need the full row: have `addDependencyMutation` read the optimistic shape from realtime instead — simplest: **do not optimistic-insert**; rely on the realtime INSERT echo to add the dependency (it arrives in ms and `addDependency` is idempotent). So `addDependencyMutation` just calls the action and surfaces errors; the cache gains the row via realtime. Document this in a comment. `removeDependency` stays optimistic (remove by id) with rollback.

- [ ] **Step 5: mutation tests** — extend `src/lib/boards/use-board-mutations.test.tsx`: `removeDependency` optimistically removes the dep from the cache and rolls back on error; `addDependency` calls the action and surfaces an error via `onError` (no optimistic insert). Run `pnpm test src/lib/boards/use-board-mutations.test.tsx && pnpm typecheck` → green.

- [ ] **Step 6: Commit**

```bash
git add src/lib/validations/dependency-actions.ts src/lib/boards/dependency-actions.ts src/lib/boards/dependency-actions.test.ts src/lib/boards/use-board-mutations.ts src/lib/boards/use-board-mutations.test.tsx
git commit -m "feat(boards): dependency actions + mutations (create via rpc, optimistic remove)"
```

---

## Task 5: Dates core (`dates.ts`)

**Files:** Create `src/lib/boards/dates.ts` + `src/lib/boards/dates.test.ts`

- [ ] **Step 1: tests** (write first, run → fail):

```ts
import { describe, it, expect } from "vitest";
import { resolveDateColumn, itemDateRange } from "@/lib/boards/dates";

const cols = [
  { id: "c1", kind: "text" },
  { id: "d1", kind: "date" },
  { id: "d2", kind: "date" },
] as never;

describe("resolveDateColumn", () => {
  it("returns the configured date column when valid", () => {
    expect(resolveDateColumn(cols, { date_column_id: "d2" })?.id).toBe("d2");
  });
  it("falls back to the first date column", () => {
    expect(resolveDateColumn(cols, { date_column_id: "c1" })?.id).toBe("d1");
    expect(resolveDateColumn(cols, {})?.id).toBe("d1");
  });
  it("returns null when there is no date column", () => {
    expect(
      resolveDateColumn([{ id: "c1", kind: "text" }] as never, {}),
    ).toBeNull();
  });
});

describe("itemDateRange", () => {
  const cells = [
    {
      item_id: "i1",
      column_id: "d1",
      value: { date: "2026-06-10", end: "2026-06-12" },
    },
    { item_id: "i2", column_id: "d1", value: { date: "2026-06-15" } },
  ] as never;
  it("returns start+end for a range", () => {
    expect(itemDateRange("i1", cells, "d1")).toEqual({
      start: "2026-06-10",
      end: "2026-06-12",
    });
  });
  it("uses date as end when end is absent", () => {
    expect(itemDateRange("i2", cells, "d1")).toEqual({
      start: "2026-06-15",
      end: "2026-06-15",
    });
  });
  it("returns null when the item has no date cell", () => {
    expect(itemDateRange("i3", cells, "d1")).toBeNull();
  });
});
```

- [ ] **Step 2: implement**:

```ts
// src/lib/boards/dates.ts
import type { CacheCellValue, CacheColumn } from "@/lib/boards/cache";

export function resolveDateColumn(
  columns: CacheColumn[],
  config: { date_column_id?: string | null } | null | undefined,
): CacheColumn | null {
  const dateColumns = columns.filter((c) => c.kind === "date");
  const requested = config?.date_column_id
    ? dateColumns.find((c) => c.id === config.date_column_id)
    : undefined;
  return requested ?? dateColumns[0] ?? null;
}

export type DateRange = { start: string; end: string };

export function itemDateRange(
  itemId: string,
  cellValues: CacheCellValue[],
  dateColumnId: string,
): DateRange | null {
  const cell = cellValues.find(
    (c) => c.item_id === itemId && c.column_id === dateColumnId,
  );
  const value = cell?.value as { date?: string; end?: string } | undefined;
  if (!value?.date) return null;
  return { start: value.date, end: value.end ?? value.date };
}
```

- [ ] **Step 3: run** — `pnpm test src/lib/boards/dates.test.ts` → green.
- [ ] **Step 4: Commit**

```bash
git add src/lib/boards/dates.ts src/lib/boards/dates.test.ts
git commit -m "feat(boards): date-column resolution + item date-range helpers"
```

---

## Task 6: Calendar — `calendar.ts`, `CalendarBoard`, routing/switcher

> Load `pulse-ui` + `frontend-design` first.

**Files:**

- Create: `src/lib/boards/calendar.ts` + `.test.ts`, `src/components/boards/CalendarBoard.tsx` + `.test.tsx`
- Modify: `src/lib/validations/view-actions.ts`, `src/lib/boards/view-actions.ts`, `src/components/boards/ViewSwitcher.tsx`, `src/app/boards/[boardId]/page.tsx`

### 6.1 Extend view kinds + per-kind config

- [ ] **Step 1: validations** (`src/lib/validations/view-actions.ts`):

```ts
export const viewKindSchema = z.enum([
  "table",
  "kanban",
  "calendar",
  "timeline",
]);
export const kanbanConfigSchema = z.object({
  group_column_id: uuid.nullable().optional(),
});
export const calendarConfigSchema = z.object({
  date_column_id: uuid.nullable().optional(),
});
export const timelineConfigSchema = z.object({
  date_column_id: uuid.nullable().optional(),
  zoom: z.enum(["week", "month"]).optional(),
});
export function configSchemaForKind(
  kind: "table" | "kanban" | "calendar" | "timeline",
) {
  switch (kind) {
    case "kanban":
      return kanbanConfigSchema;
    case "calendar":
      return calendarConfigSchema;
    case "timeline":
      return timelineConfigSchema;
    case "table":
      return z.object({}).strict();
  }
}
```

Keep `updateBoardViewSchema.config` permissive at the edge (`z.record(z.string(), z.unknown()).optional()`); the per-kind check happens server-side in the action.

- [ ] **Step 2: action** — in `src/lib/boards/view-actions.ts`, `updateBoardView` currently rejects config unless kind==='kanban'. Replace that with: load the view's `kind` + `board_id`; if `config` provided, validate it with `configSchemaForKind(kind)` and `fail(...)` on parse error (drop the kanban-only restriction). Import `configSchemaForKind`.

- [ ] **Step 3** — run `pnpm test src/lib/boards/view-actions.test.ts && pnpm typecheck`; update any view-actions test that asserted the old "config only valid for kanban" behavior to the new per-kind validation (e.g. a calendar view accepts `{ date_column_id }`; a table view rejects a non-empty config). Green.

### 6.2 Calendar pure logic

- [ ] **Step 4: tests** (`src/lib/boards/calendar.test.ts`) — write first, run → fail:

```ts
import { describe, it, expect } from "vitest";
import { buildCalendarMonth, onEventDropped } from "@/lib/boards/calendar";

const items = [
  { id: "i1", name: "A" },
  { id: "i2", name: "B" },
] as never;
const cells = [
  {
    item_id: "i1",
    column_id: "d1",
    value: { date: "2026-06-10", end: "2026-06-11" },
  },
  { item_id: "i2", column_id: "d1", value: { date: "2026-06-15" } },
] as never;

describe("buildCalendarMonth", () => {
  const month = buildCalendarMonth("2026-06-01", items, cells, "d1");
  it("produces 6 weeks of 7 days", () => {
    expect(month.weeks).toHaveLength(6);
    expect(month.weeks.every((w) => w.length === 7)).toBe(true);
  });
  it("places an event on its start day with the right span", () => {
    const day10 = month.weeks.flat().find((d) => d.dateISO === "2026-06-10")!;
    const ev = day10.events.find((e) => e.itemId === "i1")!;
    expect(ev).toMatchObject({ startsHere: true, spanDays: 2 });
  });
  it("marks out-of-month days", () => {
    expect(month.weeks.flat().filter((d) => !d.inMonth).length).toBeGreaterThan(
      0,
    );
  });
});

describe("onEventDropped", () => {
  it("moves the date and preserves duration", () => {
    const setCell = vi.fn();
    onEventDropped(
      "i1",
      "2026-06-10",
      "2026-06-12",
      { start: "2026-06-10", end: "2026-06-11" },
      "d1",
      setCell,
    );
    expect(setCell).toHaveBeenCalledWith({
      itemId: "i1",
      columnId: "d1",
      value: { date: "2026-06-12", end: "2026-06-13" },
    });
  });
});
```

(import `vi` from vitest.)

- [ ] **Step 5: implement** (`src/lib/boards/calendar.ts`) — pure. Build a 6×7 grid starting on the Sunday on/before the 1st of `monthISO`. Use UTC date math on `YYYY-MM-DD` strings (no `Date.now()`; constructing `new Date("2026-06-01")` is allowed — only argless `new Date()` is banned). `Day = { dateISO, inMonth, events }`; `events` placed on each day the range covers, `startsHere` true on the start day, `spanDays = days from start..end inclusive`. `onEventDropped(itemId, fromDayISO, toDayISO, currentRange, dateColumnId, setCell)` computes `deltaDays = toDay - fromDay`, shifts both `start` and `end` by delta, writes `{ date, end }` (omit `end` when start===end to keep single-day items clean). Helper `addDaysISO(iso, n)` and `diffDaysISO(a, b)` using `Date.UTC`.

- [ ] **Step 6: run** — `pnpm test src/lib/boards/calendar.test.ts` → green.

### 6.3 CalendarBoard component

- [ ] **Step 7: tests** (`src/components/boards/CalendarBoard.test.tsx`) — mock `useBoardMutations`/`useBoardRealtime`/`next/navigation`, wrap in `QueryClientProvider` (pattern: `KanbanBoard.test.tsx`). Fixture: payload with one `date` column `d1`, a calendar view `{ id:"v", kind:"calendar", config:{ date_column_id:"d1" } }`, items i1 (dated) / i3 (no date). Assert: renders 7 weekday headers; the dated item's name appears on the grid; an unscheduled disclosure shows the date-less item. Write first → fail.

- [ ] **Step 8: implement** (`src/components/boards/CalendarBoard.tsx`, `"use client"`) — props `{ payload, members?, selectedViewId }`. Hydrate cache + realtime like `KanbanBoard`. Resolve `selectedView` from `payload.views`, its `config`; `dateColumn = resolveDateColumn(cache.columns, config)`. If null → empty state "Add a Date column to use the Calendar view." Local state `monthISO` (init from the first dated item or a fixed reference passed via prop/`new Date` is banned argless — derive from the earliest item's date, else default to `"2026-06-01"`-style first-of-an-item's-month; if no items, render current-month-less empty grid using the first item's month or a neutral header). Render `<BoardHeader …/>`, a month nav (‹ / › updating `monthISO`), a `date-column picker` (native `<select>` → `updateBoardView({ viewId, config:{ date_column_id } })` + `router.refresh()`), the 7-col weekday header + `buildCalendarMonth` grid (each day cell: day number, event chips reusing `CellRenderer` for the item's Status; click empty day → inline add → `addItem` then `setCell` that date), and an "Unscheduled (n)" disclosure listing date-less items. Drag a chip (dnd-kit) → `onEventDropped`. Keep the drag provider thin; the tested logic is `onEventDropped` + `buildCalendarMonth`.

- [ ] **Step 9: routing + switcher**:
  - `src/app/boards/[boardId]/page.tsx`: add `selected?.kind === "calendar"` branch → `<CalendarBoard payload members selectedViewId/>` (import it).
  - `src/components/boards/ViewSwitcher.tsx`: change the "Add view" button into a `DropdownMenu` offering Kanban / Calendar / Timeline (each → `createBoardView({ boardId, kind })` then `router.push(?view=)`); add `calendar: CalendarDays`, `timeline: GanttChartSquare` to `KIND_ICON`. Update `ViewSwitcher.test.tsx`: the add test now opens the menu and picks a kind (assert `createBoardView` called with that kind).

- [ ] **Step 10: run** — `pnpm test src/components/boards/CalendarBoard.test.tsx src/components/boards/ViewSwitcher.test.tsx && pnpm typecheck && pnpm lint`. Green.

- [ ] **Step 11: Commit**

```bash
git add src/lib/validations/view-actions.ts src/lib/boards/view-actions.ts src/lib/boards/view-actions.test.ts \
  src/lib/boards/calendar.ts src/lib/boards/calendar.test.ts \
  src/components/boards/CalendarBoard.tsx src/components/boards/CalendarBoard.test.tsx \
  src/components/boards/ViewSwitcher.tsx src/components/boards/ViewSwitcher.test.tsx \
  src/app/boards/[boardId]/page.tsx
git commit -m "feat(boards): calendar view (month grid, drag reschedule, add-on-day) + per-kind view config"
```

---

## Task 7: Timeline/Gantt — `gantt.ts`, `GanttBoard`

> Load `pulse-ui` + `frontend-design` first.

**Files:**

- Create: `src/lib/boards/gantt.ts` + `.test.ts`, `src/components/boards/GanttBoard.tsx` + `.test.tsx`
- Modify: `src/app/boards/[boardId]/page.tsx`

### 7.1 Gantt pure logic

- [ ] **Step 1: tests** (`src/lib/boards/gantt.test.ts`) — write first, run → fail:

```ts
import { describe, it, expect, vi } from "vitest";
import {
  buildGanttRows,
  detectViolations,
  onBarMoved,
  onBarResized,
} from "@/lib/boards/gantt";

const items = [
  { id: "i1", name: "A" },
  { id: "i2", name: "B" },
  { id: "i3", name: "C" },
] as never;
const cells = [
  {
    item_id: "i1",
    column_id: "d1",
    value: { date: "2026-06-02", end: "2026-06-04" },
  },
  { item_id: "i2", column_id: "d1", value: { date: "2026-06-03" } }, // milestone
  // i3 unscheduled
] as never;

describe("buildGanttRows", () => {
  const { rows } = buildGanttRows(
    items,
    cells,
    "d1",
    "2026-06-01",
    30,
    "month",
  );
  it("computes start column + span (1-based day offset)", () => {
    const a = rows.find((r) => r.itemId === "i1")!;
    expect(a).toMatchObject({
      startCol: 1,
      spanCols: 3,
      isMilestone: false,
      scheduled: true,
    });
  });
  it("marks a single-day item as a milestone", () => {
    expect(rows.find((r) => r.itemId === "i2")!.isMilestone).toBe(true);
  });
  it("marks date-less items unscheduled", () => {
    expect(rows.find((r) => r.itemId === "i3")!.scheduled).toBe(false);
  });
});

describe("detectViolations", () => {
  it("flags a successor that starts before its predecessor ends", () => {
    const { rows } = buildGanttRows(
      items,
      cells,
      "d1",
      "2026-06-01",
      30,
      "month",
    );
    // i2 (start 06-03) depends-on i1 (end 06-04) → violation
    const deps = [
      { id: "dep1", predecessor_id: "i1", successor_id: "i2" },
    ] as never;
    expect(detectViolations(rows, deps).has("dep1")).toBe(true);
  });
});

describe("onBarMoved / onBarResized", () => {
  it("move shifts date+end by delta", () => {
    const setCell = vi.fn();
    onBarMoved(
      "i1",
      2,
      { start: "2026-06-02", end: "2026-06-04" },
      "d1",
      setCell,
    );
    expect(setCell).toHaveBeenCalledWith({
      itemId: "i1",
      columnId: "d1",
      value: { date: "2026-06-04", end: "2026-06-06" },
    });
  });
  it("resize writes the new end", () => {
    const setCell = vi.fn();
    onBarResized(
      "i1",
      "2026-06-06",
      { start: "2026-06-02", end: "2026-06-04" },
      "d1",
      setCell,
    );
    expect(setCell).toHaveBeenCalledWith({
      itemId: "i1",
      columnId: "d1",
      value: { date: "2026-06-02", end: "2026-06-06" },
    });
  });
});
```

- [ ] **Step 2: implement** (`src/lib/boards/gantt.ts`) — pure, reuse `itemDateRange` from `dates.ts` and the ISO date helpers (export `addDaysISO`/`diffDaysISO` from `calendar.ts` or duplicate small helpers in a shared `date-math.ts` — prefer extracting `src/lib/boards/date-math.ts` with `addDaysISO`/`diffDaysISO` and importing it in both `calendar.ts` and `gantt.ts`). `buildGanttRows`: for each item, `itemDateRange`; if null → `{ scheduled:false }`; else `startCol = diffDaysISO(rangeStart, start) + 1`, `spanCols = diffDaysISO(start, end) + 1`, `isMilestone = start===end`. `detectViolations(rows, deps)`: for each dep, look up predecessor + successor rows (both scheduled); flag when `successorStartISO < predecessorEndISO` — compare via the range derived in the row (keep `startISO`/`endISO` on each row for this). `onBarMoved(itemId, deltaDays, range, dateColumnId, setCell)` / `onBarResized(itemId, newEndISO, range, dateColumnId, setCell)` write `{ date, end }`.

> If you extract `date-math.ts`, refactor `calendar.ts` (Task 6) to import from it in this task and re-run Task 6's tests — note it in the commit.

- [ ] **Step 3: run** — `pnpm test src/lib/boards/gantt.test.ts` → green.

### 7.2 GanttBoard component

- [ ] **Step 4: tests** (`src/components/boards/GanttBoard.test.tsx`) — mock mutations (`setCell`, `addDependency`, `removeDependency`)/realtime/router; `QueryClientProvider`. Fixture: payload with a `date` column, a timeline view, items i1/i2 dated + a dependency i1→i2, plus i3 unscheduled. Assert: renders a bar/row per scheduled item + the item names; renders an "Unscheduled" rail containing i3; the dependency picker (open a bar's ⋯ menu → "Add dependency") calls `createDependency`/`addDependency`; a violating dependency gets the violation class/role. Also unit-assert the exported pure handlers are wired (call `onBarResized` path via a thin exported helper if needed). Write first → fail.

- [ ] **Step 5: implement** (`src/components/boards/GanttBoard.tsx`, `"use client"`) — props `{ payload, members?, selectedViewId }`. Hydrate cache + realtime. Resolve view + `config`; `dateColumn = resolveDateColumn`; null → empty state. Compute a render range: earliest item start (or a default) for `rangeStartISO` and a `dayCount` from `zoom` (week→~28 days, month→~90 days; keep simple + documented). `const { rows } = buildGanttRows(...)`; `const violations = detectViolations(rows, cache.dependencies)`. Render `<BoardHeader/>`, a zoom toggle (week/month → `updateBoardView({ config:{ zoom } })` + refresh), a date-column picker, a left name rail + right grid (header ticks + one row per scheduled item; bar positioned by `startCol`/`spanCols`; milestone = diamond). dnd-kit: drag bar → `onBarMoved`; drag right-edge handle → `onBarResized`. An SVG overlay drawing arrows predecessor→successor (from each dep, look up both rows' geometry); violation deps use the destructive accent. Each bar's ⋯ menu (`dropdown-menu`): "Add dependency → blocked by [item]" (submenu/list of other items → `mutations.addDependency({ predecessorId: pickedItem, successorId: thisItem })`); arrows have a remove affordance → `mutations.removeDependency({ dependencyId })`. "Unscheduled" rail lists `rows.filter(r => !r.scheduled)`. Keep drag/arrow rendering thin around the pure builders.

- [ ] **Step 6: routing** — `page.tsx`: add `selected?.kind === "timeline"` branch → `<GanttBoard …/>`.

- [ ] **Step 7: run** — `pnpm test src/components/boards/GanttBoard.test.tsx && pnpm typecheck && pnpm lint`. Green; new files warning-clean.

- [ ] **Step 8: Commit**

```bash
git add src/lib/boards/gantt.ts src/lib/boards/gantt.test.ts src/lib/boards/date-math.ts \
  src/lib/boards/calendar.ts \
  src/components/boards/GanttBoard.tsx src/components/boards/GanttBoard.test.tsx \
  src/app/boards/[boardId]/page.tsx
git commit -m "feat(boards): timeline/gantt view (bars, zoom, dependency arrows + violation flag)"
```

---

## Task 8: e2e + full gate + wrapup

**Files:** Create `e2e/calendar-timeline.spec.ts`

- [ ] **Step 1: e2e** — mirror `e2e/boards.spec.ts` + `e2e/kanban.spec.ts` (confirmed service-role user, login, onboarding, create board). Then, in one test (`test.setTimeout(180_000)`):
  1. Add a **Calendar** view via the switcher's add-kind menu; assert the calendar grid (7 weekday headers) renders and the URL has `?view=`.
  2. From the Table view, add an item and set its Date (open `${itemName} Date`, fill a date in the visible month, Enter) — the robust path over flaky drags. Switch to the Calendar view; assert the item appears on the grid.
  3. Add a **Timeline** view; assert bars render for dated items and an "Unscheduled" rail exists.
  4. Reload; assert the date persisted.
     (Dependency creation through the picker is exercised by component tests; attempt it in e2e only if it's deterministic — otherwise note it as a concern.)

- [ ] **Step 2: run** — `pnpm e2e e2e/calendar-timeline.spec.ts` → pass (not skip). Show the result line.

- [ ] **Step 3: full gate** — `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all green. Fix anything (systematic-debugging).

- [ ] **Step 4: advisors** — run `get_advisors` (or document the manual gate): no new warnings from `item_dependencies` (RLS on, indexes present).

- [ ] **Step 5: Commit + push develop**

```bash
git add e2e/calendar-timeline.spec.ts
git commit -m "test(boards): e2e calendar + timeline happy paths"
git push origin develop
```

- [ ] **Step 6: `/wrapup`** — log the session, bump the north-star (Phase 3b done → Phase 4 next or promote develop→main). Capture any new gotchas (enum-add-value-in-migration; dnd-in-jsdom reaffirmed) as ADRs.

---

## Self-Review (completed by plan author)

**Spec coverage:** §3 data model → Task 1; RLS → Task 2; §4 data layer → Tasks 3-4; §5 pure logic → Tasks 5 (dates), 6 (calendar), 7 (gantt); §6 components → Tasks 6 (CalendarBoard), 7 (GanttBoard), routing/switcher → Task 6.9; §7 cache/a11y → Tasks 3,4,6,7 (cache patches, picker deps); §8 testing → every task + Task 8 e2e. Dependencies (visual links + violation, picker creation) → Tasks 1,4,7. All sections mapped.

**Placeholder scan:** No "TBD"/"handle edge cases". Judgment calls made explicit: `addDependency` relies on realtime echo rather than optimistic insert (Task 4 Step 4, with rationale); `date-math.ts` extraction shared by calendar/gantt (Task 7 Step 2); Gantt `dayCount` per zoom documented. The two big components give structure + the fully-specified pure handlers/builders they consume (complete code), consistent with the KanbanBoard precedent.

**Type consistency:** `ItemDependency`/`dependencies` defined Task 3, used Tasks 4,7. `CacheDependency`/`addDependency`/`removeDependency` defined Task 3, used Tasks 4,7. `resolveDateColumn`/`itemDateRange`/`DateRange` defined Task 5, used Tasks 6,7. `buildCalendarMonth`/`onEventDropped` (Task 6), `buildGanttRows`/`detectViolations`/`onBarMoved`/`onBarResized` (Task 7) — names identical across their test + impl steps. `configSchemaForKind`/`viewKindSchema` (Task 6.1) consumed by `updateBoardView` (Task 6.1 Step 2) and `createBoardView`/switcher (Task 6.9). Date value shape `{ date, end? }` matches `dateValueSchema`.
