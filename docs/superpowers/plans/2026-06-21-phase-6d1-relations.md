# Phase 6d-1 — Relations (Connect Boards) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `relation` column kind that links a board item to one or more items on a configured target board, rendered as chips with an RLS-scoped item picker.

**Architecture:** A `relation_links` side table (mirroring `time_entries`) holds the links; a `SECURITY DEFINER` `set_relation_links` RPC does an atomic replace gated on `can_edit_board`. First paint loads links + linked-item names via a two-query JS join (RLS-filtered by the target board). A standalone `RelationCell` + `RelationPicker` are dispatched from `BoardTable` via a cache selector, exactly like the Files/TimeTracking side-table cells.

**Tech Stack:** Next.js 16 (App Router, RSC + Server Actions), Supabase Postgres + RLS, `@supabase/ssr`, Zustand board cache, Zod, Vitest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-06-21-phase-6d1-relations-design.md`

---

## File Structure

| File                                                    | Task | Responsibility                                                       |
| ------------------------------------------------------- | ---- | -------------------------------------------------------------------- |
| `supabase/migrations/20260621000000_relation_enum.sql`  | 1    | `alter type column_kind add value 'relation'` (own migration)        |
| `supabase/migrations/20260621000001_relation_links.sql` | 1    | `relation_links` table + indexes + RLS + `set_relation_links` RPC    |
| `src/types/database.types.ts`                           | 1    | regenerated (enum + table + RPC signatures)                          |
| `src/lib/boards/relations.ts`                           | 1    | shared TS contract: `RelationLink`, `RelationSettings`, pure helpers |
| `src/lib/boards/relations.test.ts`                      | 1    | unit tests for the pure helpers                                      |
| `src/lib/boards/relation-links.rls.integration.test.ts` | 1    | RPC + cross-board RLS behaviour                                      |
| `src/lib/boards/column-kinds.ts`                        | 2    | add `relation` to `COLUMN_KIND_META` + `COLUMN_KIND_ORDER`           |
| `src/lib/validations/boards.ts`                         | 2    | `relation` in `columnKindSchema` + settings/value schemas            |
| `src/lib/validations/boards.test.ts`                    | 2    | schema unit tests                                                    |
| `src/lib/boards/queries.ts`                             | 3    | load `relation_links` + linked names into the board payload          |
| `src/lib/boards/queries.test.ts` (or co-located)        | 3    | payload-shape unit test                                              |
| `src/lib/validations/board-actions.ts`                  | 4    | `setRelationLinksSchema`                                             |
| `src/lib/boards/relation-actions.ts`                    | 4    | `setRelationLinks` server action                                     |
| `src/lib/boards/relation-actions.test.ts`               | 4    | action validation/branch unit tests                                  |
| `src/components/boards/cells/RelationCell.tsx`          | 5    | presentational chips + "+N more" + rollup                            |
| `src/components/boards/cells/RelationCell.test.tsx`     | 5    | render/overflow/rollup unit tests                                    |
| `src/components/boards/cells/RelationPicker.tsx`        | 6    | popover: search + RLS-scoped checkbox list                           |
| `src/components/boards/cells/RelationPicker.test.tsx`   | 6    | picker render + toggle callbacks                                     |
| `src/lib/boards/relation-candidates.ts`                 | 6    | `listRelationCandidates(targetBoardId, search)` bounded query        |
| `src/components/boards/AddColumnMenu.tsx` (or equiv.)   | 7    | relation config: target-board select + allow-multiple toggle         |
| `src/components/boards/RelationColumnConfig.tsx`        | 7    | the config sub-form (own file)                                       |
| `src/components/boards/RelationColumnConfig.test.tsx`   | 7    | config form unit tests                                               |
| `src/components/boards/BoardTable.tsx`                  | 8    | dispatch `RelationCell` + picker popover state + cache selector      |
| `src/stores/board-cache.ts` (or equiv.)                 | 3,8  | hold `relationLinks` in the live cache + `relationLinksForCell`      |
| `e2e/relations.spec.ts`                                 | 8    | add relation column → link an item → chip renders                    |

> The exact add-column file (Task 7) and board-cache store file (Tasks 3/8) must be confirmed by grep at execution time — see each task's "Orient" step. Do not assume; follow the existing Files/TimeTracking wiring.

## Execution DAG

```
Batch A:  Task 1 ── DB + types + contract (ROOT)

Batch B (parallel, each depends only on Task 1):
          Task 2 ── registry + validation     (TS only)
          Task 3 ── first-paint payload load   (queries + cache field)
          Task 4 ── server action              (RPC wrapper)
          Task 5 ── RelationCell + rollup       (consumes Task-1 contract type, NOT Task 3 runtime)

Batch C (parallel):
          Task 6 ── RelationPicker + candidates query   (needs 2 + 4)
          Task 7 ── add-column relation config           (needs 2)

