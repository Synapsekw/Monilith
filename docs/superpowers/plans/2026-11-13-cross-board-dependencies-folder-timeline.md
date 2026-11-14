# Cross-board dependencies + folder Timeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let items depend on items on other boards, show a folder-wide editable Timeline (Gantt) tab, surface cross-board links on the board Gantt as stubs, and add a "Waiting on / Blocking" section to the item panel.

**Architecture:** One migration adds `item_dependencies.predecessor_board_id`, rewrites RLS and `create_item_dependency` for cross-board links, and adds two jsonb RPCs (`folder_timeline`, `board_dependency_context`) built on two private JSON helpers. Pure TS helpers resolve each board's schedule columns and compute cross-board stubs/lateness. The board-agnostic drawing/drag/link part of `GanttBoard` is extracted into `GanttCanvas`, which both the board Gantt and the new folder Timeline tab render.

**Spec:** `docs/superpowers/specs/2026-11-13-cross-board-dependencies-folder-timeline-design.md`

**Tech Stack:** Next.js 16 App Router, React 19, TanStack Query v5, dnd-kit, @tanstack/react-virtual, Supabase Postgres (RLS, plpgsql), Zod, Vitest + Testing Library.

## Global Constraints

- Link type stays finish-to-start only (`type = 'FS'`). No auto-rescheduling, no critical path.
- `item_dependencies.board_id` means **the successor's board**; `predecessor_board_id` is the predecessor's board.
- A link is visible only when the viewer can read **both** boards. Create requires edit on the successor's board + read on the predecessor's board + same org. Delete requires edit on either board.
- Late rule (same as `detectViolations`): a link is late when both ends have spans and `successor.start < predecessor.end` (ISO string compare).
- Folder Timeline RPC cap: 5,000 in-folder items. Over cap → notice "Showing the first {n} of {total} items".
- Folder Timeline data loads only when its tab is mounted (TanStack `useQuery`, like `People.tsx`); zoom/collapse/filter = zero server calls; tab state via existing `useCommandCenterState` (`history.replaceState`); never `router.refresh()` after a drag or link change.
- `GanttCanvas` must not be statically reachable from `CommandCenter.tsx` (lazy via `next/dynamic`, `ssr: false`).
- Every new `create function`: `revoke execute … from public, anon;` then `grant execute … to authenticated;` (private `_` helpers: revoke from `public, anon, authenticated`). Apply-time DO block and the conformance suite enforce this.
- Migrations only via `scripts/new-migration.sh <slug>`; apply to DEV with the `supabase-dev` MCP `apply_migration` using the same `<VERSION>_<slug>` name; `pnpm db:ledger-check` must exit 0. **DEV is the live production data** — no destructive experiments; verify behaviour inside `begin … rollback`.
- Types: in a worktree `pnpm db:types` fails — regenerate with the `supabase-dev` MCP `generate_typescript_types`, write to `src/types/database.types.ts`, run `pnpm prettier --write src/types/database.types.ts`. Never hand-edit types.
- Server actions return `ActionResult` / use `fail` from `src/lib/actions/result.ts`; new RPC calls go through `typedRpc` from `src/lib/supabase/typed-rpc.ts`.
- User-facing copy: product name is Monolith; never "Pulse". Copy strings used: "Timeline", "Waiting on", "Blocking", "Add dependency", "No dates on this board", "Late", "Showing the first {n} of {total} items", "Add Timeline tab".
- UI tasks (3, 5, 6, 7) load the `pulse-ui` and `frontend-design` skills before writing UI.
- Subagent rules: run every Bash command in the foreground with `timeout: 600000`, `cd` to the absolute worktree path in each Bash call, one plain git command per call. **Never** run `scripts/finish-task.sh`, merge, push, `git stash`, or `git add -A`/`.`. Stage by explicit path. Commit subjects: lowercase conventional (`feat(deps): …`), header ≤ 100 chars, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Gates per task: `pnpm typecheck && pnpm lint && pnpm test` (plus `pnpm build` in the final task).

---

## File Structure

| File                                                                      | Responsibility                                                                | Task |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ---- |
| `supabase/migrations/<VERSION>_cross_board_dependencies.sql`              | Column, backfill, RLS, RPC rewrite, JSON helpers, two new RPCs                | 1    |
| `src/types/database.types.ts`                                             | Regenerated                                                                   | 1    |
| `src/lib/boards/cross-board-deps.rls.integration.test.ts`                 | DB behaviour tests (skipped unless `PULSE_TEST_DB`)                           | 1    |
| `src/lib/boards/schedule.ts` (+ test)                                     | `resolveBoardSchedule`, `scheduleFromPicks`, `isLinkLate`                     | 2    |
| `src/lib/boards/timeline-context.ts` (+ test)                             | Zod schemas for RPC JSON, span resolution for context items                   | 2    |
| `src/lib/boards/cross-board.ts` (+ test)                                  | `crossBoardStubs`, `ExternalLinkStub`                                         | 2    |
| `src/components/boards/gantt/GanttCanvas.tsx` (+ test)                    | Board-agnostic Gantt (grid, bars, drag, links, arrows, stubs, virtualization) | 3    |
| `src/components/boards/gantt/LinkStubs.tsx`                               | Renders `ExternalLinkStub[]` on a bar                                         | 3    |
| `src/components/boards/GanttBoard.tsx`                                    | Becomes a wrapper around `GanttCanvas`                                        | 3, 6 |
| `src/components/boards/gantt/GanttRowItem.tsx`                            | Column-id props replaced by callbacks; section rows                           | 3    |
| `src/lib/boards/gantt.ts`                                                 | `GanttRow` gains `kind`/`level`                                               | 3    |
| `src/lib/boards/queries.ts`, `use-board-realtime.ts`                      | Load + subscribe to deps where board is either end                            | 4    |
| `src/lib/boards/dependency-actions.ts`                                    | `getBoardDependencyContext` action                                            | 4    |
| `src/lib/boards/use-dependency-context.ts`                                | Hook: fetch foreign-end context when cross-board deps exist                   | 4    |
| `src/lib/validations/folder-layout.ts`, `src/lib/folders/presets.ts`      | `timeline` tab kind (singleton), project preset                               | 5    |
| `src/components/folders/edit/use-layout-draft.ts`, `SectionsSheet.tsx`    | `addTab` action + "Add Timeline tab"                                          | 5    |
| `src/lib/folders/resolve.ts`, `src/lib/folders/actions.ts`                | `resolveFolderTimeline`, `getFolderTimeline`                                  | 5    |
| `src/lib/folders/timeline.ts` (+ test)                                    | Build canvas rows from `folder_timeline` JSON                                 | 5    |
| `src/components/folders/tabs/Timeline.tsx`, `TimelineInner.tsx` (+ tests) | Lazy tab + editable folder Gantt                                              | 5    |
| `src/components/folders/CommandCenter.tsx`                                | Render `timeline` kind                                                        | 5    |
| `src/components/folders/no-gantt-in-first-paint.test.ts`                  | Bundle guard                                                                  | 5    |
| `src/components/boards/item-panel/DependenciesSection.tsx` (+ test)       | "Waiting on / Blocking"                                                       | 7    |
| `src/lib/boards/dependency-list.ts` (+ test)                              | Panel list model                                                              | 7    |
| `src/components/boards/item-panel/ItemPanel.tsx`, `BoardViews.tsx`        | Mount section, pass schedule inputs                                           | 7    |

---

## Task 1: Migration — cross-board dependencies + timeline RPCs

**Files:**

- Create: `supabase/migrations/<VERSION>_cross_board_dependencies.sql` (via `scripts/new-migration.sh cross_board_dependencies`)
- Modify: `src/types/database.types.ts` (regenerated)
- Create: `src/lib/boards/cross-board-deps.rls.integration.test.ts`

**Interfaces:**

