# Phase 6c — Time Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Monday-style **Time Tracking column kind** to boards — a cell showing an item's total tracked time against an optional estimate, with a live start/stop timer (one running per user) and manual time logging, plus a parent rollup of subitem totals.

**Architecture:** New `time_tracking` value in the `column_kind` enum (discriminated-union/switch pattern, exactly like 6b). Session data lives in a new **`time_entries`** side table (cell content derived per `(item_id, column_id)` — the same "derive from a side table" pattern 6b's Files column uses for `attachments`). The per-item **estimate** rides in the column's `cell_values` row (`{ estimateSeconds }`). A `SECURITY DEFINER` `start_timer` RPC atomically stops the caller's running entry and inserts a new one, guarded by a partial-unique index on `(user_id) WHERE ended_at IS NULL`. First paint loads one bounded board-scoped `time_entries` query; all mutations are Server Actions + optimistic cache patch + `revalidatePath` (no realtime in v1).

**Tech Stack:** Next.js 16 (App Router, RSC + Server Actions), React 19, Supabase (Postgres + RLS), TanStack Query (board cache), Zod, Vitest, Playwright, Tailwind v4 + shadcn.

**Spec:** `docs/superpowers/specs/2026-06-20-phase-6c-time-tracking-design.md`

---

## File map

**Create**

- `supabase/migrations/<ts>_time_tracking_enum.sql` — enum value only (must commit before use)
- `supabase/migrations/<ts2>_time_entries.sql` — table + RLS + indexes + `start_timer` RPC
- `src/lib/boards/time-format.ts` — pure parse/format + tracked-seconds derivation
- `src/lib/boards/time-format.test.ts`
- `src/lib/boards/time-actions.ts` — start/stop/addManual/edit/delete + setEstimate
- `src/lib/boards/time-actions.test.ts`
- `src/lib/boards/time-entries.rls.integration.test.ts`
- `src/components/boards/cells/TimeTrackingCell.tsx`
- `src/components/boards/cells/TimeTrackingCell.test.tsx`
- `tests/e2e/time-tracking.spec.ts` (match the repo's existing e2e dir/naming)

**Modify** (exhaustive `ColumnKind` switches — compiler forces each)

- `src/lib/validations/boards.ts` — `columnKindSchema`, `cellValueSchema`, `columnSettingsSchema`
- `src/lib/validations/board-actions.ts` — time action schemas
- `src/lib/boards/column-kinds.ts` — `COLUMN_KIND_META`, `COLUMN_KIND_ORDER`
- `src/lib/boards/column-defaults.ts` — `DEFAULT_NAME`
- `src/lib/boards/rollup.ts` — `RollupResult` += `duration`; `rollupCell` time case + `rollupTimeTracking()`
- `src/components/boards/RollupCell.tsx` — `duration` render case
- `src/lib/collaboration/activity.ts` — `describeCell` case
- `src/lib/boards/template-payload.ts` — `buildTemplatePayload` case
- `src/lib/dashboards/list-rows.ts` — `formatCell` case
- `src/lib/dashboards/filter-meta.ts` — `operatorsForKind` case
- `src/components/boards/cells/index.tsx` — `CellRenderer` null case
- `src/lib/boards/queries.ts` — `BoardPayload` += `timeEntries`; board-scoped query
- `src/lib/boards/cache.ts` — `CacheTimeEntry`, `BoardCache.timeEntries`, helpers
- `src/lib/boards/use-board-mutations.ts` — time mutations + `setEstimate`
- `src/components/boards/BoardTable.tsx` — `EditableCell` special-case + collapsed-parent rollup special-case + `CellControls` (+ `currentUserId`)
- the board page/client that builds `BoardCache` from `BoardPayload` (hydration) — add `timeEntries`

## Execution DAG

- **Batch 1:** Task 1 (enum migration) — foundation, must apply + commit before Task 2.
- **Batch 2:** Task 2 (table + RPC + types) — after enum committed.
- **Batch 3:** Task 3 (time-format), Task 4 (validations + exhaustive switches) — both need only the regenerated types from Task 2; independent of each other.
- **Batch 4:** Task 5 (server actions), Task 6 (RLS integration test), Task 7 (cache helpers) — need Tasks 2–4.
- **Batch 5:** Task 8 (payload + hydration), Task 9 (mutations) — need Task 5, 7.
- **Batch 6:** Task 10 (cell UI) — needs Task 8, 9.
- **Batch 7:** Task 11 (rollup + RollupCell) — needs Task 7, 10.
- **Batch 8:** Task 12 (e2e + full gate) — needs everything.

Critical path ≈ T1 → T2 → T4 → T5 → T9 → T10 → T11 → T12.
**Hot files** (`validations/boards.ts`, `rollup.ts`, `cells/index.tsx`, `queries.ts`, `cache.ts`, `BoardTable.tsx`, `column-defaults.ts`, `column-kinds.ts`) are touched by multiple tasks — execute these tasks **sequentially** (or worktree-isolate parallel batches) so agents don't clobber the shared `develop` checkout. Before every commit run `git status` and stage only the paths this plan owns (working-agreement: never `git add -A`).

---

## Task 1: Enum migration — `time_tracking`

**Files:**

- Create: `supabase/migrations/<timestamp>_time_tracking_enum.sql`

Postgres requires `ALTER TYPE … ADD VALUE` to be committed before the value is used by any later statement (table column default, function body, etc.). Keep this migration **enum-only**; the table (Task 2) lands in a separate, later-timestamped migration so the enum is already committed when it runs. Mirrors `supabase/migrations/20260619240000_column_kinds_6b.sql`.

- [ ] **Step 1: Write the migration**

```sql
-- Phase 6c: add the time_tracking column kind.
-- Enum-only migration: ALTER TYPE ... ADD VALUE must commit before any later
-- statement (the time_entries table / start_timer RPC) references it.
alter type public.column_kind add value if not exists 'time_tracking';
```

- [ ] **Step 2: Apply to cloud** (per-session authorization required — confirm with the user first)

Run: `pnpm supabase db push --linked` (or the project's documented apply path)
Expected: migration applies; `time_tracking` present in `column_kind`.

- [ ] **Step 3: Regenerate + commit types**

Run: `pnpm db:types` (filter the stray PostHog `'"_tag"'` telemetry line if it appears, then prettier — see north-star §3 manual-gate note)
Expected: `src/types/database.types.ts` `column_kind` union now includes `"time_tracking"`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/<timestamp>_time_tracking_enum.sql src/types/database.types.ts
git commit -m "feat(boards): add time_tracking column kind enum value (6c)"
```

---

## Task 2: `time_entries` table + `start_timer` RPC

**Files:**

- Create: `supabase/migrations/<timestamp2>_time_entries.sql` (timestamp strictly greater than Task 1's)

Mirrors the `attachments` org-scoped, parent-consistent RLS shape (`supabase/migrations/20260617110000_attachments.sql`) and the `delete_column_option` `SECURITY DEFINER` style (`supabase/migrations/20260619240001_files_column_and_option_delete.sql`).

- [ ] **Step 1: Write the migration**

```sql
-- Phase 6c: time tracking sessions. One row per logged session; a running
-- timer is a row with ended_at IS NULL. Org-scoped RLS mirrors attachments.
create table public.time_entries (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations (id) on delete cascade,
  board_id      uuid not null references public.boards (id)        on delete cascade,
  item_id       uuid not null references public.items (id)         on delete cascade,
  column_id     uuid not null references public.columns (id)       on delete cascade,
  user_id       uuid not null references auth.users (id),
  started_at    timestamptz not null,
  ended_at      timestamptz,                 -- NULL ⇒ running timer
  duration_secs integer,                     -- set on stop / for manual entries; NULL while running
  created_at    timestamptz not null default now(),
  -- a completed entry has both ended_at and duration_secs; a running one has neither
  check ((ended_at is null) = (duration_secs is null)),
  check (duration_secs is null or duration_secs >= 0)
);

-- one running timer per user, ever (auto-stop relies on this)
create unique index time_entries_one_running_per_user
  on public.time_entries (user_id) where ended_at is null;

-- per-cell derivation + board-payload first-paint query
create index time_entries_item_column_idx on public.time_entries (item_id, column_id);
create index time_entries_board_idx       on public.time_entries (board_id);

alter table public.time_entries enable row level security;

-- read: any org member
create policy time_entries_select on public.time_entries
  for select to authenticated using (public.is_org_member(org_id));

-- insert: member, parent-consistent, self as user (manual entries go through here)
create policy time_entries_insert on public.time_entries
  for insert to authenticated with check (
    public.is_org_member(org_id)
    and public.board_in_org(board_id, org_id)
    and public.item_in_org(item_id, org_id)
    and user_id = (select auth.uid())
  );

-- update/delete: own rows only (v1; org-admin override deferred)
create policy time_entries_update on public.time_entries
  for update to authenticated
  using (public.is_org_member(org_id) and user_id = (select auth.uid()))
  with check (public.is_org_member(org_id) and user_id = (select auth.uid()));

create policy time_entries_delete on public.time_entries
  for delete to authenticated
  using (public.is_org_member(org_id) and user_id = (select auth.uid()));

grant select, insert, update, delete on public.time_entries to authenticated;
-- NOTE: intentionally NOT added to supabase_realtime (v1 = optimistic + revalidate).

-- Atomic start: stop the caller's running timer (anywhere), then start a new one.
-- Returns the stopped row(s) + the new running row so the client cache reconciles both.
create or replace function public.start_timer(
  p_item_id uuid,
  p_column_id uuid
) returns setof public.time_entries
language plpgsql security definer set search_path = '' as $$
declare
  v_uid      uuid := (select auth.uid());
  v_org_id   uuid;
  v_board_id uuid;
  v_kind     public.column_kind;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  select org_id, board_id into v_org_id, v_board_id
  from public.items where id = p_item_id;
  if v_org_id is null then raise exception 'Item not found'; end if;
  if not public.is_org_member(v_org_id) then raise exception 'Not authorized'; end if;

  select kind into v_kind from public.columns
  where id = p_column_id and board_id = v_board_id;
  if v_kind is null then raise exception 'Column not found'; end if;
  if v_kind <> 'time_tracking' then raise exception 'Not a time tracking column'; end if;

  -- Stop the caller's currently-running timer (one per user) BEFORE inserting,
  -- so the partial-unique index is never transiently violated.
  return query
    update public.time_entries
       set ended_at = now(),
           duration_secs = greatest(0, floor(extract(epoch from (now() - started_at))))::int
     where user_id = v_uid and ended_at is null
     returning *;

  return query
    insert into public.time_entries (org_id, board_id, item_id, column_id, user_id, started_at)
         values (v_org_id, v_board_id, p_item_id, p_column_id, v_uid, now())
      returning *;
end;
$$;

revoke all on function public.start_timer(uuid, uuid) from public;
grant execute on function public.start_timer(uuid, uuid) to authenticated;
```

- [ ] **Step 2: Apply to cloud** (confirm authorization with the user)

Run: `pnpm supabase db push --linked`
Expected: applies cleanly; `time_entries` + `start_timer` exist.

- [ ] **Step 3: Run advisors**

Use the Supabase advisor lint (MCP `get_advisors`, read-only) for `security` + `performance`.
Expected: no new warnings attributable to `time_entries` (RLS enabled, policies present, indexes on FKs).

- [ ] **Step 4: Regenerate + commit types**

Run: `pnpm db:types`
Expected: `Tables<"time_entries">` and the `start_timer` function appear in `database.types.ts`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/<timestamp2>_time_entries.sql src/types/database.types.ts
git commit -m "feat(boards): time_entries table + start_timer RPC (6c)"
```

---

## Task 3: `time-format.ts` — pure parse/format + tracked-seconds

**Files:**

- Create: `src/lib/boards/time-format.ts`
- Test: `src/lib/boards/time-format.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import {
  parseDuration,
  formatDuration,
  trackedSeconds,
  type TimeEntryLike,
} from "./time-format";

describe("parseDuration", () => {
  it("parses h/m forms", () => {
    expect(parseDuration("1h 30m")).toBe(5400);
    expect(parseDuration("90m")).toBe(5400);
    expect(parseDuration("1.5h")).toBe(5400);
    expect(parseDuration("2h")).toBe(7200);
  });
  it("bare number = minutes", () => {
    expect(parseDuration("45")).toBe(2700);
  });
  it("h:mm clock form", () => {
    expect(parseDuration("2:30")).toBe(9000);
  });
  it("rejects junk and non-positive", () => {
    expect(parseDuration("")).toBeNull();
    expect(parseDuration("abc")).toBeNull();
    expect(parseDuration("0m")).toBeNull();
  });
});

describe("formatDuration", () => {
  it("drops zero parts", () => {
    expect(formatDuration(9900)).toBe("2h 45m");
    expect(formatDuration(14400)).toBe("4h");
    expect(formatDuration(900)).toBe("15m");
    expect(formatDuration(0)).toBe("0m");
  });
});

describe("trackedSeconds", () => {
  const now = Date.UTC(2026, 5, 20, 12, 0, 0);
  it("sums completed + live-ticks running", () => {
    const entries: TimeEntryLike[] = [
      { ended_at: "x", duration_secs: 600, started_at: "a" },
      {
        ended_at: null,
        duration_secs: null,
        started_at: new Date(now - 60_000).toISOString(),
      },
    ];
    expect(trackedSeconds(entries, now)).toBe(660);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/boards/time-format.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
export type TimeEntryLike = {
  started_at: string;
  ended_at: string | null;
  duration_secs: number | null;
};

/**
 * Parse a human duration into seconds. Accepts "1h 30m", "90m", "1.5h",
 * "2:30" (h:mm), and a bare number (minutes). Returns null on empty / junk /
 * non-positive input. Pure.
 */
export function parseDuration(input: string): number | null {
  const s = input.trim().toLowerCase();
  if (!s) return null;

  // h:mm clock form
  const clock = /^(\d+):([0-5]?\d)$/.exec(s);
  if (clock) {
    const secs = Number(clock[1]) * 3600 + Number(clock[2]) * 60;
    return secs > 0 ? secs : null;
  }

  // bare number ⇒ minutes
  if (/^\d+(\.\d+)?$/.test(s)) {
    const secs = Math.round(Number(s) * 60);
    return secs > 0 ? secs : null;
  }

  // h/m units, in any order
  let secs = 0;
  let matched = false;
  for (const m of s.matchAll(/(\d+(?:\.\d+)?)\s*([hm])/g)) {
    matched = true;
    const n = Number(m[1]);
    secs += m[2] === "h" ? n * 3600 : n * 60;
  }
  if (!matched) return null;
  secs = Math.round(secs);
  return secs > 0 ? secs : null;
}

/** Format seconds as "2h 45m" / "4h" / "15m" (drops zero parts). Pure. */
export function formatDuration(totalSecs: number): string {
  const secs = Math.max(0, Math.floor(totalSecs));
  const h = Math.floor(secs / 3600);
  const m = Math.round((secs % 3600) / 60);
  const parts: string[] = [];
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  return parts.length ? parts.join(" ") : "0m";
}

/**
 * Total tracked seconds for a set of entries: completed durations plus the live
 * elapsed time of any running entry (ended_at null), computed against `nowMs`.
 * Pure — caller supplies the clock so it stays testable.
 */
export function trackedSeconds(
  entries: readonly TimeEntryLike[],
  nowMs: number,
): number {
  let total = 0;
  for (const e of entries) {
    if (e.ended_at == null) {
      total += Math.max(
        0,
        Math.floor((nowMs - Date.parse(e.started_at)) / 1000),
      );
    } else {
      total += e.duration_secs ?? 0;
    }
  }
  return total;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/boards/time-format.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/boards/time-format.ts src/lib/boards/time-format.test.ts
git commit -m "feat(boards): time-format parse/format + tracked-seconds helper (6c)"
```

---

## Task 4: Validations + exhaustive `ColumnKind` switches

**Files:**

- Modify: `src/lib/validations/boards.ts`
- Modify: `src/lib/validations/board-actions.ts`
- Modify: `src/lib/boards/column-kinds.ts`
- Modify: `src/lib/boards/column-defaults.ts`
- Modify: `src/lib/collaboration/activity.ts`
- Modify: `src/lib/boards/template-payload.ts`
- Modify: `src/lib/dashboards/list-rows.ts`
- Modify: `src/lib/dashboards/filter-meta.ts`
- Test: `src/lib/validations/boards.test.ts` (add cases if the file exists; else add to `column-kinds.test.ts`)

- [ ] **Step 1: Write the failing test** (append to the existing boards validation test)

```ts
import { describe, expect, it } from "vitest";
import { cellValueSchema, columnKindSchema } from "@/lib/validations/boards";

describe("time_tracking validation", () => {
  it("accepts time_tracking as a kind", () => {
    expect(columnKindSchema.safeParse("time_tracking").success).toBe(true);
  });
  it("estimate cell value requires a positive int", () => {
    const s = cellValueSchema("time_tracking");
    expect(s.safeParse({ estimateSeconds: 3600 }).success).toBe(true);
    expect(s.safeParse({ estimateSeconds: 0 }).success).toBe(false);
    expect(s.safeParse({ estimateSeconds: 1.5 }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/lib/validations/boards.test.ts`
Expected: FAIL — `"time_tracking"` not in enum.

- [ ] **Step 3: Edit `src/lib/validations/boards.ts`**

Add `"time_tracking"` to `columnKindSchema` (after `"files"`, line 18). Add the value schema and wire both switches:

```ts
// after filesValueSchema (line 107):
export const timeTrackingValueSchema = z.object({
  // The cell row holds only the optional estimate; tracked time derives from
  // the time_entries table (no cell_values row needed for the total).
  estimateSeconds: z.number().int().positive(),
});
```

In `cellValueSchema` add `case "time_tracking": return timeTrackingValueSchema;`. In `columnSettingsSchema` add `time_tracking` to the `emptySettingsSchema` group (line 56-ish, alongside `files`).

- [ ] **Step 4: Edit `src/lib/boards/column-kinds.ts`**

Add to `COLUMN_KIND_META` and `COLUMN_KIND_ORDER`. Import a clock icon:

```ts
import { /* …existing… */ Timer } from "lucide-react";
// in COLUMN_KIND_META:
time_tracking: { label: "Time tracking", Icon: Timer, hasOptions: false },
// append "time_tracking" to COLUMN_KIND_ORDER
```

- [ ] **Step 5: Edit `src/lib/boards/column-defaults.ts`**

Add `time_tracking: "Time tracking",` to `DEFAULT_NAME` (the `Record<ColumnKind, string>` will not compile without it). No settings branch needed (defaults to `{}`).

- [ ] **Step 6: Add action schemas to `src/lib/validations/board-actions.ts`**

```ts
const uuid = z.string().uuid(); // reuse the file's existing `uuid` if present

export const startTimerSchema = z.object({ itemId: uuid, columnId: uuid });
export const stopTimerSchema = z.object({ entryId: uuid });
export const addManualEntrySchema = z.object({
  itemId: uuid,
  columnId: uuid,
  // local date (YYYY-MM-DD) the session is logged against; defaults today in UI
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  durationSecs: z
    .number()
    .int()
    .positive()
    .max(86_400 * 366),
});
export const editEntrySchema = z.object({
  entryId: uuid,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  durationSecs: z
    .number()
    .int()
    .positive()
    .max(86_400 * 366),
});
export const deleteEntrySchema = z.object({ entryId: uuid });
export const setEstimateSchema = z.object({
  itemId: uuid,
  columnId: uuid,
  estimateSeconds: z.number().int().positive().nullable(),
});
```

- [ ] **Step 7: Satisfy the remaining exhaustive switches**

Add a `time_tracking` case to each (compiler will flag any you miss):

- `src/lib/collaboration/activity.ts` `describeCell`: `case "time_tracking": return "time";` (or a label consistent with neighbors — it never carries a human-editable scalar value via cell edits, so a terse label is fine).
- `src/lib/boards/template-payload.ts` `buildTemplatePayload`: `case "time_tracking": return null;` (or whatever "no seed value" is expressed as for `files`/`text` — mirror the `files` case exactly).
- `src/lib/dashboards/list-rows.ts` `formatCell`: `case "time_tracking": return "";` (mirror `files`).
- `src/lib/dashboards/filter-meta.ts` `operatorsForKind`: `case "time_tracking": return [];` (no dashboard filtering in v1 — mirror `files`).

> For each, open the file, read the neighboring `files` / `text` case, and copy its shape exactly so the return type matches.

- [ ] **Step 8: Run tests + typecheck**

Run: `pnpm vitest run src/lib/validations/boards.test.ts && pnpm typecheck`
Expected: PASS; no `ColumnKind` exhaustiveness errors anywhere.

- [ ] **Step 9: Commit**

```bash
git add src/lib/validations/boards.ts src/lib/validations/boards.test.ts \
  src/lib/validations/board-actions.ts src/lib/boards/column-kinds.ts \
  src/lib/boards/column-defaults.ts src/lib/collaboration/activity.ts \
  src/lib/boards/template-payload.ts src/lib/dashboards/list-rows.ts \
  src/lib/dashboards/filter-meta.ts
git commit -m "feat(boards): time_tracking kind validation + exhaustive switch cases (6c)"
```

---

## Task 5: Server actions — `time-actions.ts`

**Files:**

- Create: `src/lib/boards/time-actions.ts`
- Test: `src/lib/boards/time-actions.test.ts` (unit: validation rejection paths; the DB behavior is covered by Task 6)

Mirrors `removeColumnOption` (RPC wrapper) and `createGroup` (plain insert with org derivation) in `src/lib/boards/actions.ts`, and reuses the `ActionResult`/`fail`/`createClient` helpers from that module. `setEstimate` reuses the existing `upsertCell` / `clearCellValue` actions rather than a new cell action.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import {
  addManualEntrySchema,
  startTimerSchema,
} from "@/lib/validations/board-actions";

describe("time action schemas", () => {
  it("rejects a bad uuid", () => {
    expect(
      startTimerSchema.safeParse({ itemId: "x", columnId: "y" }).success,
    ).toBe(false);
  });
  it("rejects non-positive duration", () => {
    expect(
      addManualEntrySchema.safeParse({
        itemId: "00000000-0000-0000-0000-000000000000",
        columnId: "00000000-0000-0000-0000-000000000000",
        date: "2026-06-20",
        durationSecs: 0,
      }).success,
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/lib/boards/time-actions.test.ts`
Expected: FAIL — schemas import OK but file under test (the actions) not yet created; ensure the import path resolves (schemas exist from Task 4) so this is a green-able test that locks the contract.

- [ ] **Step 3: Write `src/lib/boards/time-actions.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/types/database.types";
import {
  addManualEntrySchema,
  deleteEntrySchema,
  editEntrySchema,
  setEstimateSchema,
  startTimerSchema,
  stopTimerSchema,
} from "@/lib/validations/board-actions";
import { upsertCell, clearCellValue } from "@/lib/boards/actions";

type TimeEntry = Tables<"time_entries">;
type Result<T> = { ok: true; data: T } | { ok: false; error: string };
const fail = (error: string): Result<never> => ({ ok: false, error });

async function itemBoard(
  supabase: Awaited<ReturnType<typeof createClient>>,
  itemId: string,
): Promise<{ orgId: string; boardId: string } | null> {
  const { data } = await supabase
    .from("items")
    .select("org_id, board_id")
    .eq("id", itemId)
    .maybeSingle();
  return data ? { orgId: data.org_id, boardId: data.board_id } : null;
}

/** Start a timer: stops the caller's running timer + starts a new one (RPC, atomic). */
export async function startTimer(input: {
  itemId: string;
  columnId: string;
}): Promise<Result<{ entries: TimeEntry[] }>> {
  const parsed = startTimerSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");
  const supabase = await createClient();
  const meta = await itemBoard(supabase, parsed.data.itemId);
  if (!meta) return fail("Item not found.");
  const { data, error } = await supabase.rpc("start_timer", {
    p_item_id: parsed.data.itemId,
    p_column_id: parsed.data.columnId,
  });
  if (error) return fail(error.message);
  revalidatePath(`/boards/${meta.boardId}`);
  return { ok: true, data: { entries: (data ?? []) as TimeEntry[] } };
}

/** Stop a running entry (own row via RLS). */
export async function stopTimer(input: {
  entryId: string;
}): Promise<Result<{ entry: TimeEntry }>> {
  const parsed = stopTimerSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");
  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("time_entries")
    .select("started_at, board_id")
    .eq("id", parsed.data.entryId)
    .maybeSingle();
  if (!existing) return fail("Entry not found.");
  const durationSecs = Math.max(
    0,
    Math.floor((Date.now() - Date.parse(existing.started_at)) / 1000),
  );
  const { data, error } = await supabase
    .from("time_entries")
    .update({ ended_at: new Date().toISOString(), duration_secs: durationSecs })
    .eq("id", parsed.data.entryId)
    .is("ended_at", null) // idempotent: only the still-running row
    .select("*")
    .maybeSingle();
  if (error) return fail(error.message);
  if (!data) return fail("Entry already stopped.");
  revalidatePath(`/boards/${existing.board_id}`);
  return { ok: true, data: { entry: data } };
}

/** Add a completed entry retroactively for a date. */
export async function addManualEntry(input: {
  itemId: string;
  columnId: string;
  date: string;
  durationSecs: number;
}): Promise<Result<{ entry: TimeEntry }>> {
  const parsed = addManualEntrySchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");
  const supabase = await createClient();
  const meta = await itemBoard(supabase, parsed.data.itemId);
  if (!meta) return fail("Item not found.");
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("Not authenticated.");
  // Validate the column belongs to this board and is a time-tracking column.
  const { data: col } = await supabase
    .from("columns")
    .select("id, kind, board_id")
    .eq("id", parsed.data.columnId)
    .maybeSingle();
  if (!col || col.board_id !== meta.boardId || col.kind !== "time_tracking")
    return fail("Invalid time tracking column.");
  const startedAt = new Date(`${parsed.data.date}T12:00:00.000Z`).toISOString();
  const endedAt = new Date(
    Date.parse(startedAt) + parsed.data.durationSecs * 1000,
  ).toISOString();
  const { data, error } = await supabase
    .from("time_entries")
    .insert({
      org_id: meta.orgId,
      board_id: meta.boardId,
      item_id: parsed.data.itemId,
      column_id: parsed.data.columnId,
      user_id: user.id,
      started_at: startedAt,
      ended_at: endedAt,
      duration_secs: parsed.data.durationSecs,
    })
    .select("*")
    .single();
  if (error || !data) return fail(error?.message ?? "Could not add time.");
  revalidatePath(`/boards/${meta.boardId}`);
  return { ok: true, data: { entry: data } };
}

/** Edit a completed entry's date + duration (own row via RLS). */
export async function editEntry(input: {
  entryId: string;
  date: string;
  durationSecs: number;
}): Promise<Result<{ entry: TimeEntry }>> {
  const parsed = editEntrySchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");
  const supabase = await createClient();
  const startedAt = new Date(`${parsed.data.date}T12:00:00.000Z`).toISOString();
  const endedAt = new Date(
    Date.parse(startedAt) + parsed.data.durationSecs * 1000,
  ).toISOString();
  const { data, error } = await supabase
    .from("time_entries")
    .update({
      started_at: startedAt,
      ended_at: endedAt,
      duration_secs: parsed.data.durationSecs,
    })
    .eq("id", parsed.data.entryId)
    .not("ended_at", "is", null) // only edit completed entries
    .select("*, board_id")
    .maybeSingle();
  if (error) return fail(error.message);
  if (!data) return fail("Entry not found or still running.");
  revalidatePath(`/boards/${data.board_id}`);
  return { ok: true, data: { entry: data } };
}

/** Delete an entry (own row via RLS). */
export async function deleteEntry(input: {
  entryId: string;
}): Promise<Result<{ id: string }>> {
  const parsed = deleteEntrySchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("time_entries")
    .delete()
    .eq("id", parsed.data.entryId)
    .select("board_id")
    .maybeSingle();
  if (error) return fail(error.message);
  if (data?.board_id) revalidatePath(`/boards/${data.board_id}`);
  return { ok: true, data: { id: parsed.data.entryId } };
}

/** Set or clear the per-item estimate (reuses the cell write path). */
export async function setEstimate(input: {
  itemId: string;
  columnId: string;
  estimateSeconds: number | null;
}): Promise<Result<{ ok: true }>> {
  const parsed = setEstimateSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");
  if (parsed.data.estimateSeconds == null) {
    const res = await clearCellValue({
      itemId: parsed.data.itemId,
      columnId: parsed.data.columnId,
    });
    return res.ok ? { ok: true, data: { ok: true } } : fail(res.error);
  }
  const res = await upsertCell({
    itemId: parsed.data.itemId,
    columnId: parsed.data.columnId,
    value: { estimateSeconds: parsed.data.estimateSeconds },
  });
  return res.ok ? { ok: true, data: { ok: true } } : fail(res.error);
}
```

> Verify the real names/signatures of `upsertCell`, `clearCellValue`, `createClient` (`@/lib/supabase/server`), and the `ActionResult`/`fail` helpers in `src/lib/boards/actions.ts` and match them exactly — reuse the shared `ActionResult`/`fail` if exported rather than redefining `Result` locally.

- [ ] **Step 4: Run + typecheck**

Run: `pnpm vitest run src/lib/boards/time-actions.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/boards/time-actions.ts src/lib/boards/time-actions.test.ts
git commit -m "feat(boards): time tracking server actions (start/stop/manual/edit/delete/estimate) (6c)"
```

---

## Task 6: RLS + RPC integration test

**Files:**

- Create: `src/lib/boards/time-entries.rls.integration.test.ts`

Mirror the harness in `src/lib/boards/columns-settings.rls.integration.test.ts` (service-role admin client, `provisionUser` helper creating org/workspace/board/group/item via the anon client, `describe.skipIf(!SERVICE_ROLE_KEY)`, `afterAll` user cleanup).

- [ ] **Step 1: Write the test** (full file)

Reuse the `provisionUser` boilerplate verbatim from `columns-settings.rls.integration.test.ts` (it returns `{ id, orgId, boardId, itemId, anon, … }`). Provision one `owner` and one `outsider`. Add, before each timer test, a `time_tracking` column for the owner:

```ts
async function timeColumn(u: TestUser): Promise<string> {
  const { data } = await u.anon
    .from("columns")
    .insert({
      org_id: u.orgId,
      board_id: u.boardId,
      kind: "time_tracking",
      name: "Time",
      settings: {},
      position: 99,
    })
    .select("id")
    .single();
  return (data as { id: string }).id;
}
```

Cases:

```ts
it("start_timer stops the running entry and starts a new one atomically", async () => {
  const columnId = await timeColumn(owner);
  // seed a running entry 60s ago
  const { data: first } = await owner.anon
    .from("time_entries")
    .insert({
      org_id: owner.orgId,
      board_id: owner.boardId,
      item_id: owner.itemId,
      column_id: columnId,
      user_id: owner.id,
      started_at: new Date(Date.now() - 60_000).toISOString(),
    })
    .select("id")
    .single();

  const { data: rows, error } = await owner.anon.rpc("start_timer", {
    p_item_id: owner.itemId,
    p_column_id: columnId,
  });
  expect(error).toBeNull();
  const list = rows as {
    id: string;
    ended_at: string | null;
    duration_secs: number | null;
  }[];
  // exactly one running row remains for the user
  const running = list.filter((r) => r.ended_at === null);
  expect(running).toHaveLength(1);

  const { data: stopped } = await owner.anon
    .from("time_entries")
    .select("ended_at, duration_secs")
    .eq("id", (first as { id: string }).id)
    .single();
  expect(stopped!.ended_at).not.toBeNull();
  expect(stopped!.duration_secs).toBeGreaterThanOrEqual(60);

  // global invariant: never two running rows for one user
  const { data: allRunning } = await owner.anon
    .from("time_entries")
    .select("id")
    .eq("user_id", owner.id)
    .is("ended_at", null);
  expect(allRunning ?? []).toHaveLength(1);
});

it("an outsider cannot read another org's entries", async () => {
  const columnId = await timeColumn(owner);
  await owner.anon.rpc("start_timer", {
    p_item_id: owner.itemId,
    p_column_id: columnId,
  });
  const { data } = await outsider.anon
    .from("time_entries")
    .select("id")
    .eq("board_id", owner.boardId);
  expect(data ?? []).toHaveLength(0);
});

it("a user cannot delete another user's entry", async () => {
  const columnId = await timeColumn(owner);
  const { data: e } = await owner.anon
    .from("time_entries")
    .insert({
      org_id: owner.orgId,
      board_id: owner.boardId,
      item_id: owner.itemId,
      column_id: columnId,
      user_id: owner.id,
      started_at: new Date().toISOString(),
      ended_at: new Date().toISOString(),
      duration_secs: 10,
    })
    .select("id")
    .single();
  await outsider.anon
    .from("time_entries")
    .delete()
    .eq("id", (e as { id: string }).id);
  const { data: still } = await owner.anon
    .from("time_entries")
    .select("id")
    .eq("id", (e as { id: string }).id)
    .maybeSingle();
  expect(still).not.toBeNull();
});

it("the check constraint rejects a completed entry with no duration", async () => {
  const columnId = await timeColumn(owner);
  const { error } = await owner.anon.from("time_entries").insert({
    org_id: owner.orgId,
    board_id: owner.boardId,
    item_id: owner.itemId,
    column_id: columnId,
    user_id: owner.id,
    started_at: new Date().toISOString(),
    ended_at: new Date().toISOString(),
    duration_secs: null,
  });
  expect(error).not.toBeNull();
});
```

- [ ] **Step 2: Run** (requires `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`)

Run: `pnpm vitest run src/lib/boards/time-entries.rls.integration.test.ts`
Expected: PASS (or SKIP if the key is absent — confirm it ran by checking it's not skipped).

- [ ] **Step 3: Commit**

```bash
git add src/lib/boards/time-entries.rls.integration.test.ts
git commit -m "test(boards): time_entries RLS + start_timer atomicity integration (6c)"
```

---

## Task 7: Cache helpers + tracked/rollup derivation

**Files:**

- Modify: `src/lib/boards/cache.ts`
- Modify: `src/lib/boards/rollup.ts` (add `rollupTimeTracking` + the `duration` result kind)
- Test: `src/lib/boards/cache.test.ts`, `src/lib/boards/rollup.test.ts`

- [ ] **Step 1: Write failing tests**

In `cache.test.ts`:

```ts
import {
  prependTimeEntry,
  removeTimeEntry,
  upsertTimeEntry,
  timeEntriesForCell,
  type BoardCache,
  type CacheTimeEntry,
} from "./cache";

const entry = (id: string, item = "i1", col = "c1"): CacheTimeEntry =>
  ({
    id,
    org_id: "o",
    board_id: "b",
    item_id: item,
    column_id: col,
    user_id: "u",
    started_at: "2026-06-20T00:00:00Z",
    ended_at: null,
    duration_secs: null,
    created_at: "2026-06-20T00:00:00Z",
  }) as CacheTimeEntry;

it("filters entries for a (item,column) cell", () => {
  const cache = {
    timeEntries: [entry("a"), entry("b", "i2")],
  } as unknown as BoardCache;
  expect(timeEntriesForCell(cache, "i1", "c1").map((e) => e.id)).toEqual(["a"]);
});
it("prepend is idempotent on id", () => {
  let cache = { timeEntries: [] } as unknown as BoardCache;
  cache = prependTimeEntry(cache, entry("a"));
  cache = prependTimeEntry(cache, entry("a"));
  expect(cache.timeEntries).toHaveLength(1);
});
```

In `rollup.test.ts`:

```ts
import { rollupTimeTracking } from "./rollup";
it("sums child tracked totals + estimates into a duration rollup", () => {
  const now = Date.UTC(2026, 5, 20, 12, 0, 0);
  const r = rollupTimeTracking(
    [
      { started_at: "x", ended_at: "y", duration_secs: 3600 },
      { started_at: "x", ended_at: "y", duration_secs: 1800 },
    ],
    [7200],
    now,
  );
  expect(r).toEqual({ kind: "duration", totalSecs: 5400, estimateSecs: 7200 });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/lib/boards/cache.test.ts src/lib/boards/rollup.test.ts`
Expected: FAIL — symbols missing.

- [ ] **Step 3: Edit `src/lib/boards/cache.ts`**

```ts
import type { Tables } from "@/types/database.types"; // if not already imported
export type CacheTimeEntry = Tables<"time_entries">;

// add `timeEntries: CacheTimeEntry[];` to the BoardCache type

/** All time entries for a given (item, time-tracking-column) cell. */
export function timeEntriesForCell(
  cache: BoardCache,
  itemId: string,
  columnId: string,
): CacheTimeEntry[] {
  return cache.timeEntries.filter(
    (t) => t.item_id === itemId && t.column_id === columnId,
  );
}

/** Prepend a time entry; idempotent on id (newest-first). Immutable. */
export function prependTimeEntry(
  cache: BoardCache,
  e: CacheTimeEntry,
): BoardCache {
  if (cache.timeEntries.some((t) => t.id === e.id)) return cache;
  return { ...cache, timeEntries: [e, ...cache.timeEntries] };
}

/** Insert-or-replace a time entry by id. Immutable. */
export function upsertTimeEntry(
  cache: BoardCache,
  e: CacheTimeEntry,
): BoardCache {
  const idx = cache.timeEntries.findIndex((t) => t.id === e.id);
  const timeEntries =
    idx === -1
      ? [e, ...cache.timeEntries]
      : cache.timeEntries.map((t, i) => (i === idx ? e : t));
  return { ...cache, timeEntries };
}

/** Remove a time entry by id. No-op if absent. Immutable. */
export function removeTimeEntry(cache: BoardCache, id: string): BoardCache {
  return {
    ...cache,
    timeEntries: cache.timeEntries.filter((t) => t.id !== id),
  };
}
```

> Update every place that constructs a `BoardCache` literal (initial hydration, test fixtures) to include `timeEntries: []` — the compiler will list them.

- [ ] **Step 4: Edit `src/lib/boards/rollup.ts`**

Add the result kind + helper; keep `rollupCell`'s `time_tracking` case `blank` (it can't see entries — the parent rollup is computed via `rollupTimeTracking` from the cache, special-cased in `BoardTable`):

```ts
import { trackedSeconds, type TimeEntryLike } from "@/lib/boards/time-format";

// add to RollupResult union:
//   | { kind: "duration"; totalSecs: number; estimateSecs?: number }

/**
 * Parent rollup for a time-tracking column. Sums subitem tracked totals (from
 * time_entries) + estimates (from the subitems' estimate cell values). Pure.
 */
export function rollupTimeTracking(
  entries: readonly TimeEntryLike[],
  estimateSecsList: readonly number[],
  nowMs: number,
): RollupResult {
  const totalSecs = trackedSeconds(entries, nowMs);
  const estimateSecs = estimateSecsList.reduce((a, b) => a + b, 0);
  if (totalSecs === 0 && estimateSecs === 0) return { kind: "blank" };
  return estimateSecs > 0
    ? { kind: "duration", totalSecs, estimateSecs }
    : { kind: "duration", totalSecs };
}
```

In the `rollupCell` switch, change the shared `text | link | email | phone | files` blank case to also include `time_tracking` (so it stays exhaustive and returns blank there).

- [ ] **Step 5: Edit `src/components/boards/RollupCell.tsx`**

Add a `duration` case (mirrors the `number`/`rating` tabular style):

```tsx
import { formatDuration } from "@/lib/boards/time-format";
// in the switch:
case "duration":
  return (
    <span className="text-muted-foreground text-sm tabular-nums">
      Σ {formatDuration(result.totalSecs)}
      {result.estimateSecs ? ` / ${formatDuration(result.estimateSecs)}` : ""}
    </span>
  );
```

- [ ] **Step 6: Run tests + typecheck**

Run: `pnpm vitest run src/lib/boards/cache.test.ts src/lib/boards/rollup.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/boards/cache.ts src/lib/boards/cache.test.ts \
  src/lib/boards/rollup.ts src/lib/boards/rollup.test.ts \
  src/components/boards/RollupCell.tsx
git commit -m "feat(boards): time-entry cache helpers + duration rollup (6c)"
```

---

## Task 8: Board payload + hydration

**Files:**

- Modify: `src/lib/boards/queries.ts`
- Modify: the board page/client that maps `BoardPayload` → `BoardCache` (find it: `rg "attachments: .*\?\? \[\]" src/app src/components` / the `useBoardCache(` initial-data construction)
- Test: covered by build/typecheck + Task 12 e2e (this is wiring)

- [ ] **Step 1: Edit `getBoardPayload`** (`src/lib/boards/queries.ts`)

Add `timeEntries: TimeEntry[]` to `BoardPayload`, add a parallel query to the `Promise.all`, and include it in the return. Bounded + indexed (`time_entries_board_idx`):

```ts
// type: add to BoardPayload
timeEntries: Tables<"time_entries">[];

// in Promise.all, add:
supabase
  .from("time_entries")
  .select("*")
  .eq("board_id", boardId)
  .order("created_at", { ascending: false })
  .limit(1000),

// in the return object:
timeEntries: timeEntriesRes.data ?? [],
```

> The `.limit(1000)` is a bound (same tradeoff as the attachments `.limit(200)`). If a board ever approaches it, totals could undercount — note it; a server-side aggregate is the documented follow-up (spec §8). For v1 this matches the attachments precedent.

- [ ] **Step 2: Thread into the BoardCache hydration**

Where the board client builds the initial `BoardCache` from the payload, add `timeEntries: payload.timeEntries`. The Task-7 type change makes this a compile error until done — let the compiler guide you to the exact spot.

- [ ] **Step 3: Typecheck + build**

Run: `pnpm typecheck`
Expected: PASS (no missing `timeEntries` on any `BoardCache` construction).

- [ ] **Step 4: Commit**

```bash
git add src/lib/boards/queries.ts <board-client-file>
git commit -m "feat(boards): load time_entries into the board payload + cache (6c)"
```

---

## Task 9: Optimistic mutations + controls

**Files:**

- Modify: `src/lib/boards/use-board-mutations.ts`
- Modify: `src/components/boards/BoardTable.tsx` (`CellControls` type + the controls object; add `currentUserId`)
- Test: extend `src/lib/boards/use-board-mutations.test.tsx` if present (optimistic add/remove)

Mirror the existing `setCell` (optimistic write, rollback on error), `uploadColumnFile` (insert → `onSuccess` patch), and `deleteColumnFile` (optimistic remove) patterns. Use the Task-7 cache helpers.

- [ ] **Step 1: Add mutations** in `use-board-mutations.ts`

```ts
import {
  startTimer,
  stopTimer,
  addManualEntry,
  editEntry,
  deleteEntry,
  setEstimate,
} from "@/lib/boards/time-actions";
import {
  prependTimeEntry,
  removeTimeEntry,
  upsertTimeEntry,
  type CacheTimeEntry,
} from "@/lib/boards/cache";

// start: RPC returns stopped + new rows → upsert all into cache
const startTimerMutation = useMutation<
  { entries: CacheTimeEntry[] },
  Error,
  { itemId: string; columnId: string }
>({
  mutationFn: async (vars) => {
    const res = await startTimer(vars);
    if (!res.ok) throw new Error(res.error);
    return { entries: res.data.entries as CacheTimeEntry[] };
  },
  onSuccess: ({ entries }) => {
    qc.setQueryData<BoardCache>(key, (prev) =>
      prev ? entries.reduce((c, e) => upsertTimeEntry(c, e), prev) : prev,
    );
  },
});

// stop: server computes duration → upsert the returned row
const stopTimerMutation = useMutation<
  { entry: CacheTimeEntry },
  Error,
  { entryId: string }
>({
  mutationFn: async (vars) => {
    const res = await stopTimer(vars);
    if (!res.ok) throw new Error(res.error);
    return { entry: res.data.entry as CacheTimeEntry };
  },
  onSuccess: ({ entry }) => {
    qc.setQueryData<BoardCache>(key, (prev) =>
      prev ? upsertTimeEntry(prev, entry) : prev,
    );
  },
});

// add manual: insert returns the row → prepend
const addManualEntryMutation = useMutation<
  { entry: CacheTimeEntry },
  Error,
  { itemId: string; columnId: string; date: string; durationSecs: number }
>({
  mutationFn: async (vars) => {
    const res = await addManualEntry(vars);
    if (!res.ok) throw new Error(res.error);
    return { entry: res.data.entry as CacheTimeEntry };
  },
  onSuccess: ({ entry }) => {
    qc.setQueryData<BoardCache>(key, (prev) =>
      prev ? prependTimeEntry(prev, entry) : prev,
    );
  },
});

// edit: upsert returned row
const editEntryMutation = useMutation<
  { entry: CacheTimeEntry },
  Error,
  { entryId: string; date: string; durationSecs: number }
>({
  mutationFn: async (vars) => {
    const res = await editEntry(vars);
    if (!res.ok) throw new Error(res.error);
    return { entry: res.data.entry as CacheTimeEntry };
  },
  onSuccess: ({ entry }) => {
    qc.setQueryData<BoardCache>(key, (prev) =>
      prev ? upsertTimeEntry(prev, entry) : prev,
    );
  },
});

// delete: optimistic remove + rollback
const deleteEntryMutation = useMutation<
  unknown,
  Error,
  { entryId: string },
  { previous?: BoardCache }
>({
  mutationFn: async (vars) => {
    const res = await deleteEntry(vars);
    if (!res.ok) throw new Error(res.error);
    return res;
  },
  onMutate: async (vars) => {
    await qc.cancelQueries({ queryKey: key });
    const previous = qc.getQueryData<BoardCache>(key);
    if (previous)
      qc.setQueryData<BoardCache>(key, removeTimeEntry(previous, vars.entryId));
    return { previous };
  },
  onError: (_e, _v, ctx) => {
    if (ctx?.previous) qc.setQueryData(key, ctx.previous);
  },
});

// estimate: optimistic cell write (reuse the setCell optimistic shape from this file)
const setEstimateMutation = useMutation<
  unknown,
  Error,
  { itemId: string; columnId: string; estimateSeconds: number | null },
  { previous?: BoardCache }
>({
  mutationFn: async (vars) => {
    const res = await setEstimate(vars);
    if (!res.ok) throw new Error(res.error);
    return res;
  },
  onMutate: async (vars) => {
    await qc.cancelQueries({ queryKey: key });
    const previous = qc.getQueryData<BoardCache>(key);
    if (previous) {
      const next =
        vars.estimateSeconds == null
          ? removeCellValue(previous, vars.itemId, vars.columnId) // use the file's existing clear helper
          : upsertCellValue(previous, {
              org_id: previous.board.org_id,
              board_id: previous.board.id,
              item_id: vars.itemId,
              column_id: vars.columnId,
              value: { estimateSeconds: vars.estimateSeconds },
              updated_at: new Date().toISOString(),
            } as CacheCellValue);
      qc.setQueryData<BoardCache>(key, next);
    }
    return { previous };
  },
  onError: (_e, _v, ctx) => {
    if (ctx?.previous) qc.setQueryData(key, ctx.previous);
  },
});
```

> Match the existing `removeCellValue`/`upsertCellValue` helper names used by `setCell`/`clearCellValue` in this file (read those two mutations first and reuse the exact helpers). Export the new mutation fns from the hook's return object alongside `setCell`, `uploadColumnFile`, etc.

- [ ] **Step 2: Extend `CellControls`** (`BoardTable.tsx`)

Add `currentUserId: string` and the time callbacks (`startTimer`, `stopTimer`, `addManualEntry`, `editEntry`, `deleteEntry`, `setEstimate`) to the `CellControls` type, and wire them from the mutations in the controls object. Thread `currentUserId` from the board page (it already resolves the user server-side) → the board client → `BoardTable` → controls.

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/boards/use-board-mutations.ts src/components/boards/BoardTable.tsx <board-client-file>
git commit -m "feat(boards): optimistic time-tracking mutations + controls (6c)"
```

---

## Task 10: `TimeTrackingCell` + Table wiring

**Files:**

- Create: `src/components/boards/cells/TimeTrackingCell.tsx`
- Test: `src/components/boards/cells/TimeTrackingCell.test.tsx`
- Modify: `src/components/boards/cells/index.tsx` (`CellRenderer`: `case "time_tracking": return null;` — special-cased in `EditableCell`, exactly like `files`)
- Modify: `src/components/boards/BoardTable.tsx` (`EditableCell` special-case)

Use the project `pulse-ui` + `frontend-design` skills before styling (working-agreement #3). Use a shadcn `Popover` for the expanded panel (match the Files-cell lightbox/popover patterns in the codebase).

- [ ] **Step 1: Write the failing component test**

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TimeTrackingCell } from "./TimeTrackingCell";

const base = {
  entries: [],
  estimateSeconds: null,
  currentUserId: "u1",
  nowMs: Date.UTC(2026, 5, 20, 12, 0, 0),
  onStart: vi.fn(),
  onStop: vi.fn(),
  onAddManual: vi.fn(),
  onEdit: vi.fn(),
  onDelete: vi.fn(),
  onSetEstimate: vi.fn(),
};

it("renders tracked / estimate", () => {
  render(
    <TimeTrackingCell
      {...base}
      entries={[
        {
          id: "a",
          user_id: "u1",
          started_at: "x",
          ended_at: "y",
          duration_secs: 9900,
        } as never,
      ]}
      estimateSeconds={14400}
    />,
  );
  expect(screen.getByText(/2h 45m/)).toBeInTheDocument();
  expect(screen.getByText(/4h/)).toBeInTheDocument();
});

it("start button calls onStart when no running entry", async () => {
  render(<TimeTrackingCell {...base} />);
  await userEvent.click(screen.getByRole("button", { name: /start timer/i }));
  expect(base.onStart).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/components/boards/cells/TimeTrackingCell.test.tsx`
Expected: FAIL — component missing.

- [ ] **Step 3: Implement `TimeTrackingCell.tsx`**

Build a collapsed trigger (tracked `/` estimate + ▶/■) wrapped in a `Popover` whose content is the header (estimate inline edit + start/stop), a flat chronological entry list (each `formatDuration` + date + `user_id`; own rows get edit/delete), and an "+ Add time" row using `parseDuration`. Props interface:

```tsx
"use client";
import { useEffect, useState } from "react";
import { Play, Square, Plus } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  parseDuration,
  formatDuration,
  trackedSeconds,
  type TimeEntryLike,
} from "@/lib/boards/time-format";
import type { CacheTimeEntry } from "@/lib/boards/cache";

export type TimeTrackingCellProps = {
  entries: readonly CacheTimeEntry[];
  estimateSeconds: number | null;
  currentUserId: string;
  nowMs?: number; // injectable for tests; defaults to Date.now() in a tick effect
  onStart: () => void;
  onStop: (entryId: string) => void;
  onAddManual: (date: string, durationSecs: number) => void;
  onEdit: (entryId: string, date: string, durationSecs: number) => void;
  onDelete: (entryId: string) => void;
  onSetEstimate: (estimateSeconds: number | null) => void;
};

export function TimeTrackingCell(props: TimeTrackingCellProps) {
  const running = props.entries.find(
    (e) => e.ended_at == null && e.user_id === props.currentUserId,
  );
  // live tick only while a timer runs
  const [nowMs, setNowMs] = useState(props.nowMs ?? Date.now());
  useEffect(() => {
    if (props.nowMs != null || !running) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [props.nowMs, running]);

  const total = trackedSeconds(
    props.entries as readonly TimeEntryLike[],
    nowMs,
  );
  // …render trigger (formatDuration(total) + optional "/ estimate" + Play/Square)…
  // …PopoverContent: estimate input (parseDuration → onSetEstimate), start/stop,
  //   sorted entry list, "+ Add time" form (parseDuration → onAddManual)…
  return null; // replace with the JSX above; styled per pulse-ui
}
```

Implement the full JSX (trigger + popover) following `pulse-ui`. Keep it under ~200 lines; if it grows, split the popover body into a sibling component.

- [ ] **Step 4: Wire `CellRenderer`** (`cells/index.tsx`): add `case "time_tracking": return null;`.

- [ ] **Step 5: Wire `EditableCell`** (`BoardTable.tsx`) — before the `isEditing` branch, mirror the `files` special-case:

```tsx
if (column.kind === "time_tracking") {
  const entries = timeEntriesForCell(controls.cache, item.id, column.id);
  const estimate =
    (value as { estimateSeconds?: number } | null)?.estimateSeconds ?? null;
  return (
    <div className="flex h-full items-center border-l px-3">
      <TimeTrackingCell
        entries={entries}
        estimateSeconds={estimate}
        currentUserId={controls.currentUserId}
        onStart={() => controls.startTimer(item.id, column.id)}
        onStop={(id) => controls.stopTimer(id)}
        onAddManual={(date, secs) =>
          controls.addManualEntry(item.id, column.id, date, secs)
        }
        onEdit={(id, date, secs) => controls.editEntry(id, date, secs)}
        onDelete={(id) => controls.deleteEntry(id)}
        onSetEstimate={(secs) => controls.setEstimate(item.id, column.id, secs)}
      />
    </div>
  );
}
```

- [ ] **Step 6: Run tests + typecheck**

Run: `pnpm vitest run src/components/boards/cells/TimeTrackingCell.test.tsx && pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/boards/cells/TimeTrackingCell.tsx \
  src/components/boards/cells/TimeTrackingCell.test.tsx \
  src/components/boards/cells/index.tsx src/components/boards/BoardTable.tsx
git commit -m "feat(boards): TimeTrackingCell + table wiring (6c)"
```

---

## Task 11: Collapsed-parent rollup wiring

**Files:**

- Modify: `src/components/boards/BoardTable.tsx` (where collapsed-parent rollups render)
- Test: covered by `rollup.test.ts` (Task 7) + Task 12 e2e

Where `BoardTable` renders a collapsed parent's rollup cell (the `rollupCell(...)` call site), special-case `time_tracking` so it uses `rollupTimeTracking` over the children's entries + estimate cell values (because tracked time is in `time_entries`, not `cell_values`):

- [ ] **Step 1: Edit the rollup render path**

```tsx
import { rollupTimeTracking } from "@/lib/boards/rollup";
import { timeEntriesForCell } from "@/lib/boards/cache";

// at the collapsed-parent rollup cell for `column`:
if (column.kind === "time_tracking") {
  const childEntries = childItems.flatMap((c) =>
    timeEntriesForCell(cache, c.id, column.id),
  );
  const estimates = childItems
    .map(
      (c) =>
        (
          cellMap.get(cellKey(c.id, column.id)) as
            | { estimateSeconds?: number }
            | undefined
        )?.estimateSeconds,
    )
    .filter((n): n is number => typeof n === "number");
  const result = rollupTimeTracking(childEntries, estimates, Date.now());
  return <RollupCell result={result} />;
}
// …existing rollupCell(...) path for other kinds…
```

> Use the actual local names in that scope for the child-item list, the cell-value map, and `cellKey` (read the surrounding code first).

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/boards/BoardTable.tsx
git commit -m "feat(boards): collapsed-parent time rollup (6c)"
```

---

## Task 12: e2e + full verification gate

**Files:**

- Create: `tests/e2e/time-tracking.spec.ts` (match the repo's Playwright dir/login helper)

- [ ] **Step 1: Write the e2e spec**

Following an existing boards e2e (e.g. the 6b custom-fields spec) for login + board-creation helpers:

1. Sign in; open/create a board.
2. Add-column menu → "Time tracking" → a Time column appears.
3. Click the cell → start timer → see ▶ become ■ and a running entry; stop → an entry is logged and the cell total > 0.
4. Open the cell → "+ Add time" → enter `1h 30m` for today → list shows it; total increases by 1h 30m.
5. Set estimate `4h` → cell shows `… / 4h`; reload → estimate + entries persist.

- [ ] **Step 2: Run e2e**

Run: `pnpm test:e2e tests/e2e/time-tracking.spec.ts` (use the repo's actual e2e command)
Expected: PASS.

- [ ] **Step 3: Full gate** (working-agreement #4)

Run:

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: all green. Also confirm `get_advisors` is clean (Task 2) and `src/types/database.types.ts` is committed.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/time-tracking.spec.ts
git commit -m "test(e2e): time tracking — timer, manual entry, estimate persistence (6c)"
```

- [ ] **Step 5: Wrap up**

Run `/wrapup` to log a `vault/sessions/` note and bump `vault/00-north-star.md` (Phase 6 → 6c done; next = 6d relations+mirror). Push `develop` when green.

---

## Self-review notes (for the executor)

- **Spec coverage:** column kind (T1,T4) · `time_entries` + RLS + partial-unique + `start_timer` (T2) · timer+manual+edit+delete+estimate actions (T5) · one-running-per-user atomic auto-stop (T2,T6) · flat session list + live tick (T10) · estimate in `cell_values` (T4,T5,T9,T10) · parent rollup (T7,T11) · bounded first-paint load, optimistic + revalidate, no realtime (T8,T9) · tests at every layer (T3,T6,T7,T10,T12). Deferred items (timesheet, grouped breakdown, notes, others' edits, realtime) intentionally have no task.
- **Bound risk:** the board-scoped `time_entries` query is capped at 1000 rows (attachments precedent). On a board exceeding that, totals undercount — documented follow-up is a server-side per-cell aggregate (spec §8). Surface this if a board nears the bound rather than silently truncating.
- **Type consistency:** `ended_at`/`duration_secs` (not `stopped_at`/`duration_ms`) everywhere; `start_timer(p_item_id, p_column_id) → setof time_entries`; cache helpers `prependTimeEntry`/`upsertTimeEntry`/`removeTimeEntry`/`timeEntriesForCell`; rollup kind `duration` with `totalSecs`/`estimateSecs`.
  </content>