Batch D:  Task 8 ── BoardTable wiring + e2e + full gate  (needs 3 + 5 + 6 + 7)
```

- **Dependencies:** 1→{2,3,4,5}; {2,4}→6; 2→7; {3,5,6,7}→8.
- **Parallel batches:** **[1]** → **[2,3,4,5]** (4-wide) → **[6,7]** (2-wide) → **[8]**.
- **Critical path:** 1 → 4 → 6 → 8 (four hops) — the real wall-clock floor.
- **Worktrees:** Batch B and Batch C tasks touch disjoint files but share the `develop` checkout. Dispatch each concurrent task in its own git worktree (`superpowers:using-git-worktrees`), then land sequentially. Task 1 lands first on `develop` and the others branch from it. **NOTE — known trap:** workflow subagents are sandboxed to the project root and cannot write into sibling worktree dirs ([[2026-06-21-gotcha-28-subagents-cant-write-outside-primary-dir]]). If worktree dispatch fails the same way, fall back to running the Batch-B implementers serially in the main checkout, committing each by path — that is the proven path from the invite-acceptance session.

> **Migration application (Tasks 1):** Two cloud migrations are applied via `supabase db push --linked` (manual auth gate — coordinate with Danijel). The enum migration MUST land and commit before the table migration runs, because `alter type … add value` cannot be used in the same transaction that references the new value.

---

## Task 1: DB foundation + typed contract (ROOT)

**Files:**

- Create: `supabase/migrations/20260621000000_relation_enum.sql`
- Create: `supabase/migrations/20260621000001_relation_links.sql`
- Modify (regenerate): `src/types/database.types.ts`
- Create: `src/lib/boards/relations.ts`
- Create: `src/lib/boards/relations.test.ts`
- Create: `src/lib/boards/relation-links.rls.integration.test.ts`

- [ ] **Step 1: Orient.** Run `ls supabase/migrations | tail -3` and confirm `20260621000000`/`20260621000001` sort last; bump the prefixes if a newer migration landed. Read `supabase/migrations/20260620000001_time_entries.sql` (the side-table precedent) and `supabase/migrations/20260620100000_board_level_sharing.sql:25-49` (the `can_read_board`/`can_edit_board` helpers).

- [ ] **Step 2: Write the enum migration.**

`supabase/migrations/20260621000000_relation_enum.sql`:

```sql
-- Phase 6d-1: relation column kind. Enum value added in its own migration so it
-- is committed before any migration references it (alter type … add value cannot
-- be used in the same transaction that uses the new value). Mirrors 6c's
-- 20260620000000_time_tracking_enum.sql.
alter type public.column_kind add value if not exists 'relation';
```

- [ ] **Step 3: Write the table + RLS + RPC migration.**

`supabase/migrations/20260621000001_relation_links.sql`:

```sql
-- Phase 6d-1: relation links. One row per (owning item, relation column, linked
-- target item). board_id is the OWNING item's board (denormalized like
-- time_entries) so RLS keys off can_read_board/can_edit_board directly.
create table public.relation_links (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations (id) on delete cascade,
  board_id       uuid not null references public.boards (id)        on delete cascade,
  item_id        uuid not null references public.items (id)         on delete cascade,
  column_id      uuid not null references public.columns (id)       on delete cascade,
  linked_item_id uuid not null references public.items (id)         on delete cascade,
  position       int  not null default 0,
  created_at     timestamptz not null default now(),
  unique (item_id, column_id, linked_item_id),
  check (item_id <> linked_item_id)
);

create index relation_links_item_column_idx on public.relation_links (item_id, column_id);
create index relation_links_board_idx       on public.relation_links (board_id);
create index relation_links_linked_idx      on public.relation_links (linked_item_id);

alter table public.relation_links enable row level security;

-- Read/write gate on the OWNING board (the linked-item name is RLS-filtered
-- separately when the client joins relation_links → items for the chip label).
create policy "relation_links: read if can read board" on public.relation_links
  for select to authenticated using (public.can_read_board(board_id));
create policy "relation_links: write if can edit board" on public.relation_links
  for all to authenticated
  using (public.can_edit_board(board_id))
  with check (public.is_org_member(org_id) and public.can_edit_board(board_id));

grant select, insert, update, delete on public.relation_links to authenticated;
-- intentionally NOT added to supabase_realtime (v1 = optimistic + revalidate).

-- Atomic replace: validate the column + target board, enforce allow_multiple,
-- delete the cell's existing links, insert the new set with position = index.
create or replace function public.set_relation_links(
  p_item_id uuid,
  p_column_id uuid,
  p_linked_item_ids uuid[]
) returns setof public.relation_links
language plpgsql security definer set search_path = '' as $$
declare
  v_uid       uuid := (select auth.uid());
  v_org_id    uuid;
  v_board_id  uuid;
  v_kind      public.column_kind;
  v_settings  jsonb;
  v_target    uuid;
  v_multiple  boolean;
  v_ids       uuid[];
  v_id        uuid;
  v_pos       int := 0;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  select org_id, board_id into v_org_id, v_board_id
  from public.items where id = p_item_id;
  if v_org_id is null then raise exception 'Item not found'; end if;
  if not public.can_edit_board(v_board_id) then raise exception 'Not authorized'; end if;

  select kind, settings into v_kind, v_settings from public.columns
  where id = p_column_id and board_id = v_board_id;
  if v_kind is null then raise exception 'Column not found'; end if;
  if v_kind <> 'relation' then raise exception 'Not a relation column'; end if;

  v_target   := (v_settings ->> 'target_board_id')::uuid;
  v_multiple := coalesce((v_settings ->> 'allow_multiple')::boolean, true);
  if v_target is null then raise exception 'Relation column has no target board'; end if;

  -- de-dup while preserving first-seen order
  select array_agg(x order by ord) into v_ids
  from (
    select x, min(ord) as ord
    from unnest(p_linked_item_ids) with ordinality as u(x, ord)
    group by x
  ) d;
  v_ids := coalesce(v_ids, '{}'::uuid[]);

  if not v_multiple and array_length(v_ids, 1) > 1 then
    raise exception 'This relation allows only a single linked item';
  end if;

  -- every linked id must be a real item on the target board, and not self
  if exists (
    select 1 from unnest(v_ids) as u(x)
    where x = p_item_id
       or not exists (
         select 1 from public.items i
         where i.id = u.x and i.board_id = v_target
       )
  ) then
    raise exception 'Linked item is not on the target board';
  end if;

  delete from public.relation_links
   where item_id = p_item_id and column_id = p_column_id;

  foreach v_id in array v_ids loop
    insert into public.relation_links
      (org_id, board_id, item_id, column_id, linked_item_id, position)
      values (v_org_id, v_board_id, p_item_id, p_column_id, v_id, v_pos);
    v_pos := v_pos + 1;
  end loop;

  return query
    select * from public.relation_links
    where item_id = p_item_id and column_id = p_column_id
    order by position;