- Consumes: existing `readable_board_ids()`, `can_read_board(uuid)`, `can_edit_board(uuid)`, `is_org_member(uuid)`, `board_in_org(uuid,uuid)`, `_assert_folder_member(uuid)`, `_folder_readable_boards(uuid)`.
- Produces:
  - Column `item_dependencies.predecessor_board_id uuid not null`.
  - `create_item_dependency(p_predecessor uuid, p_successor uuid) returns item_dependencies` (cross-board allowed).
  - `folder_timeline(p_folder_id uuid, p_limit integer default 5000) returns jsonb` with shape
    `{ board_order: uuid[], boards: TimelineBoardJson[], items: TimelineItemJson[], external_item_ids: uuid[], dependencies: {id, predecessor_id, successor_id}[], total_items: int, truncated: bool }`.
  - `board_dependency_context(p_board_id uuid) returns jsonb` with shape `{ boards: TimelineBoardJson[], items: TimelineItemJson[] }` (foreign ends of this board's cross-board links only).
  - `TimelineBoardJson = { id, name, can_edit: bool, date_columns: {id,name}[], timeline_config: object|null, groups: {id,name,color,position}[] }`
  - `TimelineItemJson = { id, board_id, group_id, parent_id: uuid|null, name, position: number, created_at, updated_at, dates: { [column_id]: {date, end?} } }`

- [ ] **Step 1: Confirm items never change board**

Run: `grep -rnE "update public\.items[^;]*board_id|\.update\(\{[^}]*board_id" supabase/migrations src --include=*.sql --include=*.ts | grep -v test`
Expected: no output. If anything prints, stop and report — a board move would need a trigger to keep `board_id`/`predecessor_board_id` in sync.

- [ ] **Step 2: Mint the migration**

Run: `scripts/new-migration.sh cross_board_dependencies`
Expected: prints the new file path `supabase/migrations/<VERSION>_cross_board_dependencies.sql`. Note `<VERSION>`.

- [ ] **Step 3: Write the failing integration test**

Create `src/lib/boards/cross-board-deps.rls.integration.test.ts`. It follows `src/lib/folders/folder-rollup.integration.test.ts` (read its provisioning block first and copy the `provision`, org/workspace/board creation and teardown helpers verbatim, renaming the email prefix to `xbd-`).

```ts
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import {
  integrationTargetReady,
  loadIntegrationEnv,
} from "@/test/integration-env";
import { signInWithRetry } from "@/test/integration-auth";

loadIntegrationEnv();
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = "Test-Password-123!";

describe.skipIf(!integrationTargetReady())("cross-board dependencies", () => {
  const admin = createClient<Database>(SUPABASE_URL!, SERVICE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const createdUserIds: string[] = [];
  // owner creates org, workspace, boards A + B, folder F (A, B inside), board C (outside F)
  // viewer: org member with viewer grant on A only
  // editorB: org member with editor grant on B, viewer on A
  let owner: Awaited<ReturnType<typeof provision>>;
  let viewer: Awaited<ReturnType<typeof provision>>;
  let editorB: Awaited<ReturnType<typeof provision>>;
  let orgId = "",
    folderId = "",
    boardA = "",
    boardB = "",
    boardC = "";
  let itemA1 = "",
    itemB1 = "",
    itemC1 = "";

  async function provision(label: string) {
    const email = `xbd-${label}-${randomUUID()}@example.com`;
    const { data: created } = await admin.auth.admin.createUser({
      app_metadata: { pre_approved: true },
      email,
      password: PASSWORD,
      email_confirm: true,
    });
    createdUserIds.push(created.user!.id);
    const anon = createClient<Database>(SUPABASE_URL!, ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await signInWithRetry(anon, { email, password: PASSWORD });
    return { anon, userId: created.user!.id };
  }

  async function addItem(boardId: string, name: string) {
    const { data: g } = await admin
      .from("groups")
      .select("id")
      .eq("board_id", boardId)
      .limit(1)
      .single();
    const { data: item } = await admin
      .from("items")
      .insert({
        board_id: boardId,
        org_id: orgId,
        group_id: g!.id,
        name,
        created_by: owner.userId,
      })
      .select("id")
      .single();
    return item!.id as string;
  }

  beforeAll(async () => {
    owner = await provision("owner");
    viewer = await provision("viewer");
    editorB = await provision("editorb");
    const { data: org } = await owner.anon.rpc("create_organization", {
      p_name: "XBD",
      p_slug: `xbd-${randomUUID().slice(0, 8)}`,
    });
    orgId = (org as { id: string }).id;
    const { data: ws } = await owner.anon
      .from("workspaces")
      .insert({ org_id: orgId, name: "W", created_by: owner.userId })
      .select("id")
      .single();
    const mk = async (name: string) =>
      (
        (
          await owner.anon.rpc("create_board", {
            p_workspace_id: ws!.id,
            p_name: name,
          })
        ).data as { id: string }
      ).id;
    boardA = await mk("A");
    boardB = await mk("B");
    boardC = await mk("C");
    const { data: f } = await owner.anon
      .from("folders")
      .insert({
        org_id: orgId,
        workspace_id: ws!.id,
        name: "F",
        created_by: owner.userId,
      })
      .select("id")
      .single();
    folderId = f!.id;
    await owner.anon.from("folder_boards").insert([
      { folder_id: folderId, board_id: boardA },
      { folder_id: folderId, board_id: boardB },
    ]);
    for (const u of [viewer, editorB]) {
      await admin
        .from("org_members")
        .insert({ org_id: orgId, user_id: u.userId, role: "member" });
    }
    await admin.from("board_members").insert([
      {
        org_id: orgId,
        board_id: boardA,
        user_id: viewer.userId,
        access_level: "viewer",
        granted_by: owner.userId,
      },
      {
        org_id: orgId,
        board_id: boardA,
        user_id: editorB.userId,
        access_level: "viewer",
        granted_by: owner.userId,
      },
      {
        org_id: orgId,
        board_id: boardB,
        user_id: editorB.userId,
        access_level: "editor",
        granted_by: owner.userId,
      },
    ]);
    itemA1 = await addItem(boardA, "A1");
    itemB1 = await addItem(boardB, "B1");
    itemC1 = await addItem(boardC, "C1");
  });

  afterAll(async () => {
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  });

  it("owner links A1 -> B1 across boards; row stores successor board + predecessor board", async () => {
    const { data, error } = await owner.anon.rpc("create_item_dependency", {
      p_predecessor: itemA1,
      p_successor: itemB1,
    });
    expect(error).toBeNull();
    expect(data).toMatchObject({
      board_id: boardB,
      predecessor_board_id: boardA,
    });
  });

  it("rejects a cycle across boards", async () => {
    const { error } = await owner.anon.rpc("create_item_dependency", {
      p_predecessor: itemB1,
      p_successor: itemA1,
    });
    expect(error?.message).toMatch(/cycle/);
  });

  it("editor of successor board + reader of predecessor board can create", async () => {
    const itemB2 = await addItem(boardB, "B2");
    const { error } = await editorB.anon.rpc("create_item_dependency", {
      p_predecessor: itemA1,
      p_successor: itemB2,
    });
    expect(error).toBeNull();
  });

  it("cannot create when only a reader of the successor board", async () => {
    const itemA2 = await addItem(boardA, "A2");
    const { error } = await editorB.anon.rpc("create_item_dependency", {
      p_predecessor: itemB1,
      p_successor: itemA2,
    });
    expect(error?.message).toMatch(/edit access/);
  });

  it("cannot create when the predecessor board is unreadable", async () => {
    const itemB3 = await addItem(boardB, "B3");
    const { error } = await editorB.anon.rpc("create_item_dependency", {
      p_predecessor: itemC1,
      p_successor: itemB3,
    });
    expect(error?.message).toMatch(/not found/);
  });

  it("hides links whose other end is unreadable", async () => {
    const { data } = await viewer.anon
      .from("item_dependencies")
      .select("id")
      .eq("predecessor_id", itemA1);
    expect(data).toEqual([]); // viewer cannot read B
  });

  it("folder_timeline returns both folder boards, items, and the link", async () => {
    const { data, error } = await owner.anon.rpc("folder_timeline", {
      p_folder_id: folderId,
    });
    expect(error).toBeNull();
    const j = data as {
      board_order: string[];
      items: { id: string }[];
      dependencies: { predecessor_id: string }[];
      truncated: boolean;
    };
    expect(j.board_order).toEqual(expect.arrayContaining([boardA, boardB]));
    expect(j.items.map((i) => i.id)).toEqual(
      expect.arrayContaining([itemA1, itemB1]),
    );
    expect(j.dependencies.some((d) => d.predecessor_id === itemA1)).toBe(true);
    expect(j.truncated).toBe(false);
  });

  it("board_dependency_context returns the foreign end only", async () => {
    const { data } = await owner.anon.rpc("board_dependency_context", {
      p_board_id: boardB,
    });
    const j = data as { items: { id: string }[]; boards: { id: string }[] };
    expect(j.items.map((i) => i.id)).toEqual([itemA1]);
    expect(j.boards.map((b) => b.id)).toEqual([boardA]);
  });

  it("delete allowed from the successor-board editor", async () => {
    const { data: dep } = await owner.anon
      .from("item_dependencies")
      .select("id")
      .eq("predecessor_id", itemA1)
      .eq("successor_id", itemB1)
      .single();
    const { error } = await editorB.anon
      .from("item_dependencies")
      .delete()
      .eq("id", dep!.id);
    expect(error).toBeNull();
    const { data: left } = await owner.anon
      .from("item_dependencies")
      .select("id")
      .eq("id", dep!.id);
    expect(left).toEqual([]);
  });
});
```

If the `create_board` / `create_organization` RPC return shapes differ from `{ id }`, copy the exact unpacking used in `folder-rollup.integration.test.ts`.

- [ ] **Step 4: Write the migration SQL**

Write into the minted file:

```sql
-- Cross-board item dependencies + folder Timeline RPCs.
-- Spec: docs/superpowers/specs/2026-11-13-cross-board-dependencies-folder-timeline-design.md
-- board_id now means the SUCCESSOR's board; predecessor_board_id is the predecessor's board.
-- Existing rows are same-board, so both columns equal the old board_id.

alter table public.item_dependencies
  add column predecessor_board_id uuid references public.boards (id) on delete cascade;

update public.item_dependencies d
   set predecessor_board_id = i.board_id
  from public.items i
 where i.id = d.predecessor_id;

update public.item_dependencies d
   set board_id = i.board_id
  from public.items i
 where i.id = d.successor_id
   and d.board_id <> i.board_id;

alter table public.item_dependencies
  alter column predecessor_board_id set not null;

create index item_dependencies_predecessor_board_id_idx
  on public.item_dependencies (predecessor_board_id);

-- RLS: visible only when both boards are readable; delete from either editable side.
drop policy "item_dependencies: read if can read" on public.item_dependencies;
create policy "item_dependencies: read if can read" on public.item_dependencies
  for select to authenticated
  using (
    board_id in (select public.readable_board_ids())
    and predecessor_board_id in (select public.readable_board_ids())
  );

drop policy "item_dependencies: insert if can edit" on public.item_dependencies;
create policy "item_dependencies: insert if can edit" on public.item_dependencies
  for insert to authenticated with check (
    public.is_org_member(org_id)
    and public.can_edit_board(board_id)
    and public.board_in_org(board_id, org_id)
    and predecessor_board_id in (select public.readable_board_ids())
    and public.board_in_org(predecessor_board_id, org_id)
  );

drop policy "item_dependencies: delete if can edit" on public.item_dependencies;
create policy "item_dependencies: delete if can edit" on public.item_dependencies
  for delete to authenticated
  using (public.can_edit_board(board_id) or public.can_edit_board(predecessor_board_id));

-- RPC: cross-board allowed within one org.
create or replace function public.create_item_dependency(
  p_predecessor uuid, p_successor uuid
) returns public.item_dependencies
language plpgsql security definer set search_path = '' as $$
declare
  v_uid         uuid := (select auth.uid());
  v_pred_board  uuid;
  v_pred_org    uuid;
  v_succ_board  uuid;
  v_succ_org    uuid;
  v_row         public.item_dependencies;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_predecessor = p_successor then
    raise exception 'an item cannot depend on itself' using errcode = 'P0001';
  end if;

  select board_id, org_id into v_succ_board, v_succ_org
  from public.items where id = p_successor and archived_at is null;
  if v_succ_board is null then
    raise exception 'successor not found' using errcode = 'P0002';
  end if;
  if not public.is_org_member(v_succ_org) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;
  if not public.can_edit_board(v_succ_board) then
    raise exception 'no edit access to this board' using errcode = '42501';
  end if;

  select board_id, org_id into v_pred_board, v_pred_org
  from public.items where id = p_predecessor and archived_at is null;
  if v_pred_board is null or v_pred_org <> v_succ_org
     or not public.can_read_board(v_pred_board) then
    raise exception 'predecessor not found' using errcode = 'P0002';
  end if;

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

  insert into public.item_dependencies
    (org_id, board_id, predecessor_board_id, predecessor_id, successor_id, type)
  values (v_succ_org, v_succ_board, v_pred_board, p_predecessor, p_successor, 'FS')
  returning * into v_row;
  return v_row;
end; $$;

-- Private JSON builders. Callers MUST pre-filter ids to readable boards.
create or replace function public._timeline_boards_json(p_board_ids uuid[])
returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', b.id,
    'name', b.name,
    'can_edit', public.can_edit_board(b.id),
    'date_columns', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by c.position, c.id)
      from public.columns c where c.board_id = b.id and c.kind = 'date'), '[]'::jsonb),
    'timeline_config', (
      select v.config from public.board_views v
      where v.board_id = b.id and v.kind = 'timeline'
      order by v.position, v.id limit 1),
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'color', g.color, 'position', g.position)
                       order by g.position, g.id)
      from public.groups g where g.board_id = b.id and g.archived_at is null), '[]'::jsonb)
  ) order by b.id), '[]'::jsonb)
  from public.boards b
  where b.id = any(p_board_ids) and b.archived_at is null
$$;
revoke execute on function public._timeline_boards_json(uuid[]) from public, anon, authenticated;

create or replace function public._timeline_items_json(p_item_ids uuid[])
returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id,
    'board_id', i.board_id,
    'group_id', i.group_id,
    'parent_id', i.parent_id,
    'name', i.name,
    'position', i.position,
    'created_at', i.created_at,
    'updated_at', i.updated_at,
    'dates', coalesce((
      select jsonb_object_agg(cv.column_id, cv.value)
      from public.cell_values cv
      join public.columns c on c.id = cv.column_id and c.kind = 'date'
      where cv.item_id = i.id), '{}'::jsonb)
  )), '[]'::jsonb)
  from public.items i
  where i.id = any(p_item_ids) and i.archived_at is null
$$;
revoke execute on function public._timeline_items_json(uuid[]) from public, anon, authenticated;

-- Folder Timeline: every readable board in the folder, capped items, links touching them
-- (both ends readable), plus the out-of-folder (or over-cap) ends as external items.
create or replace function public.folder_timeline(p_folder_id uuid, p_limit integer default 5000)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_limit          integer := least(greatest(coalesce(p_limit, 5000), 1), 5000);
  v_board_order    uuid[];
  v_item_ids       uuid[];
  v_total          integer;
  v_deps           jsonb;
  v_ext_item_ids   uuid[];
  v_ext_board_ids  uuid[];
begin
  perform public._assert_folder_member(p_folder_id);

  select coalesce(array_agg(b.id order by fbd.position, b.name, b.id), '{}')
    into v_board_order
  from public.folder_boards fbd
  join public.boards b on b.id = fbd.board_id
  where fbd.folder_id = p_folder_id
    and b.id in (select public._folder_readable_boards(p_folder_id));

  select count(*) into v_total
  from public.items i
  join public.groups g on g.id = i.group_id and g.archived_at is null
  where i.board_id = any(v_board_order) and i.archived_at is null;

  select coalesce(array_agg(x.id), '{}') into v_item_ids
  from (
    select i.id
    from public.items i
    join public.groups g on g.id = i.group_id and g.archived_at is null
    where i.board_id = any(v_board_order) and i.archived_at is null
    order by array_position(v_board_order, i.board_id), g.position, i.position, i.id
    limit v_limit
  ) x;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', d.id, 'predecessor_id', d.predecessor_id, 'successor_id', d.successor_id)), '[]'::jsonb),
         coalesce(array_agg(distinct case when d.predecessor_id = any(v_item_ids)
                                          then d.successor_id else d.predecessor_id end)
                  filter (where not (d.predecessor_id = any(v_item_ids) and d.successor_id = any(v_item_ids))),
                  '{}')
    into v_deps, v_ext_item_ids
  from public.item_dependencies d
  where (d.predecessor_id = any(v_item_ids) or d.successor_id = any(v_item_ids))
    and d.board_id in (select public.readable_board_ids())
    and d.predecessor_board_id in (select public.readable_board_ids());

  select coalesce(array_agg(distinct i.board_id), '{}') into v_ext_board_ids
  from public.items i
  where i.id = any(v_ext_item_ids) and i.archived_at is null;

  return jsonb_build_object(
    'board_order',       to_jsonb(v_board_order),
    'boards',            public._timeline_boards_json(v_board_order || v_ext_board_ids),
    'items',             public._timeline_items_json(v_item_ids || v_ext_item_ids),
    'external_item_ids', to_jsonb(v_ext_item_ids),
    'dependencies',      v_deps,
    'total_items',       v_total,
    'truncated',         v_total > v_limit
  );
end; $$;
revoke execute on function public.folder_timeline(uuid, integer) from public, anon;
grant execute on function public.folder_timeline(uuid, integer) to authenticated;

-- Board context: the foreign ends of this board's cross-board links (both ends readable).
create or replace function public.board_dependency_context(p_board_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_ext_item_ids  uuid[];
  v_ext_board_ids uuid[];
begin
  if not public.can_read_board(p_board_id) then
    raise exception 'board not found' using errcode = 'P0002';
  end if;

  select coalesce(array_agg(distinct case when d.board_id = p_board_id
                                          then d.predecessor_id else d.successor_id end), '{}')
    into v_ext_item_ids
  from public.item_dependencies d
  where (d.board_id = p_board_id or d.predecessor_board_id = p_board_id)
    and d.board_id <> d.predecessor_board_id
    and d.board_id in (select public.readable_board_ids())
    and d.predecessor_board_id in (select public.readable_board_ids());

  select coalesce(array_agg(distinct i.board_id), '{}') into v_ext_board_ids
  from public.items i
  where i.id = any(v_ext_item_ids) and i.archived_at is null;

  return jsonb_build_object(
    'boards', public._timeline_boards_json(v_ext_board_ids),
    'items',  public._timeline_items_json(v_ext_item_ids)
  );
end; $$;
revoke execute on function public.board_dependency_context(uuid) from public, anon;
grant execute on function public.board_dependency_context(uuid) to authenticated;
```

- [ ] **Step 5: Apply to DEV and check the ledger**

Apply with `supabase-dev` MCP `apply_migration`, name `<VERSION>_cross_board_dependencies`, query = the file contents.
Run: `pnpm db:ledger-check`
Expected: exit 0. If the ledger stamped another version, run `scripts/reconcile-migration-version.sh <ledger-version> <VERSION>` and re-check.

- [ ] **Step 6: Verify on DEV inside a rolled-back transaction**

With `supabase-dev` MCP `execute_sql`, pick a real org member and two boards they can edit in the same org (read-only `select`s first), then run:

```sql
begin;
select set_config('request.jwt.claims', json_build_object('sub', '<user-id>', 'role', 'authenticated')::text, true);
set local role authenticated;
select (public.create_item_dependency('<item on board X>', '<item on board Y>')).predecessor_board_id;
select jsonb_array_length(public.folder_timeline('<a folder id of that org>') -> 'items');
select public.board_dependency_context('<board Y>') -> 'items';
rollback;
```

Expected: the first select returns board X's id, the second a number ≥ 0, the third a one-element array with the board-X item. Nothing persists (rollback).

- [ ] **Step 7: Regenerate types**

Use `supabase-dev` MCP `generate_typescript_types`, write the output to `src/types/database.types.ts` (strip any stray non-TS `"_tag"` line), then:
Run: `pnpm prettier --write src/types/database.types.ts && pnpm typecheck`
Expected: typecheck passes; `git diff src/types/database.types.ts` shows `predecessor_board_id`, `folder_timeline`, `board_dependency_context`.

- [ ] **Step 8: Run unit + conformance suites**

Run: `pnpm test`
Expected: PASS (conformance confirms anon cannot execute the new functions; the integration test file is skipped without `PULSE_TEST_DB`).

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/<VERSION>_cross_board_dependencies.sql src/types/database.types.ts src/lib/boards/cross-board-deps.rls.integration.test.ts
git commit -m "feat(deps): allow cross-board dependencies and add timeline rpcs"
```

---

## Task 2: Pure schedule and cross-board helpers

**Files:**

- Create: `src/lib/boards/schedule.ts`, `src/lib/boards/schedule.test.ts`
- Create: `src/lib/boards/timeline-context.ts`, `src/lib/boards/timeline-context.test.ts`
- Create: `src/lib/boards/cross-board.ts`, `src/lib/boards/cross-board.test.ts`

**Interfaces:**

- Consumes (existing, `src/lib/boards/dates.ts`): `defaultTimelineColumns(dateColumns: {id;name}[]): {startColumnId; endColumnId}`, `isSyntheticDateSource(id: string | null): boolean`, `syntheticDateCellValues(items, ids)`, `resolveTimelineSpan(itemId, cellValues: CacheCellValue[], startColumnId: string, endColumnId: string | null): TimelineSpan | null`, `type TimelineSpan = { start: string; end: string; isMilestone: boolean }`. `CacheCellValue`, `CacheItem` from `src/lib/boards/cache.ts`.
- Produces:
  - `schedule.ts`: `type TimelineViewConfig = { date_column_id?: string | null; end_column_id?: string | null } | null`; `type DateColumnRef = { id: string; name: string }`; `type BoardSchedule = { startSourceId: string | null; endSourceId: string | null; readOnly: boolean }`; `scheduleFromPicks(dateColumns: readonly DateColumnRef[], startPick: string | null, endPick: string | null): BoardSchedule`; `resolveBoardSchedule(dateColumns: readonly DateColumnRef[], config: TimelineViewConfig): BoardSchedule`; `isLinkLate(pred: TimelineSpan | null, succ: TimelineSpan | null): boolean`.
  - `timeline-context.ts`: `timelineBoardSchema`, `timelineItemSchema`, `dependencyContextSchema`, `folderTimelineSchema` (Zod); types `TimelineBoard`, `TimelineItem`, `DependencyContext`, `FolderTimelineData`; `boardScheduleOf(board: TimelineBoard): BoardSchedule`; `contextCellValues(items: readonly TimelineItem[]): CacheCellValue[]`; `spanOfContextItem(item: TimelineItem, board: TimelineBoard): TimelineSpan | null`; `contextSpans(ctx: DependencyContext): Map<string, TimelineSpan | null>`.
  - `cross-board.ts`: `type ExternalLinkStub = { dependencyId: string; direction: "waiting_on" | "blocking"; itemId: string; itemName: string; boardId: string; boardName: string; endISO: string | null; late: boolean }`; `crossBoardStubs(args: { dependencies: readonly { id: string; predecessor_id: string; successor_id: string }[]; localItemIds: ReadonlySet<string>; localSpans: ReadonlyMap<string, TimelineSpan | null>; context: DependencyContext; contextSpans: ReadonlyMap<string, TimelineSpan | null> }): Map<string, ExternalLinkStub[]>` (keyed by local item id; links whose foreign end is missing from `context` are skipped).

- [ ] **Step 1: Write failing tests for `schedule.ts`**

```ts
// src/lib/boards/schedule.test.ts
import { describe, expect, it } from "vitest";
import {
  isLinkLate,
  resolveBoardSchedule,
  scheduleFromPicks,
} from "@/lib/boards/schedule";
import { CREATED_AT_SOURCE } from "@/lib/boards/dates";

const cols = [
  { id: "c-due", name: "Due date" },
  { id: "c-start", name: "Start" },
];

describe("resolveBoardSchedule", () => {
  it("seeds start/end by column name when the view has no config", () => {
    expect(resolveBoardSchedule(cols, null)).toEqual({
      startSourceId: "c-start",
      endSourceId: "c-due",
      readOnly: false,
    });
  });
  it("honours explicit config picks", () => {
    expect(
      resolveBoardSchedule(cols, {
        date_column_id: "c-due",
        end_column_id: null,
      }),
    ).toEqual({
      startSourceId: "c-due",
      endSourceId: "c-due",
      readOnly: false,
    });
  });
  it("returns no schedule for a board without date columns", () => {
    expect(resolveBoardSchedule([], null)).toEqual({
      startSourceId: null,
      endSourceId: null,
      readOnly: false,
    });
  });
  it("marks synthetic sources read-only", () => {
    expect(
      resolveBoardSchedule(cols, { date_column_id: CREATED_AT_SOURCE }),
    ).toMatchObject({
      startSourceId: CREATED_AT_SOURCE,
      readOnly: true,
    });
  });
});

describe("scheduleFromPicks", () => {
  it("falls back to the first date column for an unknown start pick", () => {
    expect(scheduleFromPicks(cols, "gone", null).startSourceId).toBe("c-due");
  });
  it("keeps an explicit null end", () => {
    expect(scheduleFromPicks(cols, "c-start", null).endSourceId).toBeNull();
  });
});

describe("isLinkLate", () => {
  const span = (start: string, end: string) => ({
    start,
    end,
    isMilestone: start === end,
  });
  it("is late when the successor starts before the predecessor ends", () => {
    expect(
      isLinkLate(
        span("2026-11-01", "2026-11-10"),
        span("2026-11-05", "2026-11-20"),
      ),
    ).toBe(true);
  });
  it("is not late when the successor starts on or after the predecessor end", () => {
    expect(
      isLinkLate(
        span("2026-11-01", "2026-11-10"),
        span("2026-11-10", "2026-11-20"),
      ),
    ).toBe(false);
  });
  it("is never late when either end has no dates", () => {
    expect(isLinkLate(null, span("2026-11-01", "2026-11-02"))).toBe(false);
  });
});
```

Note: in the "honours explicit config" case a persisted `end_column_id: null` falls back to the seeded end through `??` — the same semantics `GanttBoard` uses today (`config?.end_column_id ?? seeded.endColumnId`) — hence `endSourceId: "c-due"`.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run --project unit src/lib/boards/schedule.test.ts`
Expected: FAIL — cannot resolve `@/lib/boards/schedule`.

- [ ] **Step 3: Implement `schedule.ts`**

```ts
// src/lib/boards/schedule.ts
import {
  defaultTimelineColumns,
  isSyntheticDateSource,
  type TimelineSpan,
} from "@/lib/boards/dates";

/** The subset of a timeline view's config that decides its date sources. */
export type TimelineViewConfig = {
  date_column_id?: string | null;
  end_column_id?: string | null;
} | null;

export type DateColumnRef = { id: string; name: string };

/** Which cells (or synthetic timestamp sources) a board's timeline reads. */
export type BoardSchedule = {
  startSourceId: string | null;
  endSourceId: string | null;
  /** True when a source is a synthetic timestamp — there is no cell to write. */
  readOnly: boolean;
};

/**
 * Resolve date sources from explicit picks. Mirrors GanttBoard's derivation:
 * a synthetic start keeps its sentinel; a real/unknown start falls back to the
 * first date column; the end pick is used as-is (null = no end column).
 */
export function scheduleFromPicks(
  dateColumns: readonly DateColumnRef[],
  startPick: string | null,
  endPick: string | null,
): BoardSchedule {
  const dateColumn =
    dateColumns.find((c) => c.id === startPick) ?? dateColumns[0] ?? null;
  const startSourceId = isSyntheticDateSource(startPick)
    ? startPick
    : (dateColumn?.id ?? null);
  const endSourceId = endPick;
  return {
    startSourceId,
    endSourceId,
    readOnly:
      isSyntheticDateSource(startSourceId) ||
      isSyntheticDateSource(endSourceId),
  };
}

/** A board's schedule from its (first) timeline view config, seeding unset picks by column name. */
export function resolveBoardSchedule(
  dateColumns: readonly DateColumnRef[],
  config: TimelineViewConfig,
): BoardSchedule {
  const seeded = defaultTimelineColumns([...dateColumns]);
  return scheduleFromPicks(
    dateColumns,
    config?.date_column_id ?? seeded.startColumnId,
    config?.end_column_id ?? seeded.endColumnId,
  );
}

/** Finish-to-start lateness — same rule as detectViolations. */
export function isLinkLate(
  pred: TimelineSpan | null,
  succ: TimelineSpan | null,
): boolean {
  if (!pred || !succ) return false;
  return succ.start < pred.end;
}
```

If `TimelineSpan` is not exported from `dates.ts` as a type, export it there (it is declared at `dates.ts:80`).

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run --project unit src/lib/boards/schedule.test.ts`
Expected: PASS.

- [ ] **Step 5: Write failing tests for `timeline-context.ts`**

```ts
// src/lib/boards/timeline-context.test.ts
import { describe, expect, it } from "vitest";
import {
  contextSpans,
  dependencyContextSchema,
  folderTimelineSchema,
  spanOfContextItem,
  type TimelineBoard,
  type TimelineItem,
} from "@/lib/boards/timeline-context";

const B = "11111111-1111-4111-8111-111111111111";
const G = "22222222-2222-4222-8222-222222222222";
const I = "33333333-3333-4333-8333-333333333333";
const START = "44444444-4444-4444-8444-444444444444";
const END = "55555555-5555-4555-8555-555555555555";

const board: TimelineBoard = {
  id: B,
  name: "Procurement",
  can_edit: true,
  date_columns: [
    { id: START, name: "Start" },
    { id: END, name: "Due" },
  ],
  timeline_config: null,
  groups: [{ id: G, name: "MVP", color: "#888", position: 0 }],
};
const item: TimelineItem = {
  id: I,
  board_id: B,
  group_id: G,
  parent_id: null,
  name: "PO raised",
  position: 0,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-02T00:00:00Z",
  dates: { [START]: { date: "2026-11-01" }, [END]: { date: "2026-11-09" } },
};

describe("timeline-context", () => {
  it("parses RPC JSON", () => {
    expect(
      dependencyContextSchema.parse({ boards: [board], items: [item] })
        .items[0]!.name,
    ).toBe("PO raised");
    expect(
      folderTimelineSchema.parse({
        board_order: [B],
        boards: [board],
        items: [item],
        external_item_ids: [],
        dependencies: [],
        total_items: 1,
        truncated: false,
      }).truncated,
    ).toBe(false);
  });
  it("resolves a span through the board's schedule", () => {
    expect(spanOfContextItem(item, board)).toEqual({
      start: "2026-11-01",
      end: "2026-11-09",
      isMilestone: false,
    });
  });
  it("returns null for a board with no date columns", () => {
    expect(spanOfContextItem(item, { ...board, date_columns: [] })).toBeNull();
  });
  it("maps every context item to its span", () => {
    expect(contextSpans({ boards: [board], items: [item] }).get(I)?.end).toBe(
      "2026-11-09",
    );
  });
});
```

- [ ] **Step 6: Run to verify failure**

Run: `pnpm vitest run --project unit src/lib/boards/timeline-context.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 7: Implement `timeline-context.ts`**

```ts
// src/lib/boards/timeline-context.ts
import { z } from "zod";
import type { CacheCellValue, CacheItem } from "@/lib/boards/cache";
import {
  isSyntheticDateSource,
  resolveTimelineSpan,
  syntheticDateCellValues,
  type TimelineSpan,
} from "@/lib/boards/dates";
import {
  resolveBoardSchedule,
  type BoardSchedule,
  type TimelineViewConfig,
} from "@/lib/boards/schedule";

const uuid = z.string().uuid();

export const timelineBoardSchema = z.object({
  id: uuid,
  name: z.string(),
  can_edit: z.boolean(),
  date_columns: z.array(z.object({ id: uuid, name: z.string() })),
  timeline_config: z.record(z.string(), z.unknown()).nullable(),
  groups: z.array(
    z.object({
      id: uuid,
      name: z.string(),
      color: z.string(),
      position: z.number(),
    }),
  ),
});

export const timelineItemSchema = z.object({
  id: uuid,
  board_id: uuid,
  group_id: uuid,
  parent_id: uuid.nullable(),
  name: z.string(),
  position: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
  dates: z.record(z.string(), z.unknown()),
});

export const dependencyContextSchema = z.object({
  boards: z.array(timelineBoardSchema),
  items: z.array(timelineItemSchema),
});

export const folderTimelineSchema = dependencyContextSchema.extend({
  board_order: z.array(uuid),
  external_item_ids: z.array(uuid),
  dependencies: z.array(
    z.object({ id: uuid, predecessor_id: uuid, successor_id: uuid }),
  ),
  total_items: z.number().int(),
  truncated: z.boolean(),
});

export type TimelineBoard = z.infer<typeof timelineBoardSchema>;
export type TimelineItem = z.infer<typeof timelineItemSchema>;
export type DependencyContext = z.infer<typeof dependencyContextSchema>;
export type FolderTimelineData = z.infer<typeof folderTimelineSchema>;

export function boardScheduleOf(board: TimelineBoard): BoardSchedule {
  return resolveBoardSchedule(
    board.date_columns,
    board.timeline_config as TimelineViewConfig,
  );
}

/** Date cells of context items in the board-cache cell shape the date helpers read. */
export function contextCellValues(
  items: readonly TimelineItem[],
): CacheCellValue[] {
  return items.flatMap((it) =>
    Object.entries(it.dates).map(
      ([columnId, value]) =>
        ({
          item_id: it.id,
          column_id: columnId,
          board_id: it.board_id,
          org_id: "",
          updated_at: "",
          value,
        }) as CacheCellValue,
    ),
  );
}

export function spanOfContextItem(
  item: TimelineItem,
  board: TimelineBoard,
): TimelineSpan | null {
  const s = boardScheduleOf(board);
  if (!s.startSourceId) return null;
  const synthetic = [s.startSourceId, s.endSourceId].filter(
    (id): id is string => isSyntheticDateSource(id),
  );
  const cells = [
    ...contextCellValues([item]),
    ...(synthetic.length
      ? syntheticDateCellValues([item as unknown as CacheItem], synthetic)
      : []),
  ];
  return resolveTimelineSpan(item.id, cells, s.startSourceId, s.endSourceId);
}

export function contextSpans(
  ctx: DependencyContext,
): Map<string, TimelineSpan | null> {
  const boards = new Map(ctx.boards.map((b) => [b.id, b]));
  const out = new Map<string, TimelineSpan | null>();
  for (const it of ctx.items) {
    const b = boards.get(it.board_id);
    out.set(it.id, b ? spanOfContextItem(it, b) : null);
  }
  return out;
}
```

Check the actual `CacheCellValue` fields in `src/lib/boards/cache.ts` and fill any additional required field in the cast object with an empty value of the right type. Check `syntheticDateCellValues`'s parameter type; if it reads fields other than `id`, `created_at`, `updated_at`, `board_id`, keep the cast but confirm those fields exist on `TimelineItem`.

- [ ] **Step 8: Run to verify pass**

Run: `pnpm vitest run --project unit src/lib/boards/timeline-context.test.ts`
Expected: PASS.

- [ ] **Step 9: Write failing tests for `cross-board.ts`**

```ts
// src/lib/boards/cross-board.test.ts
import { describe, expect, it } from "vitest";
import { crossBoardStubs } from "@/lib/boards/cross-board";
import type { DependencyContext } from "@/lib/boards/timeline-context";

const span = (start: string, end: string) => ({
  start,
  end,
  isMilestone: start === end,
});
const FB = "11111111-1111-4111-8111-111111111111";
const FG = "22222222-2222-4222-8222-222222222222";
const ctx: DependencyContext = {
  boards: [
    {
      id: FB,
      name: "Procurement",
      can_edit: false,
      date_columns: [],
      timeline_config: null,
      groups: [],
    },
  ],
  items: [
    {
      id: "f1",
      board_id: FB,
      group_id: FG,
      parent_id: null,
      name: "PO raised",
      position: 0,
      created_at: "",
      updated_at: "",
      dates: {},
    },
  ],
};

describe("crossBoardStubs", () => {
  it("builds a late waiting-on stub for a foreign predecessor", () => {
    const m = crossBoardStubs({
      dependencies: [{ id: "d1", predecessor_id: "f1", successor_id: "l1" }],
      localItemIds: new Set(["l1"]),
      localSpans: new Map([["l1", span("2026-11-03", "2026-11-05")]]),
      context: ctx,
      contextSpans: new Map([["f1", span("2026-11-01", "2026-11-10")]]),
    });
    expect(m.get("l1")).toEqual([
      {
        dependencyId: "d1",
        direction: "waiting_on",
        itemId: "f1",
        itemName: "PO raised",
        boardId: FB,
        boardName: "Procurement",
        endISO: "2026-11-10",
        late: true,
      },
    ]);
  });
  it("builds a blocking stub for a foreign successor", () => {
    const m = crossBoardStubs({
      dependencies: [{ id: "d2", predecessor_id: "l1", successor_id: "f1" }],
      localItemIds: new Set(["l1"]),
      localSpans: new Map([["l1", span("2026-11-01", "2026-11-02")]]),
      context: ctx,
      contextSpans: new Map([["f1", span("2026-11-03", "2026-11-04")]]),
    });
    expect(m.get("l1")?.[0]).toMatchObject({
      direction: "blocking",
      late: false,
    });
  });
  it("ignores intra-board links and links to unknown foreign items", () => {
    const m = crossBoardStubs({
      dependencies: [
        { id: "d3", predecessor_id: "l1", successor_id: "l2" },
        { id: "d4", predecessor_id: "zz", successor_id: "l1" },
      ],
      localItemIds: new Set(["l1", "l2"]),
      localSpans: new Map(),
      context: ctx,
      contextSpans: new Map(),
    });
    expect(m.size).toBe(0);
  });
});
```

- [ ] **Step 10: Run to verify failure**

Run: `pnpm vitest run --project unit src/lib/boards/cross-board.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 11: Implement `cross-board.ts`**

```ts
// src/lib/boards/cross-board.ts
import type { TimelineSpan } from "@/lib/boards/dates";
import { isLinkLate } from "@/lib/boards/schedule";
import type { DependencyContext } from "@/lib/boards/timeline-context";

export type ExternalLinkStub = {
  dependencyId: string;
  direction: "waiting_on" | "blocking";
  itemId: string;
  itemName: string;
  boardId: string;
  boardName: string;
  endISO: string | null;
  late: boolean;
};

type Dep = { id: string; predecessor_id: string; successor_id: string };

/** Stubs for links with exactly one end local, keyed by the local item id. */
export function crossBoardStubs(args: {
  dependencies: readonly Dep[];
  localItemIds: ReadonlySet<string>;
  localSpans: ReadonlyMap<string, TimelineSpan | null>;
  context: DependencyContext;
  contextSpans: ReadonlyMap<string, TimelineSpan | null>;
}): Map<string, ExternalLinkStub[]> {
  const items = new Map(args.context.items.map((i) => [i.id, i]));
  const boards = new Map(args.context.boards.map((b) => [b.id, b]));
  const out = new Map<string, ExternalLinkStub[]>();
  for (const d of args.dependencies) {
    const predLocal = args.localItemIds.has(d.predecessor_id);
    const succLocal = args.localItemIds.has(d.successor_id);
    if (predLocal === succLocal) continue;
    const localId = predLocal ? d.predecessor_id : d.successor_id;
    const foreignId = predLocal ? d.successor_id : d.predecessor_id;
    const foreign = items.get(foreignId);
    const board = foreign ? boards.get(foreign.board_id) : undefined;
    if (!foreign || !board) continue;
    const fSpan = args.contextSpans.get(foreignId) ?? null;
    const lSpan = args.localSpans.get(localId) ?? null;
    const stub: ExternalLinkStub = {
      dependencyId: d.id,
      direction: predLocal ? "blocking" : "waiting_on",
      itemId: foreign.id,
      itemName: foreign.name,
      boardId: board.id,
      boardName: board.name,
      endISO: fSpan?.end ?? null,
      late: predLocal ? isLinkLate(lSpan, fSpan) : isLinkLate(fSpan, lSpan),
    };
    const list = out.get(localId);
    if (list) list.push(stub);
    else out.set(localId, [stub]);
  }
  return out;
}
```

- [ ] **Step 12: Run all three test files and typecheck**

Run: `pnpm vitest run --project unit src/lib/boards/schedule.test.ts src/lib/boards/timeline-context.test.ts src/lib/boards/cross-board.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 13: Commit**

```bash
git add src/lib/boards/schedule.ts src/lib/boards/schedule.test.ts src/lib/boards/timeline-context.ts src/lib/boards/timeline-context.test.ts src/lib/boards/cross-board.ts src/lib/boards/cross-board.test.ts src/lib/boards/dates.ts
git commit -m "feat(deps): add schedule resolution and cross-board stub helpers"
```

(`dates.ts` only if you exported `TimelineSpan`.)

---

## Task 3: Extract `GanttCanvas` (behaviour-preserving)

**Files:**

- Create: `src/components/boards/gantt/GanttCanvas.tsx`, `src/components/boards/gantt/GanttCanvas.test.tsx`
- Create: `src/components/boards/gantt/LinkStubs.tsx`
- Modify: `src/components/boards/GanttBoard.tsx`, `src/components/boards/gantt/GanttRowItem.tsx`, `src/lib/boards/gantt.ts`

**Interfaces:**

- Consumes: `GanttRow`, `GanttDependency`, `timelineDayCount`, `visibleRows` from `src/lib/boards/gantt.ts`; `TimelineZoom`, `ROW_H`, `LABEL_W`, `fittedDayW`, `todayISO` etc. from `src/components/boards/gantt/utils.ts`; `ExternalLinkStub` from `src/lib/boards/cross-board.ts` (Task 2 — type-only; if Task 2 is not merged yet, declare an identical local type in `LinkStubs.tsx` and switch to the import when rebasing).
- Produces:
  - `GanttRow` gains `kind?: "item" | "section"` (default item) and `level?: 0 | 1` (section depth); section rows have `scheduled: false`, no bar, render a label band spanning the row.
  - `GanttCanvas` (named export) with props:

```ts
export type GanttCanvasProps = {
  /** Rows already in display order (items, optionally section rows). */
  rows: GanttRow[];
  /** Links whose both ends are in `rows` — drawn as arrows. */
  dependencies: GanttDependency[];
  /** Late link ids (from detectViolations or cross-board logic). */
  violations: ReadonlySet<string>;
  /** Cross-board / out-of-view links per item id — drawn as stubs on the bar. */
  externalLinks?: ReadonlyMap<string, ExternalLinkStub[]>;
  rangeStartISO: string;
  dayCount: number;
  zoom: TimelineZoom;
  colorFor: (row: GanttRow) => string;
  criticalLabelFor?: (itemId: string) => string | null;
  canEditItem: (itemId: string) => boolean;
  isExpanded?: (itemId: string) => boolean;
  onToggleExpand?: (itemId: string) => void;
  onMoveBar: (itemId: string, deltaDays: number) => void;
  onResizeBar: (itemId: string, newEndISO: string) => void;
  onAddDependency: (vars: {
    predecessorId: string;
    successorId: string;
  }) => void;
  onRemoveDependency: (vars: { dependencyId: string }) => void;
  /** Items offered in a row's "Blocked by…" picker. */
  linkCandidates: (row: GanttRow) => { itemId: string; name: string }[];
  onItemTap: (itemId: string, anchorRect: DOMRect) => void;
  onStubTap: (stub: ExternalLinkStub) => void;
  /** Rendered under the rows (board Gantt passes UnscheduledSection). */
  footer?: React.ReactNode;
};
```

- [ ] **Step 1: Read the current code**

Read `src/components/boards/GanttBoard.tsx` (whole file), `src/components/boards/gantt/GanttRowItem.tsx`, `src/lib/boards/gantt.ts`, `src/components/boards/GanttBoard.test.tsx`. Identify: the scroll container + `useVirtualizer` (≈L366-410), header ticks + today line (≈L706-735), `DndContext`/`handleDragEnd` (≈L569-590), rows render (≈L745-799), arrow SVG (≈L802-857), `arrowLines`/`clampedArrows` (≈L415-460). These move into `GanttCanvas`.

- [ ] **Step 2: Run the existing Gantt tests as the baseline**

Run: `pnpm vitest run --project unit src/components/boards/GanttBoard.test.tsx src/components/boards/GanttBoard.intel.test.tsx src/lib/boards/gantt.test.ts src/components/boards/BoardViews.test.tsx`
Expected: PASS. These must stay green unchanged after the extraction.

- [ ] **Step 3: Write the failing `GanttCanvas` test**

```tsx
// src/components/boards/gantt/GanttCanvas.test.tsx
import { beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  GanttCanvas,
  type GanttCanvasProps,
} from "@/components/boards/gantt/GanttCanvas";
import type { GanttRow } from "@/lib/boards/gantt";

vi.mock("@/lib/dnd/sensors", () => ({ useTouchAwareSensors: () => [] }));

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    value: 600,
  });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    value: 1200,
  });
});

const rows: GanttRow[] = [
  {
    itemId: "sec-b1",
    name: "Procurement",
    scheduled: false,
    kind: "section",
    level: 0,
  },
  {
    itemId: "i1",
    name: "PO raised",
    scheduled: true,
    startCol: 0,
    spanCols: 5,
    startISO: "2026-11-01",
    endISO: "2026-11-05",
  },
  {
    itemId: "i2",
    name: "Delivery",
    scheduled: true,
    startCol: 6,
    spanCols: 3,
    startISO: "2026-11-07",
    endISO: "2026-11-09",
  },
];

function props(over: Partial<GanttCanvasProps> = {}): GanttCanvasProps {
  return {
    rows,
    dependencies: [{ id: "d1", predecessor_id: "i1", successor_id: "i2" }],
    violations: new Set(),
    rangeStartISO: "2026-11-01",
    dayCount: 30,
    zoom: "month",
    colorFor: () => "#8ea2eb",
    canEditItem: () => true,
    onMoveBar: vi.fn(),
    onResizeBar: vi.fn(),
    onAddDependency: vi.fn(),
    onRemoveDependency: vi.fn(),
    linkCandidates: () => [],
    onItemTap: vi.fn(),
    onStubTap: vi.fn(),
    ...over,
  };
}

describe("GanttCanvas", () => {
  it("renders section bands and item rows", () => {
    render(<GanttCanvas {...props()} />);
    expect(screen.getByText("Procurement")).toBeInTheDocument();
    expect(screen.getByText("PO raised")).toBeInTheDocument();
  });

  it("renders a stub for an external link and reports taps", () => {
    const onStubTap = vi.fn();
    const stub = {
      dependencyId: "x1",
      direction: "waiting_on" as const,
      itemId: "f1",
      itemName: "Permit",
      boardId: "b9",
      boardName: "Regulatory",
      endISO: "2026-11-08",
      late: true,
    };
    render(
      <GanttCanvas
        {...props({ externalLinks: new Map([["i1", [stub]]]), onStubTap })}
      />,
    );
    const el = screen.getByRole("button", {
      name: /Waiting on Permit · Regulatory/,
    });
    fireEvent.click(el);
    expect(onStubTap).toHaveBeenCalledWith(stub);
    expect(el).toHaveTextContent(/Late/);
  });
});
```

- [ ] **Step 4: Run to verify failure**

Run: `pnpm vitest run --project unit src/components/boards/gantt/GanttCanvas.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 5: Extend `GanttRow`**

In `src/lib/boards/gantt.ts` add to `GanttRow`:

```ts
  /** "section" rows are label bands (folder board / group headers) with no bar. */
  kind?: "item" | "section";
  /** Section depth: 0 = board band, 1 = group band. */
  level?: 0 | 1;
```

`buildGanttRows` is unchanged (it emits item rows; `kind` undefined = item).

- [ ] **Step 6: Create `LinkStubs.tsx`**

Load `pulse-ui` + `frontend-design` first. A compact chip row anchored at the bar's right edge (left edge for `waiting_on`), mono kicker style, `Late` in the destructive token. Each stub is a `<button type="button">` with accessible name `` `${stub.direction === "waiting_on" ? "Waiting on" : "Blocking"} ${stub.itemName} · ${stub.boardName}` `` and visible text `↤`/`↦`, the item name (truncate), and "Late" when `stub.late`. More than 2 stubs collapse to "+N" opening a popover listing all. Props: `{ stubs: ExternalLinkStub[]; onTap: (s: ExternalLinkStub) => void }`.

- [ ] **Step 7: Create `GanttCanvas.tsx` by moving code**

Move (not copy) from `GanttBoard.tsx` into `GanttCanvas`: the scroll container and refs, `trackWidth`/`rowScrollMargin` measurement, `useVirtualizer`, `fittedDayW`/`totalW`, header ticks + today line, `DndContext` + `handleDragEnd`, the virtualized row loop, the arrow SVG + `arrowLines`/`clampedArrows`, `rowIndexMap`. Replace every board-specific call:

- `handleDragEnd`: instead of `onBarMoved(itemId, delta, itemDateRange(...), startCol, endCol, setCell)` call `props.onMoveBar(itemId, deltaDays)`.
- Resize: `GanttRowItem`'s `onBarResized(itemId, newEndISO, range)` becomes `onResizeBar(itemId, newEndISO)`.
- Dependency add/remove: `props.onAddDependency` / `props.onRemoveDependency`.
- Read-only: a row is draggable/resizable only when `props.canEditItem(row.itemId)`.
- "Blocked by…" picker items: `props.linkCandidates(row)`.
- Section rows (`row.kind === "section"`): render a full-width band (board band `level 0` darker, group band `level 1` lighter) with the name; no bar, no picker; arrows skip them.
- After each item row's bar, render `<LinkStubs stubs={props.externalLinks?.get(row.itemId) ?? []} onTap={props.onStubTap} />` when non-empty.
- `props.footer` renders after the rows (the board Gantt passes `UnscheduledSection`).

`GanttRowItem` props: remove `startColumnId`, `endColumnId`, `onBarResized(itemId,newEndISO,range)`, `addDependency`, `removeDependency`, `allRows`; add `readOnly` (already exists — now driven by `canEditItem`), `onResize(itemId, newEndISO)`, `onAddDependency`, `onRemoveDependency`, `linkCandidates: {itemId; name}[]`. Keep its DOM and test ids unchanged.

- [ ] **Step 8: Rewire `GanttBoard` to use `GanttCanvas`**

`GanttBoard` keeps: cache, mutations, view config + pickers + `persistConfig`, header/controls, empty state, intel narrowing, colors, critical labels, quick edit, `openItemPanel`, unscheduled rows. It now renders `<GanttCanvas … />` passing:

- `rows={visibleTimelineRows}`, `dependencies={cache.dependencies}` (unchanged set for now — Task 6 splits intra vs cross), `violations={violations}`
- `onMoveBar={(id, delta) => onBarMoved(id, delta, itemDateRange(id, effectiveCellValues, startSourceId!), startSourceId!, endSourceId, setCellArg => mutations.setCell(...))}` — copy the exact body of today's `handleDragEnd`.
- `onResizeBar={(id, end) => onBarResized(id, end, itemDateRange(...), startSourceId!, endSourceId, ...)}` — copy today's body.
- `onAddDependency={(v) => addDependency(v)}`, `onRemoveDependency={(v) => removeDependency(v)}`
- `canEditItem={() => !readOnly && access !== "viewer"}` (match today's read-only conditions exactly — check how `readOnly` and access are combined today and reproduce).
- `linkCandidates={(row) => timelineRows.filter((o) => o.itemId !== row.itemId).map((o) => ({ itemId: o.itemId, name: o.name }))}` — mirror today's `otherItems`.
- `onItemTap={handleItemTap}`, `onStubTap={() => {}}` (Task 6 wires it), `footer={<UnscheduledSection rows={unscheduledRows} onItemTap={handleItemTap} />}`.

- [ ] **Step 9: Run the baseline tests + the new test**

Run: `pnpm vitest run --project unit src/components/boards/GanttBoard.test.tsx src/components/boards/GanttBoard.intel.test.tsx src/lib/boards/gantt.test.ts src/components/boards/BoardViews.test.tsx src/components/boards/gantt/GanttCanvas.test.tsx`
Expected: all PASS. Do **not** change existing test expectations; if one fails, the extraction changed behaviour — fix the code.

- [ ] **Step 10: Full gates**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add src/components/boards/gantt/GanttCanvas.tsx src/components/boards/gantt/GanttCanvas.test.tsx src/components/boards/gantt/LinkStubs.tsx src/components/boards/GanttBoard.tsx src/components/boards/gantt/GanttRowItem.tsx src/lib/boards/gantt.ts
git commit -m "refactor(gantt): extract board-agnostic gantt canvas"
```

---

## Task 4: Board dependency data — load, realtime, context action, hook

**Files:**

- Modify: `src/lib/boards/queries.ts` (≈L262-267), `src/lib/boards/use-board-realtime.ts` (≈L42-84), `src/lib/boards/dependency-actions.ts`, `src/lib/boards/dependency-actions.test.ts`
- Create: `src/lib/boards/use-dependency-context.ts`, `src/lib/boards/use-dependency-context.test.tsx`

**Interfaces:**

- Consumes: Task 1 RPC `board_dependency_context` + regenerated types; Task 2 `dependencyContextSchema`, `DependencyContext`.
- Produces:
  - `getBoardDependencyContext(input: { boardId: string }): Promise<ActionResult<DependencyContext>>` in `dependency-actions.ts`.
  - `dependencyContextKey(boardId: string): readonly ["board-dep-context", string]`.
  - `useDependencyContext(boardId: string, dependencies: readonly { board_id: string; predecessor_board_id: string }[]): { data: DependencyContext | undefined; isPending: boolean }` — fetches only when some dependency has `board_id !== predecessor_board_id`; otherwise returns `{ data: { boards: [], items: [] }, isPending: false }`.
  - Board payload `dependencies` now include links where the board is either end; realtime delivers both.

- [ ] **Step 1: Write the failing action test**

Append to `src/lib/boards/dependency-actions.test.ts` (reuse its existing `@/lib/supabase/server` mock; read the file's top to see how `rpc` is mocked and how a mocked return is set):

```ts
describe("getBoardDependencyContext", () => {
  it("rejects a non-uuid board id", async () => {
    const res = await getBoardDependencyContext({ boardId: "nope" });
    expect(res.ok).toBe(false);
  });
  it("returns parsed context", async () => {
    rpc.mockResolvedValueOnce({ data: { boards: [], items: [] }, error: null });
    const res = await getBoardDependencyContext({
      boardId: "11111111-1111-4111-8111-111111111111",
    });
    expect(res).toEqual({ ok: true, data: { boards: [], items: [] } });
    expect(rpc).toHaveBeenCalledWith("board_dependency_context", {
      p_board_id: "11111111-1111-4111-8111-111111111111",
    });
  });
  it("maps rpc errors to a failure", async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "board not found", code: "P0002" },
    });
    const res = await getBoardDependencyContext({
      boardId: "11111111-1111-4111-8111-111111111111",
    });
    expect(res).toEqual({ ok: false, error: "Couldn't load linked items." });
  });
});
```

Adjust the variable name `rpc` to whatever the file's mock exposes, and add `getBoardDependencyContext` to its import.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run --project unit src/lib/boards/dependency-actions.test.ts`
Expected: FAIL — `getBoardDependencyContext` not exported.

- [ ] **Step 3: Implement the action**

Add to `src/lib/boards/dependency-actions.ts`:

```ts
import { z } from "zod";
import { typedRpc } from "@/lib/supabase/typed-rpc";
import {
  dependencyContextSchema,
  type DependencyContext,
} from "@/lib/boards/timeline-context";

export async function getBoardDependencyContext(input: {
  boardId: string;
}): Promise<ActionResult<DependencyContext>> {
  const parsed = z.string().uuid().safeParse(input.boardId);
  if (!parsed.success) return fail("Invalid board.");
  const supabase = await createClient();
  const { data, error } = await typedRpc(supabase, "board_dependency_context", {
    p_board_id: parsed.data,
  });
  if (error) return fail("Couldn't load linked items.");
  const ctx = dependencyContextSchema.safeParse(
    data ?? { boards: [], items: [] },
  );
  if (!ctx.success) return fail("Couldn't load linked items.");
  return { ok: true, data: ctx.data };
}
```

Match the file's existing imports (`createClient`, `fail`, `ActionResult` are already imported). If the mock in the test file mocks `supabase.rpc` and `typedRpc` calls `supabase.rpc` underneath, no extra mock is needed — confirm by reading `typed-rpc.ts`.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run --project unit src/lib/boards/dependency-actions.test.ts`
Expected: PASS.

- [ ] **Step 5: Load deps where the board is either end**

In `src/lib/boards/queries.ts` replace `.eq("board_id", boardId)` on the `item_dependencies` query with:

```ts
.or(`board_id.eq.${boardId},predecessor_board_id.eq.${boardId}`)
```

`boardId` is already validated as a uuid upstream of this query; confirm by reading the function head — if it is not, validate it with `z.string().uuid()` before building the filter.

- [ ] **Step 6: Subscribe to both ends in realtime**

In `src/lib/boards/use-board-realtime.ts`, next to the existing `item_dependencies` listener (`filter`), add a second `.on("postgres_changes", { event: "*", schema: "public", table: "item_dependencies", filter: \`predecessor_board_id=eq.${boardId}\` }, handler)`using the same handler.`applyDependency`in`realtime-buffer.ts`is idempotent on id, so a same-board link arriving on both listeners is safe. Add a test case to the existing realtime test (find it with`ls src/lib/boards | grep -i realtime`) asserting two `item_dependencies` subscriptions with those two filters; follow that file's channel-mock pattern.

- [ ] **Step 7: Write the failing hook test**

```tsx
// src/lib/boards/use-dependency-context.test.tsx
import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const getBoardDependencyContext = vi.fn(async () => ({
  ok: true,
  data: { boards: [], items: [] },
}));
vi.mock("@/lib/boards/dependency-actions", () => ({
  getBoardDependencyContext,
}));
import { useDependencyContext } from "@/lib/boards/use-dependency-context";

const wrap = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>
    {children}
  </QueryClientProvider>
);

describe("useDependencyContext", () => {
  it("does not fetch when every link is same-board", () => {
    const { result } = renderHook(
      () =>
        useDependencyContext("b1", [
          { board_id: "b1", predecessor_board_id: "b1" },
        ]),
      { wrapper: wrap },
    );
    expect(getBoardDependencyContext).not.toHaveBeenCalled();
    expect(result.current.data).toEqual({ boards: [], items: [] });
  });
  it("fetches once when a cross-board link exists", async () => {
    renderHook(
      () =>
        useDependencyContext("b1", [
          { board_id: "b1", predecessor_board_id: "b2" },
        ]),
      { wrapper: wrap },
    );
    await waitFor(() =>
      expect(getBoardDependencyContext).toHaveBeenCalledWith({ boardId: "b1" }),
    );
  });
});
```

- [ ] **Step 8: Implement the hook**

```ts
// src/lib/boards/use-dependency-context.ts
"use client";
import { useQuery } from "@tanstack/react-query";
import { getBoardDependencyContext } from "@/lib/boards/dependency-actions";
import type { DependencyContext } from "@/lib/boards/timeline-context";

const EMPTY: DependencyContext = { boards: [], items: [] };

export const dependencyContextKey = (boardId: string) =>
  ["board-dep-context", boardId] as const;

/** Foreign ends of this board's cross-board links. No request for same-board-only boards. */
export function useDependencyContext(
  boardId: string,
  dependencies: readonly { board_id: string; predecessor_board_id: string }[],
): { data: DependencyContext | undefined; isPending: boolean } {
  const crossCount = dependencies.filter(
    (d) => d.board_id !== d.predecessor_board_id,
  ).length;
  const q = useQuery({
    queryKey: [...dependencyContextKey(boardId), crossCount],
    queryFn: async () => {
      const res = await getBoardDependencyContext({ boardId });
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
    enabled: crossCount > 0,
    staleTime: 60_000,
  });
  if (crossCount === 0) return { data: EMPTY, isPending: false };
  return { data: q.data, isPending: q.isPending };
}
```

(`crossCount` in the key refetches context when a cross-board link is added/removed via realtime — one request per change, only on boards that have such links.)

- [ ] **Step 9: Run tests + gates**

Run: `pnpm vitest run --project unit src/lib/boards/use-dependency-context.test.tsx src/lib/boards/dependency-actions.test.ts && pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/lib/boards/queries.ts src/lib/boards/use-board-realtime.ts src/lib/boards/dependency-actions.ts src/lib/boards/dependency-actions.test.ts src/lib/boards/use-dependency-context.ts src/lib/boards/use-dependency-context.test.tsx
git commit -m "feat(deps): load cross-board links and their foreign context per board"
```

(Add the realtime test file path you changed.)

---

## Task 5: Folder Timeline tab

**Files:**

- Modify: `src/lib/validations/folder-layout.ts` (L27, L32), `src/lib/validations/folder-layout.test.ts`
- Modify: `src/lib/folders/presets.ts` (L69-99), `src/lib/folders/layout.test.ts` (L35-40)
- Modify: `src/components/folders/edit/use-layout-draft.ts`, `use-layout-draft.test.ts` (L143-152), `SectionsSheet.tsx`
- Modify: `src/lib/folders/resolve.ts`, `src/lib/folders/actions.ts`
- Create: `src/lib/folders/timeline.ts`, `src/lib/folders/timeline.test.ts`
- Create: `src/components/folders/tabs/Timeline.tsx`, `src/components/folders/tabs/TimelineInner.tsx`, `src/components/folders/tabs/Timeline.test.tsx`
- Modify: `src/components/folders/CommandCenter.tsx` (L186-233), `src/components/folders/CommandCenter.test.tsx`
- Create: `src/components/folders/no-gantt-in-first-paint.test.ts`

**Interfaces:**

- Consumes: Task 1 RPC `folder_timeline` (+ types); Task 2 `folderTimelineSchema`, `FolderTimelineData`, `TimelineBoard`, `boardScheduleOf`, `contextCellValues`, `contextSpans`, `crossBoardStubs`, `ExternalLinkStub`; Task 3 `GanttCanvas`, `GanttRow.kind/level`; existing `buildGanttRows`, `detectViolations`, `onBarMoved`, `onBarResized`, `timelineDayCount` (`src/lib/boards/gantt.ts`), `itemDateRange` (`dates.ts`), `stageKey` (`src/lib/folders/stages.ts`), `upsertCell` (`@/lib/boards/actions`), `createDependency`/`deleteDependency` (`@/lib/boards/dependency-actions`).
- Produces:
  - Tab kind `"timeline"` (singleton) and `TIMELINE_TAB = { id: "timeline", label: "Timeline", kind: "timeline" }` in the project preset after Stages.
  - Layout draft action `addTab(kind: "timeline")`.
  - `resolveFolderTimeline(supabase, folderId): Promise<{ ok: true; data: FolderTimelineData } | { ok: false; error: string }>`; `getFolderTimeline(input: { folderId: string }): Promise<ActionResult<FolderTimelineData>>`.
  - `buildFolderTimeline(data: FolderTimelineData, opts: { stageKey: string | null; boardId: string | null; expanded: ReadonlySet<string>; zoom: TimelineZoom; collapsedBoards: ReadonlySet<string> }): FolderTimelineView` where `FolderTimelineView = { rows: GanttRow[]; dependencies: GanttDependency[]; externalLinks: Map<string, ExternalLinkStub[]>; violations: Set<string>; rangeStartISO: string; dayCount: number; boardOfItem: Map<string, string>; noDateBoards: Set<string> }`.
  - `folderTimelineKey(folderId: string) = ["folder-timeline", folderId] as const`.

- [ ] **Step 1: Register the tab kind (tests first)**

In `src/lib/validations/folder-layout.test.ts` add:

```ts
it("accepts a single timeline tab and rejects a duplicate", () => {
  const base = {
    v: 1 as const,
    tabs: [
      {
        id: "overview",
        label: "Overview",
        kind: "canvas" as const,
        sections: [],
      },
    ],
  };
  expect(
    folderLayoutConfigSchema.safeParse({
      ...base,
      tabs: [
        ...base.tabs,
        { id: "timeline", label: "Timeline", kind: "timeline" },
      ],
    }).success,
  ).toBe(true);
  expect(
    folderLayoutConfigSchema.safeParse({
      ...base,
      tabs: [
        ...base.tabs,
        { id: "timeline", label: "Timeline", kind: "timeline" },
        { id: "t2", label: "T2", kind: "timeline" },
      ],
    }).success,
  ).toBe(false);
});
```

Update `src/lib/folders/layout.test.ts` L35-40 to expect `["overview", "stages", "timeline", "boards", "people"]`. Update `use-layout-draft.test.ts` L143-152 so the hide-sequence expectations include `"timeline"` (after hiding people: `["overview","stages","timeline","boards"]`; then hide stages, timeline, boards, overview → length 1). Read each test before editing and keep its intent.

Run: `pnpm vitest run --project unit src/lib/validations/folder-layout.test.ts src/lib/folders/layout.test.ts src/components/folders/edit/use-layout-draft.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implement the kind + preset**

`src/lib/validations/folder-layout.ts`:

```ts
export const TAB_KINDS = [
  "canvas",
  "stages",
  "boards",
  "people",
  "timeline",
] as const;
const SINGLETON_KINDS = ["stages", "boards", "people", "timeline"] as const;
```

`src/lib/folders/presets.ts` next to the other tab constants:

```ts
const TIMELINE_TAB = {
  id: "timeline",
  label: "Timeline",
  kind: "timeline",
} as const;
```

and `PRESETS.project.tabs` becomes `[overview, STAGES_TAB, TIMELINE_TAB, BOARDS_TAB, PEOPLE_TAB]`.

Run the three test files again. Expected: PASS.

- [ ] **Step 3: "Add Timeline tab" in the layout editor (tests first)**

Add to `use-layout-draft.test.ts`:

```ts
it("addTab adds a missing timeline tab once, respecting the 6-tab cap", () => {
  const { result } = renderHook(() => useLayoutDraft(PRESETS.support));
  act(() => result.current.addTab("timeline"));
  expect(result.current.config.tabs.map((t) => t.kind)).toContain("timeline");
  act(() => result.current.addTab("timeline"));
  expect(
    result.current.config.tabs.filter((t) => t.kind === "timeline"),
  ).toHaveLength(1);
  expect(
    folderLayoutConfigSchema.safeParse(result.current.config).success,
  ).toBe(true);
});
```

(Use the file's existing imports for `renderHook`, `act`, `PRESETS`, `folderLayoutConfigSchema`; add what is missing.)

Implement in `use-layout-draft.ts`: add `| { type: "addTab"; kind: "timeline" }` to `Action`; reducer case:

```ts
case "addTab": {
  if (state.config.tabs.some((t) => t.kind === action.kind)) return state;
  if (state.config.tabs.length >= 6) return state;
  const tabs = [...state.config.tabs, { id: "timeline", label: "Timeline", kind: "timeline" as const }];
  return { config: { ...state.config, tabs }, dirty: true };
}
```

If a non-timeline tab already uses id `"timeline"`, use `"timeline-2"`. Expose `const addTab = useCallback((kind: "timeline") => dispatch({ type: "addTab", kind }), []);` and return it. In `SectionsSheet.tsx`, under the Tabs `<ul>`, render a `Button` variant="outline" size="sm" "Add Timeline tab" shown only when no tab has `kind === "timeline"` and `tabs.length < 6`, calling a new `onAddTimelineTab` prop; thread that prop from wherever `SectionsSheet` receives `onHideTab` (find with `grep -rn "onHideTab" src/components/folders`) to `draft.addTab("timeline")`. Add an assertion to the existing SectionsSheet/CustomizeBar test that the button appears and calls the handler.

Run: `pnpm vitest run --project unit src/components/folders/edit`
Expected: PASS.

- [ ] **Step 4: Resolver + server action (tests first)**

Add to the folder actions test (find it: `src/lib/folders/actions.test.ts`), following how `getFolderWorkload` is tested there:

```ts
it("getFolderTimeline rejects a bad id and returns parsed data", async () => {
  expect((await getFolderTimeline({ folderId: "x" })).ok).toBe(false);
  rpc.mockResolvedValueOnce({
    data: {
      board_order: [],
      boards: [],
      items: [],
      external_item_ids: [],
      dependencies: [],
      total_items: 0,
      truncated: false,
    },
    error: null,
  });
  const res = await getFolderTimeline({
    folderId: "11111111-1111-4111-8111-111111111111",
  });
  expect(res.ok && res.data.truncated).toBe(false);
});
```

Implement in `src/lib/folders/resolve.ts` (same file conventions — `import "server-only"`, `mapRpcError`, `mapZodError`):

```ts
export async function resolveFolderTimeline(
  supabase: SupabaseClient<Database>,
  folderId: string,
): Promise<
  { ok: true; data: FolderTimelineData } | { ok: false; error: string }
> {
  const { data, error } = await typedRpc(supabase, "folder_timeline", {
    p_folder_id: folderId,
  });
  if (error) return { ok: false, error: mapRpcError(error, "folder_timeline") };
  const parsed = folderTimelineSchema.safeParse(data);
  if (!parsed.success)
    return { ok: false, error: mapZodError(parsed.error, "folder_timeline") };
  return { ok: true, data: parsed.data };
}
```

and in `src/lib/folders/actions.ts`:

```ts
export async function getFolderTimeline(input: {
  folderId: string;
}): Promise<ActionResult<FolderTimelineData>> {
  const parsed = folderIdSchema.safeParse(input.folderId);
  if (!parsed.success) return fail("Invalid folder.");
  const supabase = await createClient();
  const res = await resolveFolderTimeline(supabase, parsed.data);
  if (!res.ok) return fail(res.error);
  return { ok: true, data: res.data };
}
```

Run: `pnpm vitest run --project unit src/lib/folders/actions.test.ts`
Expected: PASS.

- [ ] **Step 5: Row builder (tests first)**

```ts
// src/lib/folders/timeline.test.ts
import { describe, expect, it } from "vitest";
import { buildFolderTimeline } from "@/lib/folders/timeline";
import type { FolderTimelineData } from "@/lib/boards/timeline-context";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const X = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const GA = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const GB = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const DA = "f0000000-0000-4000-8000-00000000000a";
const DB = "f0000000-0000-4000-8000-00000000000b";

const item = (
  id: string,
  board: string,
  group: string,
  name: string,
  col: string,
  date: string,
) => ({
  id,
  board_id: board,
  group_id: group,
  parent_id: null,
  name,
  position: 0,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
  dates: { [col]: { date } },
});

const data: FolderTimelineData = {
  board_order: [A, B],
  boards: [
    {
      id: A,
      name: "Platform",
      can_edit: true,
      date_columns: [{ id: DA, name: "Due" }],
      timeline_config: null,
      groups: [{ id: GA, name: "MVP", color: "#888", position: 0 }],
    },
    {
      id: B,
      name: "Sites",
      can_edit: false,
      date_columns: [{ id: DB, name: "Due" }],
      timeline_config: null,
      groups: [{ id: GB, name: "Pilot", color: "#888", position: 0 }],
    },
    {
      id: X,
      name: "Regulatory",
      can_edit: false,
      date_columns: [],
      timeline_config: null,
      groups: [],
    },
  ],
  items: [
    item("a1", A, GA, "QCC build", DA, "2026-11-10"),
    item("b1", B, GB, "Site survey", DB, "2026-11-05"),
    { ...item("x1", X, GA, "Permit", DA, "2026-11-01"), dates: {} },
  ],
  external_item_ids: ["x1"],
  dependencies: [
    { id: "d1", predecessor_id: "a1", successor_id: "b1" },
    { id: "d2", predecessor_id: "x1", successor_id: "a1" },
  ],
  total_items: 2,
  truncated: false,
};

const opts = {
  stageKey: null,
  boardId: null,
  expanded: new Set<string>(),
  zoom: "month" as const,
  collapsedBoards: new Set<string>(),
};

describe("buildFolderTimeline", () => {
  it("emits board bands, group bands and items in folder order", () => {
    const v = buildFolderTimeline(data, opts);
    expect(v.rows.map((r) => `${r.kind ?? "item"}:${r.name}`)).toEqual([
      "section:Platform",
      "section:MVP",
      "item:QCC build",
      "section:Sites",
      "section:Pilot",
      "item:Site survey",
    ]);
  });
  it("draws in-folder links as arrows and flags the late one", () => {
    const v = buildFolderTimeline(data, opts);
    expect(v.dependencies.map((d) => d.id)).toEqual(["d1"]);
    expect(v.violations.has("d1")).toBe(true); // b1 starts 11-05, before a1 ends 11-10
  });
  it("turns links to external items into stubs", () => {
    const v = buildFolderTimeline(data, opts);
    expect(v.externalLinks.get("a1")?.[0]).toMatchObject({
      itemName: "Permit",
      boardName: "Regulatory",
      direction: "waiting_on",
    });
  });
  it("filters by stage (group name) and board", () => {
    expect(
      buildFolderTimeline(data, { ...opts, stageKey: "pilot" }).rows.map(
        (r) => r.name,
      ),
    ).toEqual(["Sites", "Pilot", "Site survey"]);
    expect(
      buildFolderTimeline(data, { ...opts, boardId: A }).rows.map(
        (r) => r.name,
      ),
    ).toEqual(["Platform", "MVP", "QCC build"]);
  });
  it("collapses a board band to its header", () => {
    expect(
      buildFolderTimeline(data, {
        ...opts,
        collapsedBoards: new Set([A]),
      }).rows.map((r) => r.name),
    ).toEqual(["Platform", "Sites", "Pilot", "Site survey"]);
  });
});
```

Run: `pnpm vitest run --project unit src/lib/folders/timeline.test.ts` → FAIL.

Implement `src/lib/folders/timeline.ts`:

```ts
import type { CacheItem } from "@/lib/boards/cache";
import {
  crossBoardStubs,
  type ExternalLinkStub,
} from "@/lib/boards/cross-board";
import {
  isSyntheticDateSource,
  syntheticDateCellValues,
} from "@/lib/boards/dates";
import {
  buildGanttRows,
  detectViolations,
  timelineDayCount,
  visibleRows,
  type GanttDependency,
  type GanttRow,
} from "@/lib/boards/gantt";
import {
  ZOOM_DAY_COUNT,
  todayISO,
  type TimelineZoom,
} from "@/components/boards/gantt/utils";
import {
  boardScheduleOf,
  contextCellValues,
  contextSpans,
  type FolderTimelineData,
  type TimelineItem,
} from "@/lib/boards/timeline-context";
import { stageKey } from "@/lib/folders/stages";

export const folderTimelineKey = (folderId: string) =>
  ["folder-timeline", folderId] as const;

export type FolderTimelineView = {
  rows: GanttRow[];
  dependencies: GanttDependency[];
  externalLinks: Map<string, ExternalLinkStub[]>;
  violations: Set<string>;
  rangeStartISO: string;
  dayCount: number;
  boardOfItem: Map<string, string>;
  noDateBoards: Set<string>;
};

export function buildFolderTimeline(
  data: FolderTimelineData,
  opts: {
    stageKey: string | null;
    boardId: string | null;
    expanded: ReadonlySet<string>;
    zoom: TimelineZoom;
    collapsedBoards: ReadonlySet<string>;
  },
): FolderTimelineView {
  const boards = new Map(data.boards.map((b) => [b.id, b]));
  const external = new Set(data.external_item_ids);
  const local = data.items.filter((i) => !external.has(i.id));
  const spans = contextSpans({ boards: data.boards, items: data.items });

  // Global range: earliest start (or today) .. latest end, floored by the zoom window.
  let min: string | null = null;
  let max: string | null = null;
  for (const it of local) {
    const s = spans.get(it.id);
    if (!s) continue;
    if (min === null || s.start < min) min = s.start;
    if (max === null || s.end > max) max = s.end;
  }
  const rangeStartISO = min ?? todayISO();
  const dayCount = timelineDayCount(
    rangeStartISO,
    max ?? rangeStartISO,
    ZOOM_DAY_COUNT[opts.zoom],
  );

  const rows: GanttRow[] = [];
  const boardOfItem = new Map<string, string>();
  const noDateBoards = new Set<string>();
  for (const boardId of data.board_order) {
    if (opts.boardId && boardId !== opts.boardId) continue;
    const board = boards.get(boardId);
    if (!board) continue;
    const groups = board.groups.filter(
      (g) => opts.stageKey === null || stageKey(g.name) === opts.stageKey,
    );
    if (groups.length === 0) continue;
    rows.push({
      itemId: `board:${boardId}`,
      name: board.name,
      scheduled: false,
      kind: "section",
      level: 0,
    });
    if (opts.collapsedBoards.has(boardId)) continue;
    const schedule = boardScheduleOf(board);
    if (!schedule.startSourceId) {
      noDateBoards.add(boardId);
      continue;
    }
    const synthetic = [schedule.startSourceId, schedule.endSourceId].filter(
      (id): id is string => isSyntheticDateSource(id),
    );
    for (const g of groups) {
      const groupItems = local.filter((i) => i.group_id === g.id);
      if (groupItems.length === 0) continue;
      rows.push({
        itemId: `group:${g.id}`,
        name: g.name,
        scheduled: false,
        kind: "section",
        level: 1,
      });
      const cacheItems = groupItems as unknown as CacheItem[];
      const cells = [
        ...contextCellValues(groupItems),
        ...(synthetic.length
          ? syntheticDateCellValues(cacheItems, synthetic)
          : []),
      ];
      const built = buildGanttRows(
        cacheItems,
        cells,
        schedule.startSourceId,
        schedule.endSourceId,
        rangeStartISO,
        dayCount,
        opts.zoom,
      ).rows;
      for (const r of visibleRows(built, opts.expanded)) {
        rows.push(r);
        boardOfItem.set(r.itemId, boardId);
      }
    }
  }

  const inView = new Set(boardOfItem.keys());
  const dependencies = data.dependencies.filter(
    (d) => inView.has(d.predecessor_id) && inView.has(d.successor_id),
  );
  const itemRows = rows.filter((r) => r.kind !== "section");
  const violations = detectViolations(itemRows, dependencies);
  const externalItems: TimelineItem[] = data.items.filter(
    (i) => !inView.has(i.id),
  );
  const externalLinks = crossBoardStubs({
    dependencies: data.dependencies,
    localItemIds: inView,
    localSpans: spans,
    context: { boards: data.boards, items: externalItems },
    contextSpans: spans,
  });
  return {
    rows,
    dependencies,
    externalLinks,
    violations,
    rangeStartISO,
    dayCount,
    boardOfItem,
    noDateBoards,
  };
}
```

Check `buildGanttRows`' parameters on `CacheItem` (it calls `bucketItems` — needs `parent_id`, `position`, `id`, `name`); if it reads other `CacheItem` fields, add them to the cast object. Check `ZOOM_DAY_COUNT`/`todayISO` names in `gantt/utils.ts` and that `visibleRows(rows, expanded)` keeps top-level rows when nothing is expanded. Note: items from other folder boards that are filtered out by stage/board become external stubs — intended.

Run: `pnpm vitest run --project unit src/lib/folders/timeline.test.ts` → PASS. If the "late" assertion fails because `detectViolations` compares different fields, align the fixture dates, not the rule.

- [ ] **Step 6: Lazy tab shell + inner (tests first)**

Load `pulse-ui` + `frontend-design`. Write `src/components/folders/tabs/Timeline.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const getFolderTimeline = vi.fn();
vi.mock("@/lib/folders/actions", () => ({ getFolderTimeline }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/boards/gantt/GanttCanvas", () => ({
  GanttCanvas: (p: { rows: { name: string }[] }) => (
    <div data-testid="canvas">{p.rows.map((r) => r.name).join("|")}</div>
  ),
}));
import { TimelineInner } from "./TimelineInner";

const wrap = (ui: React.ReactNode) => (
  <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>
);
const empty = {
  board_order: [],
  boards: [],
  items: [],
  external_item_ids: [],
  dependencies: [],
  total_items: 0,
  truncated: false,
};

describe("TimelineInner", () => {
  it("shows the cap notice when truncated", async () => {
    getFolderTimeline.mockResolvedValueOnce({
      ok: true,
      data: { ...empty, total_items: 6200, truncated: true },
    });
    render(wrap(<TimelineInner folderId="f1" stage={null} board={null} />));
    expect(
      await screen.findByText("Showing the first 5,000 of 6,200 items"),
    ).toBeInTheDocument();
  });
  it("shows the load error", async () => {
    getFolderTimeline.mockResolvedValueOnce({
      ok: false,
      error: "Folder not found.",
    });
    render(wrap(<TimelineInner folderId="f1" stage={null} board={null} />));
    expect(
      await screen.findByText(/Couldn.t load the timeline/),
    ).toBeInTheDocument();
  });
});
```

Implement `Timeline.tsx`:

```tsx
"use client";
import dynamic from "next/dynamic";

export const TimelineTab = dynamic(
  () =>
    import("@/components/folders/tabs/TimelineInner").then(
      (m) => m.TimelineInner,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="bg-muted/40 h-64 w-full animate-pulse rounded-md" />
    ),
  },
);
```

Implement `TimelineInner.tsx` (`"use client"`), props `{ folderId: string; stage: string | null; board: string | null }`:

- `useQuery({ queryKey: folderTimelineKey(folderId), queryFn: () => getFolderTimeline({ folderId }).then(r => { if (!r.ok) throw new Error(r.error); return r.data; }), staleTime: 60_000 })`. Pending → `Skeleton h-40`; error → `EmptyState variant="inline"`: "Couldn't load the timeline. {message}" (same components as `People.tsx`).
- Local state: `zoom` (default `"month"`, segmented control Week/Month/Quarter using the same labels as the board Gantt), `expanded: Set<string>`, `collapsedBoards: Set<string>`. No URL writes for these.
- `view = useMemo(() => buildFolderTimeline(data, { stageKey: stage, boardId: board, expanded, zoom, collapsedBoards }), …)`.
- Notice when `data.truncated`: "Showing the first {total.toLocaleString("en-US") of shown} …" — exact text `Showing the first ${(data.total_items > 5000 ? 5000 : data.total_items).toLocaleString("en-US")} of ${data.total_items.toLocaleString("en-US")} items`.
- Board bands with no dates: render the band label with the muted note "No dates on this board" (pass via a `name` suffix or a section-row prop; simplest: in `TimelineInner`, map rows whose `itemId === "board:" + id` and `view.noDateBoards.has(id)` to `name: \`${name} · No dates on this board\``).
- Section band click toggles `collapsedBoards` for `board:` rows (pass `onToggleExpand` handling ids starting with `board:`; item ids toggle `expanded`).
- `canEditItem = (id) => { const b = boards.get(view.boardOfItem.get(id)!); return !!b?.can_edit && !boardScheduleOf(b).readOnly; }`
- `onMoveBar(id, delta)` / `onResizeBar(id, end)`: find the item's board schedule; build `cells = contextCellValues(data.items)`; call `onBarMoved(id, delta, itemDateRange(id, cells, startSourceId), startSourceId, endSourceId, setCell)` / `onBarResized(...)` exactly like `GanttBoard` does, where `setCell = ({ itemId, columnId, value }) => cellMutation.mutate({ itemId, columnId, value })`.
- `cellMutation = useMutation({ mutationFn: (v) => upsertCell(v).then(r => { if (!r.ok) throw new Error(r.error); }), onMutate: patch `data.items[i].dates[columnId] = value`in`folderTimelineKey(folderId)`via`queryClient.setQueryData`and return the prior snapshot, onError: restore snapshot +`toast.error(err.message)` })`. No invalidate, no `router.refresh()`.
- `onAddDependency(v)`: `createDependency(v)`; on ok, `setQueryData` appending `{ id: res.data.dependencyId, predecessor_id, successor_id }`; on failure `toast.error(res.error)`.
- `onRemoveDependency({ dependencyId })`: optimistic removal from query data, `deleteDependency`, restore + toast on failure.
- `linkCandidates(row)`: items in view on boards the viewer can read (all of `view.boardOfItem` keys except the row), `{ itemId, name: \`${name} · ${boardName}\` }`, capped at 200 entries sorted by name.
- `onItemTap(id)` and `onStubTap(stub)`: `router.push(\`/boards/${boardId}?item=${itemId}\`)` (spec deviation, recorded below: the folder page has no item panel, so the item opens on its board).