end;
$$;

revoke all on function public.set_relation_links(uuid, uuid, uuid[]) from public;
grant execute on function public.set_relation_links(uuid, uuid, uuid[]) to authenticated;
```

- [ ] **Step 4: Apply migrations + regenerate types.** Coordinate the manual auth gate, then:

Run: `supabase db push --linked` (applies both, enum first by filename order)
Run: `pnpm db:types` (regenerates `src/types/database.types.ts`; if a PostHog telemetry line leaks, filter `'"_tag"'` before prettier per the operations note)
Expected: `relation` appears in the `column_kind` enum union; `relation_links` Row/Insert types and the `set_relation_links` function signature appear.

- [ ] **Step 5: Write the shared TS contract.**

`src/lib/boards/relations.ts`:

```ts
import type { Tables } from "@/types/database.types";

export type RelationLinkRow = Tables<"relation_links">;

/** A relation link as the UI consumes it (linked name resolved client-side). */
export type RelationLink = {
  id: string;
  itemId: string;
  columnId: string;
  linkedItemId: string;
  /** null when the target board is not readable by the caller (RLS-filtered). */
  linkedItemName: string | null;
  position: number;
};

export type RelationSettings = {
  targetBoardId: string;
  allowMultiple: boolean;
};

/** Sort links by stored position (stable for chip rendering). */
export function sortLinks(links: RelationLink[]): RelationLink[] {
  return [...links].sort((a, b) => a.position - b.position);
}

/** Collapsed-parent rollup label, e.g. "3 linked" / "1 linked" / "". */
export function relationRollup(links: RelationLink[]): string {
  const n = new Set(links.map((l) => l.linkedItemId)).size;
  return n === 0 ? "" : `${n} linked`;
}
```

- [ ] **Step 6: Write the contract unit tests + run.**

`src/lib/boards/relations.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { sortLinks, relationRollup, type RelationLink } from "./relations";

const mk = (id: string, pos: number): RelationLink => ({
  id,
  itemId: "i1",
  columnId: "c1",
  linkedItemId: `t-${id}`,
  linkedItemName: id,
  position: pos,
});

describe("relations helpers", () => {
  it("sorts by position", () => {
    const out = sortLinks([mk("b", 2), mk("a", 0), mk("c", 1)]);
    expect(out.map((l) => l.id)).toEqual(["a", "c", "b"]);
  });
  it("rollup counts distinct linked items", () => {
    expect(relationRollup([])).toBe("");
    expect(relationRollup([mk("a", 0)])).toBe("1 linked");
    expect(relationRollup([mk("a", 0), mk("b", 1), mk("c", 2)])).toBe(
      "3 linked",
    );
  });
});
```

Run: `pnpm vitest run src/lib/boards/relations.test.ts`
Expected: PASS (4 assertions).

- [ ] **Step 7: Write the RLS integration test.** Model it on `src/lib/boards/board-sharing-satellites.rls.integration.test.ts` (two-user, `signInWithRetry`). Cover, against the live DB:
  1. Owner of board A with a `relation` column targeting board B can `set_relation_links` and read back the rows.
  2. `allow_multiple=false` → calling with 2 ids raises.
  3. A non-member of board B (but member of board A) can read the link rows but a `relation_links → items(name)` embed/join returns `null` for `linked_item_id` (target name RLS-filtered).
  4. Self-link (`linked_item_id = item_id`) raises.
  5. A user who can only _read_ board A (viewer) cannot `set_relation_links` (raises — `can_edit_board` false).
  6. Deleting a linked target item removes the link row (FK cascade).

```ts
// Skeleton — fill bodies following the satellites test's provisionUser/signInWithRetry helpers.
import { describe, it, expect, beforeAll } from "vitest";
// ... reuse helpers: createAnonClient, signInWithRetry, provision two boards A (owner) + B (target)

describe("relation_links RLS + set_relation_links RPC", () => {
  it("owner links target-board items and reads them back", async () => {
    const { data, error } = await ownerA.rpc("set_relation_links", {
      p_item_id: itemA,
      p_column_id: relColId,
      p_linked_item_ids: [itemB1, itemB2],
    });
    expect(error).toBeNull();
    expect(data).toHaveLength(2);
  });

  it("rejects multiple ids when allow_multiple is false", async () => {
    const { error } = await ownerA.rpc("set_relation_links", {
      p_item_id: itemSingle,
      p_column_id: singleRelColId,
      p_linked_item_ids: [itemB1, itemB2],
    });
    expect(error).not.toBeNull();
  });

  it("hides linked-item name from a non-member of the target board", async () => {
    // outsider is a member of board A but NOT board B
    const { data } = await outsider
      .from("relation_links")
      .select(
        "id, linked_item_id, items!relation_links_linked_item_id_fkey(name)",
      )
      .eq("item_id", itemA);
    // link row visible (board A readable), but joined target name RLS-filtered to null
    expect(data?.[0]?.items).toBeNull();
  });

  it("rejects a self-link", async () => {
    const { error } = await ownerA.rpc("set_relation_links", {
      p_item_id: itemA,
      p_column_id: relColId,
      p_linked_item_ids: [itemA],
    });
    expect(error).not.toBeNull();
  });

  it("denies set_relation_links to a viewer of the owning board", async () => {
    const { error } = await viewerA.rpc("set_relation_links", {
      p_item_id: itemA,
      p_column_id: relColId,
      p_linked_item_ids: [itemB1],
    });
    expect(error).not.toBeNull();
  });
});
```

Run: `pnpm vitest run --project integration src/lib/boards/relation-links.rls.integration.test.ts`
Expected: PASS (5+ cases). (If the full suite later flakes on GoTrue 429, this file passing in isolation is the source of truth — see gotcha-24.)

- [ ] **Step 8: Commit.**

```bash
git add supabase/migrations/20260621000000_relation_enum.sql \
        supabase/migrations/20260621000001_relation_links.sql \
        src/types/database.types.ts \
        src/lib/boards/relations.ts src/lib/boards/relations.test.ts \
        src/lib/boards/relation-links.rls.integration.test.ts
git commit -m "feat(boards): relation_links table + set_relation_links RPC + contract"
```

---

## Task 2: Registry + validation (Batch B — depends on Task 1 types)

**Files:**

- Modify: `src/lib/boards/column-kinds.ts`
- Modify: `src/lib/validations/boards.ts`
- Test: `src/lib/validations/boards.test.ts`

- [ ] **Step 1: Add the registry entry.** In `src/lib/boards/column-kinds.ts`: add `GitBranch` (or `Link2`) to the lucide import, add `relation: { label: "Relation", Icon: GitBranch, hasOptions: false }` to `COLUMN_KIND_META`, and append `"relation"` to `COLUMN_KIND_ORDER`. (The existing `column-kinds.test.ts` parity test will fail until both are present — that is the failing test for this step.)

```ts
// import line: add GitBranch
import { /* …existing… */ GitBranch } from "lucide-react";
// in COLUMN_KIND_META, after time_tracking:
  relation: { label: "Relation", Icon: GitBranch, hasOptions: false },
// in COLUMN_KIND_ORDER, append:
  "relation",
```

- [ ] **Step 2: Run the parity test to confirm it now passes.**

Run: `pnpm vitest run src/lib/boards/column-kinds.test.ts`
Expected: PASS (META/ORDER parity holds with the new kind).

- [ ] **Step 3: Extend the validation schemas.** In `src/lib/validations/boards.ts`:

```ts
// 1) add "relation" to columnKindSchema's enum array (after "time_tracking").

// 2) relation settings schema (place near numbersSettingsSchema):
export const relationSettingsSchema = z.object({
  target_board_id: z.string().uuid(),
  allow_multiple: z.boolean().default(true),
});

// 3) in columnSettingsSchema(kind) switch, add a dedicated case BEFORE the
//    empty-settings group:
    case "relation":
      return relationSettingsSchema;

// 4) relation cell value: no cell_values row (content derives from
//    relation_links), mirroring filesValueSchema. Place near filesValueSchema:
export const relationValueSchema = z.object({}).strict();

// 5) in cellValueSchema(kind) switch, add:
    case "relation":
      return relationValueSchema;
```

- [ ] **Step 4: Write schema unit tests.** Append to `src/lib/validations/boards.test.ts` (create if absent):

```ts
import { describe, it, expect } from "vitest";
import { columnKindSchema, columnSettingsSchema } from "./boards";

describe("relation column validation", () => {
  it("accepts relation as a kind", () => {
    expect(columnKindSchema.safeParse("relation").success).toBe(true);
  });
  it("requires a target_board_id uuid", () => {
    const s = columnSettingsSchema("relation");
    expect(s.safeParse({ target_board_id: "not-a-uuid" }).success).toBe(false);
    expect(
      s.safeParse({ target_board_id: "00000000-0000-0000-0000-000000000000" })
        .success,
    ).toBe(true);
  });
  it("defaults allow_multiple to true", () => {
    const parsed = columnSettingsSchema("relation").parse({
      target_board_id: "00000000-0000-0000-0000-000000000000",
    });
    expect((parsed as { allow_multiple: boolean }).allow_multiple).toBe(true);
  });
});
```

- [ ] **Step 5: Run + typecheck + commit.**

Run: `pnpm vitest run src/lib/validations/boards.test.ts && pnpm typecheck`
Expected: PASS, 0 type errors.

```bash
git add src/lib/boards/column-kinds.ts src/lib/validations/boards.ts src/lib/validations/boards.test.ts
git commit -m "feat(boards): register relation column kind + settings/value schemas"
```

---

## Task 3: First-paint payload load + cache field (Batch B — depends on Task 1)

**Files:**

- Modify: `src/lib/boards/queries.ts` (the `Promise.all` board loader, around `:148-202`)
- Modify: the board cache store (grep: `rg -l "timeEntriesForCell|attachments" src/stores src/components/boards`)
- Test: co-located unit test for the link-mapping helper

- [ ] **Step 1: Orient.** Read `src/lib/boards/queries.ts:140-202` (the loader returning `{ board, groups, columns, items, cellValues, views, dependencies, attachments, timeEntries }`) and `listOrgMembers` (`:219+`, the two-query JS-join idiom — relation needs the same because linked items live on another board with no PostgREST FK embed that typechecks cross-board cleanly).

- [ ] **Step 2: Load relation links in the board payload.** In the `Promise.all`, add after the `time_entries` query:

```ts
    supabase
      .from("relation_links")
      .select("*")
      .eq("board_id", boardId)
      .order("position", { ascending: true }),