Run: `pnpm vitest run --project unit src/components/folders/tabs/Timeline.test.tsx` → PASS.

- [ ] **Step 7: Render the kind in CommandCenter + bundle guard**

In `CommandCenter.tsx` add a branch before the Overview fallback:

```tsx
: activeTab?.kind === "timeline" ? (
  <TimelineTab folderId={payload.folder.id} stage={stage} board={board} />
)
```

importing `TimelineTab` from `@/components/folders/tabs/Timeline`. Add `getFolderTimeline: vi.fn(async () => ({ ok: true, data: { board_order: [], boards: [], items: [], external_item_ids: [], dependencies: [], total_items: 0, truncated: false } }))` to the `@/lib/folders/actions` mock in `CommandCenter.test.tsx`, and a test: clicking the "Timeline" tab calls `getFolderTimeline` once, while rendering Overview first does not call it (mirror the existing lazy workload assertion).

Create `src/components/folders/no-gantt-in-first-paint.test.ts` copying `no-recharts-in-first-paint.test.ts`, with `INNER` = the absolute path of `src/components/boards/gantt/GanttCanvas.tsx` and the assertion that it is not statically reachable from `CommandCenter.tsx`.

Run: `pnpm vitest run --project unit src/components/folders`
Expected: PASS (existing assertions like `/Stages 4/` and `/Boards 3/` must still hold).