```

Destructure its result (`relationLinksRes`). Then resolve linked-item names with a bounded second query (RLS auto-filters to readable target boards):

```ts
const rawLinks = relationLinksRes.data ?? [];
const linkedIds = [...new Set(rawLinks.map((l) => l.linked_item_id))];
const namesById = new Map<string, string>();
if (linkedIds.length > 0) {
  const { data: linkedItems } = await supabase
    .from("items")
    .select("id, name")
    .in("id", linkedIds);
  for (const it of linkedItems ?? []) namesById.set(it.id, it.name);
}
const relationLinks: RelationLink[] = rawLinks.map((l) => ({
  id: l.id,
  itemId: l.item_id,
  columnId: l.column_id,
  linkedItemId: l.linked_item_id,
  linkedItemName: namesById.get(l.linked_item_id) ?? null,
  position: l.position,
}));
```

Add `relationLinks` to the returned object and import `RelationLink` from `@/lib/boards/relations`.

- [ ] **Step 3: Add `relationLinks` to the board cache + selector.** In the cache store, add a `relationLinks: RelationLink[]` field initialized from the payload (mirror how `timeEntries`/`attachments` are seeded), and export a selector:

```ts
export function relationLinksForCell(
  cache: { relationLinks: RelationLink[] },
  itemId: string,
  columnId: string,
): RelationLink[] {
  return cache.relationLinks.filter(
    (l) => l.itemId === itemId && l.columnId === columnId,
  );
}
```

- [ ] **Step 4: Unit-test the selector + name mapping.**

```ts
import { describe, it, expect } from "vitest";
import { relationLinksForCell } from "<cache-store-path>";

describe("relationLinksForCell", () => {
  it("filters to one cell's links", () => {
    const cache = {
      relationLinks: [
        {
          id: "1",
          itemId: "a",
          columnId: "x",
          linkedItemId: "t1",
          linkedItemName: "T1",
          position: 0,
        },
        {
          id: "2",
          itemId: "a",
          columnId: "y",
          linkedItemId: "t2",
          linkedItemName: "T2",
          position: 0,
        },
        {
          id: "3",
          itemId: "b",
          columnId: "x",
          linkedItemId: "t3",
          linkedItemName: "T3",
          position: 0,
        },
      ],
    };
    expect(relationLinksForCell(cache, "a", "x").map((l) => l.id)).toEqual([
      "1",
    ]);
  });
});
```

Run: `pnpm vitest run <that test> && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/boards/queries.ts <cache-store-path> <test-path>
git commit -m "feat(boards): hydrate relation links + names into the board payload"
```

---

## Task 4: Server action (Batch B — depends on Task 1 RPC)

**Files:**

- Modify: `src/lib/validations/board-actions.ts`
- Create: `src/lib/boards/relation-actions.ts`
- Test: `src/lib/boards/relation-actions.test.ts`

- [ ] **Step 1: Add the validation schema.** In `src/lib/validations/board-actions.ts`:

```ts
export const setRelationLinksSchema = z.object({
  itemId: z.string().uuid(),
  columnId: z.string().uuid(),
  linkedItemIds: z.array(z.string().uuid()).max(200),
});
```

- [ ] **Step 2: Write the failing action test.** `src/lib/boards/relation-actions.test.ts` — mock `@/lib/supabase/server` (follow the mock shape in `src/lib/boards/relation-actions` siblings; if no action unit-test precedent exists, assert validation + the rpc/revalidate call):

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const rpc = vi.fn();
const from = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc, from }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { setRelationLinks } from "./relation-actions";

beforeEach(() => {
  rpc.mockReset();
  from.mockReset();
  from.mockReturnValue({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({ data: { org_id: "o1", board_id: "b1" } }),
      }),
    }),
  });
});

describe("setRelationLinks", () => {
  it("rejects a non-uuid itemId", async () => {
    const res = await setRelationLinks({
      itemId: "x",
      columnId: "00000000-0000-0000-0000-000000000000",
      linkedItemIds: [],
    });
    expect(res.ok).toBe(false);
  });
  it("calls the RPC and revalidates on success", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    const res = await setRelationLinks({
      itemId: "00000000-0000-0000-0000-000000000001",
      columnId: "00000000-0000-0000-0000-000000000002",
      linkedItemIds: ["00000000-0000-0000-0000-000000000003"],
    });
    expect(res.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("set_relation_links", {
      p_item_id: "00000000-0000-0000-0000-000000000001",
      p_column_id: "00000000-0000-0000-0000-000000000002",
      p_linked_item_ids: ["00000000-0000-0000-0000-000000000003"],
    });
  });
});
```

Run: `pnpm vitest run src/lib/boards/relation-actions.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the action.** `src/lib/boards/relation-actions.ts` (mirror `time-actions.ts`):

```ts
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/types/database.types";
import { setRelationLinksSchema } from "@/lib/validations/board-actions";
import type { ActionResult } from "@/lib/boards/actions";

type RelationLinkRow = Tables<"relation_links">;

function fail(message: string): { ok: false; error: string } {
  return { ok: false, error: message };
}

/** Replace a relation cell's links (link/unlink/reorder in one call). */
export async function setRelationLinks(input: {
  itemId: string;
  columnId: string;
  linkedItemIds: string[];
}): Promise<ActionResult<{ links: RelationLinkRow[] }>> {
  const parsed = setRelationLinksSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const { data: item } = await supabase
    .from("items")
    .select("board_id")
    .eq("id", parsed.data.itemId)
    .maybeSingle();
  if (!item) return fail("Item not found.");

  const { data, error } = await supabase.rpc("set_relation_links", {
    p_item_id: parsed.data.itemId,
    p_column_id: parsed.data.columnId,
    p_linked_item_ids: parsed.data.linkedItemIds,
  });
  if (error) return fail(error.message);

  revalidatePath(`/boards/${item.board_id}`);
  return { ok: true, data: { links: (data ?? []) as RelationLinkRow[] } };
}
```

- [ ] **Step 4: Run + commit.**

Run: `pnpm vitest run src/lib/boards/relation-actions.test.ts && pnpm typecheck`
Expected: PASS, 0 type errors.

```bash
git add src/lib/validations/board-actions.ts src/lib/boards/relation-actions.ts src/lib/boards/relation-actions.test.ts
git commit -m "feat(boards): setRelationLinks server action"
```

---

## Task 5: RelationCell + rollup (Batch B — depends on Task 1 contract)

**Files:**

- Create: `src/components/boards/cells/RelationCell.tsx`
- Test: `src/components/boards/cells/RelationCell.test.tsx`

- [ ] **Step 1: Orient.** Read an existing presentational side-table cell (`src/components/boards/cells/FilesCell.tsx`) for styling conventions, and `src/lib/boards/cells/contrast.ts` usage. The cell consumes `RelationLink[]` props only (no store access) so it is parallel-safe.

- [ ] **Step 2: Write the failing test.** `src/components/boards/cells/RelationCell.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RelationCell } from "./RelationCell";
import type { RelationLink } from "@/lib/boards/relations";

const mk = (id: string, name: string | null, pos: number): RelationLink => ({
  id,
  itemId: "i",
  columnId: "c",
  linkedItemId: `t-${id}`,
  linkedItemName: name,
  position: pos,
});

describe("RelationCell", () => {
  it("renders a chip per linked item up to the cap", () => {
    render(
      <RelationCell
        links={[mk("a", "Acquisition Q3", 0)]}
        onOpen={() => {}}
        maxChips={2}
      />,
    );
    expect(screen.getByText("Acquisition Q3")).toBeInTheDocument();
  });
  it("collapses overflow into +N more", () => {
    render(
      <RelationCell
        links={[
          mk("a", "A", 0),
          mk("b", "B", 1),
          mk("c", "C", 2),
          mk("d", "D", 3),
        ]}
        onOpen={() => {}}
        maxChips={2}
      />,
    );
    expect(screen.getByText("+2 more")).toBeInTheDocument();
  });
  it("omits chips whose linked name is RLS-filtered (null)", () => {
    render(
      <RelationCell
        links={[mk("a", null, 0)]}
        onOpen={() => {}}
        maxChips={2}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /linked/i }),
    ).not.toBeInTheDocument();
  });
});
```

Run: `pnpm vitest run src/components/boards/cells/RelationCell.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the cell.** `src/components/boards/cells/RelationCell.tsx`:

```tsx
"use client";

import { Plus } from "lucide-react";
import { sortLinks, type RelationLink } from "@/lib/boards/relations";

export function RelationCell({
  links,
  onOpen,
  maxChips = 2,
  readOnly = false,
}: {
  links: RelationLink[];
  onOpen: () => void;
  maxChips?: number;
  readOnly?: boolean;
}) {
  // Drop links whose target name is RLS-filtered (not readable by this user).
  const visible = sortLinks(links).filter((l) => l.linkedItemName !== null);
  const shown = visible.slice(0, maxChips);
  const overflow = visible.length - shown.length;

  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={readOnly}
      className="flex h-full w-full items-center gap-1.5 overflow-hidden px-1 text-left"
    >
      {shown.map((l) => (
        <span
          key={l.id}
          className="bg-surface inline-flex max-w-[140px] items-center gap-1.5 truncate rounded-md border px-2 py-0.5 text-xs"
        >
          <span className="bg-primary size-2 shrink-0 rounded-full" />
          <span className="truncate">{l.linkedItemName}</span>
        </span>
      ))}
      {overflow > 0 && (
        <span className="text-muted-foreground text-xs">+{overflow} more</span>
      )}
      {!readOnly && shown.length === 0 && overflow === 0 && (
        <span className="text-muted-foreground inline-flex size-5 items-center justify-center rounded border border-dashed">
          <Plus className="size-3.5" />
        </span>
      )}
    </button>
  );
}
```

- [ ] **Step 4: Run + commit.**

Run: `pnpm vitest run src/components/boards/cells/RelationCell.test.tsx && pnpm typecheck`
Expected: PASS, 0 type errors.

```bash
git add src/components/boards/cells/RelationCell.tsx src/components/boards/cells/RelationCell.test.tsx
git commit -m "feat(boards): RelationCell chips + overflow"
```

---

## Task 6: RelationPicker + candidates query (Batch C — depends on Tasks 2 + 4)

**Files:**

- Create: `src/lib/boards/relation-candidates.ts`
- Create: `src/components/boards/cells/RelationPicker.tsx`
- Test: `src/components/boards/cells/RelationPicker.test.tsx`

- [ ] **Step 1: Bounded candidates query.** `src/lib/boards/relation-candidates.ts`:

```ts
import { createClient } from "@/lib/supabase/server";

export type RelationCandidate = { id: string; name: string };

/** Target-board items the caller can read, bounded for the picker. RLS scopes
 *  to readable boards; search is a prefix/contains filter on name. */
export async function listRelationCandidates(
  targetBoardId: string,
  search = "",
  limit = 50,
): Promise<RelationCandidate[]> {
  const supabase = await createClient();
  let q = supabase
    .from("items")
    .select("id, name")
    .eq("board_id", targetBoardId)
    .order("position", { ascending: true })
    .limit(limit);
  if (search.trim()) q = q.ilike("name", `%${search.trim()}%`);
  const { data } = await q;
  return data ?? [];
}
```

> Note: this is bounded to `limit` (default 50). On boards larger than the limit, only the first matches show — `log`/document this cap; search narrows it. (Spec "Open risks".)