- [ ] **Step 8: Full gates**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/lib/validations/folder-layout.ts src/lib/validations/folder-layout.test.ts src/lib/folders/presets.ts src/lib/folders/layout.test.ts src/components/folders/edit/use-layout-draft.ts src/components/folders/edit/use-layout-draft.test.ts src/components/folders/edit/SectionsSheet.tsx src/lib/folders/resolve.ts src/lib/folders/actions.ts src/lib/folders/actions.test.ts src/lib/folders/timeline.ts src/lib/folders/timeline.test.ts src/components/folders/tabs/Timeline.tsx src/components/folders/tabs/TimelineInner.tsx src/components/folders/tabs/Timeline.test.tsx src/components/folders/CommandCenter.tsx src/components/folders/CommandCenter.test.tsx src/components/folders/no-gantt-in-first-paint.test.ts
git commit -m "feat(folders): add editable folder timeline tab across boards"
```

(Add any SectionsSheet/CustomizeBar test file and prop-threading file you touched.)

---

## Task 6: Board Gantt — cross-board stubs

**Files:**

- Modify: `src/components/boards/GanttBoard.tsx`, `src/components/boards/GanttBoard.test.tsx`

**Interfaces:**

- Consumes: Task 3 `GanttCanvas` props `dependencies`, `externalLinks`, `onStubTap`; Task 4 `useDependencyContext`, board cache deps carrying `predecessor_board_id`; Task 2 `crossBoardStubs`, `contextSpans`, `scheduleFromPicks`.
- Produces: board Gantt arrows only for same-board links; cross-board links as stubs with late flags; stub tap navigates to `/boards/{boardId}?item={itemId}`.

- [ ] **Step 1: Write the failing test**

In `GanttBoard.test.tsx`, add a case using the file's `payloadFixture()`: give the payload one extra dependency `{ id: "x-dep", board_id: <fixture board id>, predecessor_board_id: "99999999-9999-4999-8999-999999999999", predecessor_id: "ext-1", successor_id: <a fixture item id with dates>, org_id, created_at, type: "FS" }`, mock `@/lib/boards/use-dependency-context` to return `{ data: { boards: [{ id: "99999999-…", name: "Regulatory", can_edit: false, date_columns: [], timeline_config: null, groups: [] }], items: [{ id: "ext-1", board_id: "99999999-…", group_id: <any uuid>, parent_id: null, name: "Permit", position: 0, created_at: "", updated_at: "", dates: {} }] }, isPending: false }`, render, and assert `screen.getByRole("button", { name: /Waiting on Permit · Regulatory/ })` exists and clicking it calls the mocked router `push` with `/boards/99999999-9999-4999-8999-999999999999?item=ext-1`. Also assert no arrow path is drawn for `x-dep` (query the arrow SVG by the attribute the file's existing arrow tests use).

Run: `pnpm vitest run --project unit src/components/boards/GanttBoard.test.tsx` → FAIL.

- [ ] **Step 2: Implement**

In `GanttBoard.tsx`:

```ts
const ctx = useDependencyContext(payload.board.id, cache.dependencies);
const localIds = useMemo(
  () => new Set(cache.items.map((i) => i.id)),
  [cache.items],
);
const intraDeps = useMemo(
  () =>
    cache.dependencies.filter(
      (d) => localIds.has(d.predecessor_id) && localIds.has(d.successor_id),
    ),
  [cache.dependencies, localIds],
);
const localSpans = useMemo(
  () =>
    new Map(
      timelineRows.map((r) => [
        r.itemId,
        r.startISO && r.endISO
          ? { start: r.startISO, end: r.endISO, isMilestone: !!r.isMilestone }
          : null,
      ]),
    ),
  [timelineRows],
);
const externalLinks = useMemo(() => {
  const context = ctx.data ?? { boards: [], items: [] };
  return crossBoardStubs({
    dependencies: cache.dependencies,
    localItemIds: localIds,
    localSpans,
    context,
    contextSpans: contextSpans(context),
  });
}, [ctx.data, cache.dependencies, localIds, localSpans]);
```

Pass `dependencies={intraDeps}`, `violations={detectViolations(rows, intraDeps)}` (replace the existing `violations` memo input), `externalLinks={externalLinks}`, `onStubTap={(s) => router.push(\`/boards/${s.boardId}?item=${s.itemId}\`)}`(use the`useRouter`the file already uses for`openItemPanel`; if it uses a different navigation helper, use that). Replace the inline start/end/readOnly derivation (`dateColumn`, `startSourceId`, `endSourceId`, `readOnly`) with `const { startSourceId, endSourceId, readOnly } = scheduleFromPicks(dateColumns, startColId, endColId);`— keep`dateColumn` only if still used elsewhere (derive it the same way).

Run: `pnpm vitest run --project unit src/components/boards/GanttBoard.test.tsx src/components/boards/GanttBoard.intel.test.tsx` → PASS.

- [ ] **Step 3: Gates + commit**

Run: `pnpm typecheck && pnpm lint && pnpm test` → PASS.

```bash
git add src/components/boards/GanttBoard.tsx src/components/boards/GanttBoard.test.tsx
git commit -m "feat(gantt): show cross-board links as stubs on the board timeline"
```

---

## Task 7: Item panel — "Waiting on / Blocking"

**Files:**

- Create: `src/lib/boards/dependency-list.ts`, `src/lib/boards/dependency-list.test.ts`
- Create: `src/components/boards/item-panel/DependenciesSection.tsx`, `DependenciesSection.test.tsx`
- Modify: `src/components/boards/item-panel/ItemPanel.tsx` (fields tab, after `FindSimilar` ≈L186), `src/components/boards/BoardViews.tsx` (≈L292)

**Interfaces:**

- Consumes: board cache via `boardKey(boardId)` (`src/lib/boards/use-board-cache.ts`), `BoardCache` (`cache.ts`); Task 4 `useDependencyContext`, `dependencyContextKey`; Task 2 `scheduleFromPicks`/`resolveBoardSchedule`, `contextSpans`, `isLinkLate`, `TimelineViewConfig`; existing `searchItems(query): Promise<{id; name; boardId; boardName}[]>` (`src/lib/search/item-search.ts`), `createDependency`, `deleteDependency`, `resolveTimelineSpan`, `syntheticDateCellValues`.
- Produces:
  - `type DependencyEntry = { dependencyId: string; itemId: string; itemName: string; boardId: string; boardName: string; endISO: string | null; late: boolean; local: boolean }`
  - `buildDependencyList(args: { itemId: string; dependencies: readonly { id: string; predecessor_id: string; successor_id: string }[]; localItems: readonly { id: string; name: string }[]; localBoard: { id: string; name: string }; localSpans: ReadonlyMap<string, TimelineSpan | null>; context: DependencyContext; contextSpans: ReadonlyMap<string, TimelineSpan | null> }): { waitingOn: DependencyEntry[]; blocking: DependencyEntry[] }`
  - `DependenciesSection({ itemId, boardId, boardName, schedule }: { itemId: string; boardId: string; boardName: string; schedule: TimelineViewConfig })`
  - `ItemPanel` gains prop `timelineConfig: TimelineViewConfig` and `boardName: string`.

- [ ] **Step 1: List model (tests first)**

```ts
// src/lib/boards/dependency-list.test.ts
import { describe, expect, it } from "vitest";
import { buildDependencyList } from "@/lib/boards/dependency-list";

const span = (s: string, e: string) => ({
  start: s,
  end: e,
  isMilestone: s === e,
});
const FB = "11111111-1111-4111-8111-111111111111";

describe("buildDependencyList", () => {
  it("splits local and foreign links into waiting-on and blocking with late flags", () => {
    const res = buildDependencyList({
      itemId: "me",
      dependencies: [
        { id: "d1", predecessor_id: "p-local", successor_id: "me" },
        { id: "d2", predecessor_id: "me", successor_id: "f1" },
      ],
      localItems: [
        { id: "me", name: "Me" },
        { id: "p-local", name: "Design" },
      ],
      localBoard: { id: "b0", name: "Platform" },
      localSpans: new Map([
        ["me", span("2026-11-03", "2026-11-12")],
        ["p-local", span("2026-11-01", "2026-11-05")],
      ]),
      context: {
        boards: [
          {
            id: FB,
            name: "Sites",
            can_edit: false,
            date_columns: [],
            timeline_config: null,
            groups: [],
          },
        ],
        items: [
          {
            id: "f1",
            board_id: FB,
            group_id: FB,
            parent_id: null,
            name: "Install",
            position: 0,
            created_at: "",
            updated_at: "",
            dates: {},
          },
        ],
      },
      contextSpans: new Map([["f1", span("2026-11-20", "2026-11-25")]]),
    });
    expect(res.waitingOn).toEqual([
      {
        dependencyId: "d1",
        itemId: "p-local",
        itemName: "Design",
        boardId: "b0",
        boardName: "Platform",
        endISO: "2026-11-05",
        late: true,
        local: true,
      },
    ]);
    expect(res.blocking).toEqual([
      {
        dependencyId: "d2",
        itemId: "f1",
        itemName: "Install",
        boardId: FB,
        boardName: "Sites",
        endISO: "2026-11-25",
        late: false,
        local: false,
      },
    ]);
  });
});
```

Run → FAIL. Implement:

```ts
// src/lib/boards/dependency-list.ts
import type { TimelineSpan } from "@/lib/boards/dates";
import { isLinkLate } from "@/lib/boards/schedule";
import type { DependencyContext } from "@/lib/boards/timeline-context";

export type DependencyEntry = {
  dependencyId: string;
  itemId: string;
  itemName: string;
  boardId: string;
  boardName: string;
  endISO: string | null;
  late: boolean;
  local: boolean;
};

export function buildDependencyList(args: {
  itemId: string;
  dependencies: readonly {
    id: string;
    predecessor_id: string;
    successor_id: string;
  }[];
  localItems: readonly { id: string; name: string }[];
  localBoard: { id: string; name: string };
  localSpans: ReadonlyMap<string, TimelineSpan | null>;
  context: DependencyContext;
  contextSpans: ReadonlyMap<string, TimelineSpan | null>;
}): { waitingOn: DependencyEntry[]; blocking: DependencyEntry[] } {
  const local = new Map(args.localItems.map((i) => [i.id, i]));
  const foreign = new Map(args.context.items.map((i) => [i.id, i]));
  const boards = new Map(args.context.boards.map((b) => [b.id, b]));
  const mySpan = args.localSpans.get(args.itemId) ?? null;
  const waitingOn: DependencyEntry[] = [];
  const blocking: DependencyEntry[] = [];
  for (const d of args.dependencies) {
    const isSucc = d.successor_id === args.itemId;
    const isPred = d.predecessor_id === args.itemId;
    if (!isSucc && !isPred) continue;
    const otherId = isSucc ? d.predecessor_id : d.successor_id;
    let entry: Omit<DependencyEntry, "late"> | null = null;
    let otherSpan: TimelineSpan | null = null;
    const l = local.get(otherId);
    if (l) {
      otherSpan = args.localSpans.get(otherId) ?? null;
      entry = {
        dependencyId: d.id,
        itemId: l.id,
        itemName: l.name,
        boardId: args.localBoard.id,
        boardName: args.localBoard.name,
        endISO: otherSpan?.end ?? null,
        local: true,
      };
    } else {
      const f = foreign.get(otherId);
      const b = f ? boards.get(f.board_id) : undefined;
      if (!f || !b) continue;
      otherSpan = args.contextSpans.get(otherId) ?? null;
      entry = {
        dependencyId: d.id,
        itemId: f.id,
        itemName: f.name,
        boardId: b.id,
        boardName: b.name,
        endISO: otherSpan?.end ?? null,
        local: false,
      };
    }
    if (isSucc)
      waitingOn.push({ ...entry, late: isLinkLate(otherSpan, mySpan) });
    else blocking.push({ ...entry, late: isLinkLate(mySpan, otherSpan) });
  }
  return { waitingOn, blocking };
}
```

Run → PASS.

- [ ] **Step 2: Section component (tests first)**

Load `pulse-ui` + `frontend-design`. Test `DependenciesSection.test.tsx`:

- Seed a `QueryClient` with `qc.setQueryData(boardKey("b0"), cache)` where `cache` is a minimal `BoardCache` (`board`, `groups`, `columns` with one date column, `items` [me, design], `cellValues` with dates, `dependencies` [one same-board link design→me with `predecessor_board_id: "b0"`], and empty arrays for the rest), cast `as BoardCache`.
- Mock `@/lib/boards/use-dependency-context` → `{ data: { boards: [], items: [] }, isPending: false }`.
- Mock `@/lib/boards/dependency-actions` → `createDependency: vi.fn(async () => ({ ok: true, data: { dependencyId: "new" } }))`, `deleteDependency: vi.fn(async () => ({ ok: true, data: undefined }))`.
- Mock `@/lib/search/item-search` → `searchItems: vi.fn(async () => [{ id: "x9", name: "Permit", boardId: "b9", boardName: "Regulatory" }])`.
- Assert: heading "Waiting on" lists "Design" with "Platform"; "Blocking" shows the empty text "Nothing waits on this item."; clicking "Add dependency" → choosing "Waiting on" → typing "per" shows "Permit · Regulatory"; selecting it calls `createDependency({ predecessorId: "x9", successorId: "me" })`; clicking the remove button labelled "Remove link to Design" calls `deleteDependency({ dependencyId: <id> })`.

Implement `DependenciesSection.tsx` (`"use client"`):

- `const { data: cache } = useQuery<BoardCache>({ queryKey: boardKey(boardId), enabled: false });` (subscribes to the live board cache without fetching; if `cache` is undefined render nothing).
- Schedule: `const dateCols = cache.columns.filter(c => c.kind === "date").map(c => ({ id: c.id, name: c.name }))`, `const s = resolveBoardSchedule(dateCols, schedule)`; local spans for `itemId` and every local item linked to it via `resolveTimelineSpan` on `cache.cellValues` (+ `syntheticDateCellValues` when a source is synthetic).
- `const ctx = useDependencyContext(boardId, cache.dependencies)`; `buildDependencyList(...)`.
- Layout: `<section className="space-y-3 border-t pt-4">` with a `Kicker` like `FindSimilar`. Two sub-lists "Waiting on" / "Blocking". Each entry: name (a link: local → `?item=<id>` on this board via the same mechanism `BoardViews` uses to open items; foreign → `/boards/<boardId>?item=<id>`), muted board name, end date (`toLocaleDateString` the way other panel dates are formatted — reuse the panel's date formatter if one exists), a "Late" badge in the destructive token when `late`, and an icon button `aria-label={\`Remove link to ${itemName}\`}`. Empty texts: "Not waiting on anything." / "Nothing waits on this item."
- "Add dependency" button → popover with a two-option segmented control ("Waiting on" | "Blocking") and a search input; debounce 200 ms (`useDebouncedCallback`, as `RelationCell.tsx` does) calling `searchItems(q)` for `q.length >= 2`; drop stale responses with a request-id ref (as `command-palette.tsx` does); exclude `itemId` itself and already-linked ids; render each result as `"{name} · {boardName}"`. Selecting calls `createDependency` with `{ predecessorId: picked, successorId: itemId }` for Waiting on, or `{ predecessorId: itemId, successorId: picked }` for Blocking; on `!ok` show `toast.error(res.error)`; on ok close the popover and `queryClient.invalidateQueries({ queryKey: dependencyContextKey(boardId) })` (the realtime echo adds the row to the board cache).
- Remove: `deleteDependency({ dependencyId })`; on `!ok` `toast.error(res.error)`.
- Read-only viewers: hide "Add dependency" and remove buttons when the board access passed down is viewer — thread an `canEdit: boolean` prop from `ItemPanel` (BoardViews already knows `access`).

Run: `pnpm vitest run --project unit src/components/boards/item-panel/DependenciesSection.test.tsx` → PASS.

- [ ] **Step 3: Mount in the panel**

In `ItemPanel.tsx` lazily import (same `dynamic` pattern as `FindSimilar`) and render after `{itemId && <FindSimilar itemId={itemId} />}`:

```tsx
{
  itemId && (
    <DependenciesSection
      itemId={itemId}
      boardId={boardId}
      boardName={boardName}
      schedule={timelineConfig}
      canEdit={canEdit}
    />
  );
}
```

Add props `boardName: string`, `timelineConfig: TimelineViewConfig`, `canEdit: boolean` to `ItemPanel`. In `BoardViews.tsx` pass `boardName={payload.board.name}`, `timelineConfig={(payload.views.find(v => v.kind === "timeline")?.config ?? null) as TimelineViewConfig}` (first timeline view by position — sort by `position` if `payload.views` is not already ordered), and `canEdit` from the access value BoardViews already holds (match how other editors are gated there). Update `ItemPanel`/`BoardViews` tests that render `ItemPanel` with the new required props.

- [ ] **Step 4: Gates + commit**

Run: `pnpm typecheck && pnpm lint && pnpm test` → PASS.

```bash
git add src/lib/boards/dependency-list.ts src/lib/boards/dependency-list.test.ts src/components/boards/item-panel/DependenciesSection.tsx src/components/boards/item-panel/DependenciesSection.test.tsx src/components/boards/item-panel/ItemPanel.tsx src/components/boards/BoardViews.tsx
git commit -m "feat(items): add waiting on and blocking section to the item panel"
```

(Add any updated ItemPanel/BoardViews test files.)

---

## Task 8: Integration, review, live run, finish (orchestrator only)

- [ ] **Step 1:** In the task worktree, after all tasks are merged into the task branch, run `pnpm typecheck && pnpm lint && pnpm test && pnpm build` (foreground, timeout 600000). Expected: all pass.
- [ ] **Step 2:** Whole-branch review (superpowers:requesting-code-review) against the spec — cross-task defects only a full read catches (memory: whole-branch review).
- [ ] **Step 3:** Live run in Chrome against `pnpm dev` in the worktree (DEV data — create a throwaway folder with two throwaway boards, delete them afterwards):
  1. Board A item "Design" (dates 1–10 Nov), Board B item "Build" (dates 5–20 Nov), both in one folder.
  2. Open "Build" → item panel → Add dependency → Waiting on → search "Design" → pick. Expect "Design · A" with a **Late** badge.
  3. Folder → Timeline tab: both board bands, an arrow from Design to Build drawn red; drag Build to start 11 Nov → arrow no longer red; reload → position persisted.
  4. Board B → Gantt view: Build shows a "↤ Design · A" stub with no Late; click → lands on Board A with Design's panel open.
  5. As a member with access to Board B only: the link is not visible anywhere.
  6. Revert `AGENTS.md` if `next dev` rewrote it.
- [ ] **Step 4:** `scripts/finish-task.sh` from the task worktree (orchestrator only), then the "How to test" walkthrough (Step 3 condensed) in the closing message and the `/wrapup` note.

---

## Execution DAG

Edges (from Interfaces):

- Task 4 ← Task 1 (RPC + types), Task 2 (schemas)
- Task 5 ← Task 1, Task 2, Task 3
- Task 6 ← Task 2, Task 3, Task 4
- Task 7 ← Task 2, Task 4
- Task 8 ← all

Parallel batches (each task in its own worktree off `task/cross-board-timeline`; orchestrator rebases + fast-forwards one at a time — `database.types.ts` is only touched by Task 1):

| Batch | Tasks   | Notes                                                                             |
| ----- | ------- | --------------------------------------------------------------------------------- |
| 1     | 1, 2, 3 | Task 3 may use a local `ExternalLinkStub` type until Task 2 lands, then import it |
| 2     | 4, 5    | Task 5 touches folders only; Task 4 touches board data files only                 |
| 3     | 6, 7    | Disjoint files (GanttBoard vs item panel)                                         |
| 4     | 8       | Orchestrator                                                                      |

Critical path: Task 1 → Task 4 → Task 6/7 → Task 8 (Task 3 → Task 5 runs alongside).

## Spec deviations (recorded)

1. **Folder Timeline filters** use the existing folder filter bar (stage + board). The spec named person/status, which the bar does not have; adding them is out of scope.
2. **Opening an item from the folder Timeline** navigates to `/boards/{id}?item={id}` instead of an in-place panel — the folder page has no item panel and the panel's props are board-bound.
3. **Existing folders with a saved layout** get the tab via a new "Add Timeline tab" button in the layout editor (there was no add-tab path; only preset reset).
4. **Board bands show no done/total.** The `folder_timeline` payload carries no per-item status, so a band cannot count done items without an RPC change. Deferred to the next migration that touches `folder_timeline`.
5. **Board Gantt cannot remove a cross-board link.** Cross-board links render as stubs with no remove entry. They are removed from the item panel ("Waiting on / Blocking") or the folder Timeline instead.