- [ ] **Step 2: Failing picker test.** `src/components/boards/cells/RelationPicker.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RelationPicker } from "./RelationPicker";

describe("RelationPicker", () => {
  it("renders candidates and toggles selection", () => {
    const onToggle = vi.fn();
    render(
      <RelationPicker
        candidates={[
          { id: "b1", name: "Acquisition Q3" },
          { id: "b2", name: "Mobile App" },
        ]}
        selectedIds={["b1"]}
        onToggle={onToggle}
        onSearch={() => {}}
        allowMultiple
      />,
    );
    expect(screen.getByText("Acquisition Q3")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Mobile App"));
    expect(onToggle).toHaveBeenCalledWith("b2");
  });
});
```

Run: `pnpm vitest run src/components/boards/cells/RelationPicker.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the picker** (presentational; data fetched by the parent via `listRelationCandidates` and passed in). `src/components/boards/cells/RelationPicker.tsx`:

```tsx
"use client";

import { Search, Check } from "lucide-react";
import type { RelationCandidate } from "@/lib/boards/relation-candidates";

export function RelationPicker({
  candidates,
  selectedIds,
  onToggle,
  onSearch,
  allowMultiple,
}: {
  candidates: RelationCandidate[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  onSearch: (q: string) => void;
  allowMultiple: boolean;
}) {
  const selected = new Set(selectedIds);
  return (
    <div className="w-[300px]">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Search className="text-muted-foreground size-4" />
        <input
          autoFocus
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search…"
          className="w-full bg-transparent text-sm outline-none"
        />
      </div>
      <ul className="max-h-64 overflow-y-auto py-1">
        {candidates.map((c) => {
          const on = selected.has(c.id);
          return (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => onToggle(c.id)}
                className="hover:bg-accent flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm"
              >
                <span
                  className={
                    "flex size-4 items-center justify-center rounded border " +
                    (on
                      ? "bg-primary border-primary text-primary-foreground"
                      : "")
                  }
                >
                  {on && <Check className="size-3" />}
                </span>
                <span className="truncate">{c.name}</span>
                {!allowMultiple && on && (
                  <span className="text-muted-foreground ml-auto text-xs">
                    selected
                  </span>
                )}
              </button>
            </li>
          );
        })}
        {candidates.length === 0 && (
          <li className="text-muted-foreground px-3 py-3 text-xs">
            No items found.
          </li>
        )}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Run + commit.**

Run: `pnpm vitest run src/components/boards/cells/RelationPicker.test.tsx && pnpm typecheck`
Expected: PASS, 0 type errors.

```bash
git add src/lib/boards/relation-candidates.ts src/components/boards/cells/RelationPicker.tsx src/components/boards/cells/RelationPicker.test.tsx
git commit -m "feat(boards): RelationPicker + bounded candidates query"
```

---

## Task 7: Add-column relation config (Batch C — depends on Task 2)

**Files:**

- Create: `src/components/boards/RelationColumnConfig.tsx`
- Test: `src/components/boards/RelationColumnConfig.test.tsx`
- Modify: the add-column flow (grep: `rg -l "COLUMN_KIND_ORDER|hasOptions|Add column" src/components/boards`)

- [ ] **Step 1: Orient.** Find where a new column is created and where `COLUMN_KIND_META[kind].hasOptions` is consulted (the option-aware add flow from 6b). Relation needs an analogous "this kind needs config before creating" branch: when `kind === "relation"`, show `RelationColumnConfig` (target board + allow-multiple) before calling the create action, and pass `settings: { target_board_id, allow_multiple }`.

- [ ] **Step 2: Failing config test.** `src/components/boards/RelationColumnConfig.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RelationColumnConfig } from "./RelationColumnConfig";

describe("RelationColumnConfig", () => {
  it("requires a target board before confirming", () => {
    const onConfirm = vi.fn();
    render(
      <RelationColumnConfig
        boards={[{ id: "b2", name: "Projects" }]}
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /add|create|confirm/i }),
    );
    expect(onConfirm).not.toHaveBeenCalled(); // no board chosen yet
  });

  it("confirms with target board + allow_multiple", () => {
    const onConfirm = vi.fn();
    render(
      <RelationColumnConfig
        boards={[{ id: "b2", name: "Projects" }]}
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText(/board/i), {
      target: { value: "b2" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /add|create|confirm/i }),
    );
    expect(onConfirm).toHaveBeenCalledWith({
      target_board_id: "b2",
      allow_multiple: true,
    });
  });
});
```

Run: `pnpm vitest run src/components/boards/RelationColumnConfig.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the config form.** `src/components/boards/RelationColumnConfig.tsx`:

```tsx
"use client";

import { useState } from "react";

export function RelationColumnConfig({
  boards,
  onConfirm,
  onCancel,
}: {
  boards: { id: string; name: string }[];
  onConfirm: (settings: {
    target_board_id: string;
    allow_multiple: boolean;
  }) => void;
  onCancel: () => void;
}) {
  const [targetBoardId, setTargetBoardId] = useState("");
  const [allowMultiple, setAllowMultiple] = useState(true);

  return (
    <div className="flex flex-col gap-3 p-3">
      <label className="flex flex-col gap-1 text-sm">
        Connect to board
        <select
          aria-label="Connect to board"
          value={targetBoardId}
          onChange={(e) => setTargetBoardId(e.target.value)}
          className="border-border bg-background h-9 rounded-md border px-2 text-sm"
        >
          <option value="">Select a board…</option>
          {boards.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={allowMultiple}
          onChange={(e) => setAllowMultiple(e.target.checked)}
        />
        Allow linking multiple items
      </label>

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="text-sm">
          Cancel
        </button>
        <button
          type="button"
          disabled={!targetBoardId}
          onClick={() =>
            onConfirm({
              target_board_id: targetBoardId,
              allow_multiple: allowMultiple,
            })
          }
          className="bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-sm disabled:opacity-50"
        >
          Add column
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Wire into the add-column flow.** In the add-column component, when the chosen kind is `relation`, render `RelationColumnConfig` (feed it the user's readable boards — reuse the existing board list available to the sidebar/⌘K, or a `listMyBoards()`/`listSharedBoards()` call) and pass the returned settings to the create-column action. Other kinds keep their current path.

- [ ] **Step 5: Run + commit.**

Run: `pnpm vitest run src/components/boards/RelationColumnConfig.test.tsx && pnpm typecheck`
Expected: PASS, 0 type errors.

```bash
git add src/components/boards/RelationColumnConfig.tsx src/components/boards/RelationColumnConfig.test.tsx <add-column-file>
git commit -m "feat(boards): relation column add-config (target board + allow multiple)"
```

---

## Task 8: BoardTable wiring + e2e + full gate (Batch D — depends on 3, 5, 6, 7)

**Files:**

- Modify: `src/components/boards/BoardTable.tsx`
- Create: `e2e/relations.spec.ts`

- [ ] **Step 1: Orient.** Read how `FilesCell` is dispatched in `BoardTable.tsx` (`:1374` region) and how `filesLightbox` popover state works (`:202`, `:472`). Relation mirrors Files: a standalone cell + a popover, no `CellEditor` switch case (the editors switch's `files` case at `editors/index.tsx:619-621` shows Files is handled directly in BoardTable — do the same for relation).

- [ ] **Step 2: Dispatch RelationCell.** In the cell render switch, add a `relation` branch that:
  - reads links via `relationLinksForCell(controls.cache, item.id, column.id)`;
  - renders `<RelationCell links={…} onOpen={() => openRelationPicker(item.id, column.id)} readOnly={!canEdit} />`.

- [ ] **Step 3: Picker popover state.** Add `relationPicker` state (mirroring `filesLightbox`): `{ itemId, columnId } | null`, plus the target board + `allow_multiple` from the column's `settings`. On open, call `listRelationCandidates(targetBoardId, search)`; render `RelationPicker` in a popover anchored to the cell. On toggle, compute the next `linkedItemIds` (respect `allow_multiple`: single → replace; multi → add/remove), optimistically update `controls.cache.relationLinks`, then call `setRelationLinks(...)`; on error, roll back and surface the message.

```tsx
// open candidates lazily when the popover opens
const [candidates, setCandidates] = useState<RelationCandidate[]>([]);
useEffect(() => {
  if (!relationPicker) return;
  let alive = true;
  listRelationCandidates(
    relationPicker.targetBoardId,
    relationPicker.search,
  ).then((c) => {
    if (alive) setCandidates(c);
  });
  return () => {
    alive = false;
  };
}, [relationPicker?.targetBoardId, relationPicker?.search]);
```

> `listRelationCandidates` is a server function — call it from a client component via the established server-action import pattern used elsewhere in BoardTable, or wrap it as a `"use server"` action if direct import isn't already the pattern. Confirm at execution time.

- [ ] **Step 4: Collapsed-parent rollup.** Where collapsed parents show rolled-up cell summaries (the `time_tracking` Σ rollup region, `:977`/`:1087`), add a `relation` case rendering `relationRollup(relationLinksForCell(cache, parentItem.id, column.id))`.

- [ ] **Step 5: Write the e2e.** `e2e/relations.spec.ts` (follow `e2e/` conventions, e.g. the 6c/attachments specs):

```ts
import { test, expect } from "@playwright/test";

test("add a relation column, link an item, see the chip", async ({ page }) => {
  // 1. sign in, open a board (reuse the e2e auth/setup helper)
  // 2. add a column → choose "Relation" → pick the target board → Add column
  // 3. click the relation cell → search → check an item in the picker → close
  // 4. assert a chip with the linked item's name is visible in the cell
  await expect(
    page.getByText(/Acquisition Q3|<seeded linked item name>/),
  ).toBeVisible();
});
```

Run: `pnpm test:e2e e2e/relations.spec.ts` (or the repo's e2e command)
Expected: PASS.

- [ ] **Step 6: Full gate.**

Run:

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: typecheck 0 errors; lint clean; unit tests green (integration flakes only on GoTrue 429 — re-run the relation integration file in isolation to confirm, per gotcha-24); build succeeds.

- [ ] **Step 7: Commit + push.**

```bash
git add src/components/boards/BoardTable.tsx e2e/relations.spec.ts
git commit -m "feat(boards): wire RelationCell + picker into the board table; e2e"
git push origin develop
```

---

## Self-Review notes

- **Spec coverage:** enum+table+RLS+RPC (T1) · registry+settings/value schemas (T2) · 0-round-trip first paint (T3) · single replace write path (T4) · chips+overflow+rollup (T5) · RLS-scoped picker (T6) · target-board+allow-multiple config (T7) · cross-board RLS integration test (T1) · e2e (T8). Mirror/multi-target/two-way explicitly deferred — no tasks, by design.
- **Type consistency:** `RelationLink` (T1) is the single shape consumed by T3 loader, T5 cell, T8 selector; `RelationSettings`/`{target_board_id, allow_multiple}` consistent across T2 schema, T7 config, T1 RPC; action name `setRelationLinks`/RPC `set_relation_links` consistent T1/T4/T8.
- **Open confirmations at execution time (grep, don't assume):** the board-cache store path (T3/T8), the add-column component path (T7), whether `listRelationCandidates` is imported directly or wrapped as a server action (T8). Each task's "Orient" step covers this.
