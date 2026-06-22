# Sidebar per-item actions menu + typography cleanup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-item 3-dots overflow menu (Rename / Duplicate / Delete) to each owned board and each dashboard in the sidebar, and unify sidebar typography with separators between sections.

**Architecture:** Two new Postgres RPCs do a structure-only deep copy (`duplicate_board_structure`, `duplicate_dashboard`); thin `"use server"` actions wrap them plus a new `deleteDashboard`. Two new client components (`BoardItemMenu`, `DashboardItemMenu`) compose existing `dropdown-menu` / `dialog` / `alert-dialog` primitives and call the actions via `useTransition` + `router.refresh()`. Typography is normalized to a two-level hierarchy with `Separator`s.

**Tech Stack:** Next.js 16 (App Router, RSC + Server Actions), Supabase (Postgres RPC + RLS), Zod, React, Tailwind v4 + shadcn, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-06-22-sidebar-board-menu-and-typography-design.md`

**Reference design skills:** Before any UI task (3, 4, 5) load the **`pulse-ui`** and **`frontend-design`** skills — this is mandatory for visual work in this repo (AGENTS.md rule #3).

---

## Pre-flight (working agreement #1)

This is a building session: it MUST run in a worktree, not the main checkout.

- [ ] **Step 0: Create the worktree**

```bash
scripts/start-task.sh sidebar-item-menu
```

Then `cd .claude/worktrees/sidebar-item-menu` (or, for subagent-driven work,
`EnterWorktree({ path: ".claude/worktrees/sidebar-item-menu" })`). All paths below
are relative to the repo root inside that worktree.

---

## File Structure

**Create:**

- `supabase/migrations/20260622140000_duplicate_board_and_dashboard.sql` — both RPCs
- `src/lib/boards/duplicate-board.rls.integration.test.ts` — RPC integration/RLS tests
- `src/lib/dashboards/duplicate-dashboard.rls.integration.test.ts` — RPC integration/RLS tests
- `src/components/boards/BoardItemMenu.tsx` — board overflow menu
- `src/components/boards/BoardItemMenu.test.tsx`
- `src/components/dashboards/DashboardItemMenu.tsx` — dashboard overflow menu
- `src/components/dashboards/DashboardItemMenu.test.tsx`

**Modify:**

- `src/types/database.types.ts` — regenerated (do not hand-edit)
- `src/lib/validations/board-actions.ts` — add `duplicateBoardSchema`
- `src/lib/validations/dashboards.ts` — add `deleteDashboardSchema`, `duplicateDashboardSchema`
- `src/lib/boards/actions.ts` — add `duplicateBoard`
- `src/lib/dashboards/actions.ts` — add `deleteDashboard`, `duplicateDashboard`
- `src/components/boards/BoardsNav.tsx` — typography + row menu integration
- `src/components/dashboards/DashboardsNav.tsx` — typography + row menu integration
- `src/components/sidebar.tsx` — typography + separators
- `src/components/boards/BoardsNav.test.tsx` — update for new row markup if needed

---

## Execution DAG

- **Batch 1 (parallel):** Task 1 → Task 2 (chain: actions need regenerated types) ‖ Task 3 (typography, independent)
- **Batch 2 (parallel, after Tasks 2 + 3):** Task 4 (BoardItemMenu, edits `BoardsNav.tsx`) ‖ Task 5 (DashboardItemMenu, edits `DashboardsNav.tsx`) — different files, no conflict
- **Batch 3:** Task 6 (full gates + manual verification)
- **Critical path:** Task 1 → Task 2 → Task 4/5 → Task 6

---

## Task 1: Duplicate RPCs (migration + types)

**Files:**

- Create: `supabase/migrations/20260622140000_duplicate_board_and_dashboard.sql`
- Create: `src/lib/boards/duplicate-board.rls.integration.test.ts`
- Create: `src/lib/dashboards/duplicate-dashboard.rls.integration.test.ts`
- Modify: `src/types/database.types.ts` (regenerated)

A board's structure = `groups` + `columns` + `board_views` (NOT `items` / `cell_values`).
A dashboard's structure = `dashboard_widgets`. Both RPCs follow the
`security definer` + `set search_path = ''` + `is_org_member` guard pattern of
`public.create_board` (see `supabase/migrations/20260615061747_boards_core.sql:create_board`).

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260622140000_duplicate_board_and_dashboard.sql`:

```sql
-- Structure-only duplication for boards and dashboards.
-- Boards: copies groups + columns + views, NOT items/cell_values.
-- Dashboards: copies all widgets (config + layout).
-- Both are security-definer + org-scoped: the caller must be a member of the
-- source's organization (mirrors public.create_board).

create or replace function public.duplicate_board_structure(p_board_id uuid)
returns public.boards
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_src public.boards;
  v_new public.boards;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select * into v_src from public.boards where id = p_board_id;
  if v_src.id is null then
    raise exception 'board not found' using errcode = 'P0002';
  end if;
  if not public.is_org_member(v_src.org_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;

  insert into public.boards
    (org_id, workspace_id, name, position, created_by, name_column_width)
  values
    (v_src.org_id, v_src.workspace_id,
     left(v_src.name || ' (copy)', 100),
     v_src.position, v_uid, v_src.name_column_width)
  returning * into v_new;

  insert into public.groups (org_id, board_id, name, color, position)
  select v_src.org_id, v_new.id, name, color, position
  from public.groups where board_id = p_board_id;

  insert into public.columns (org_id, board_id, kind, name, settings, position, width)
  select v_src.org_id, v_new.id, kind, name, settings, position, width
  from public.columns where board_id = p_board_id;

  insert into public.board_views (org_id, board_id, kind, name, config, position)
  select v_src.org_id, v_new.id, kind, name, config, position
  from public.board_views where board_id = p_board_id;

  return v_new;
end;
$$;

grant execute on function public.duplicate_board_structure(uuid) to authenticated;

create or replace function public.duplicate_dashboard(p_dashboard_id uuid)
returns public.dashboards
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_src public.dashboards;
  v_new public.dashboards;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select * into v_src from public.dashboards where id = p_dashboard_id;
  if v_src.id is null then
    raise exception 'dashboard not found' using errcode = 'P0002';
  end if;
  if not public.is_org_member(v_src.org_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;

  insert into public.dashboards (org_id, workspace_id, name, created_by)
  values (v_src.org_id, v_src.workspace_id,
          left(v_src.name || ' (copy)', 100), v_uid)
  returning * into v_new;

  insert into public.dashboard_widgets
    (org_id, dashboard_id, source_board_id, kind, title, config, layout, position)
  select v_src.org_id, v_new.id, source_board_id, kind, title, config, layout, position
  from public.dashboard_widgets where dashboard_id = p_dashboard_id;

  return v_new;
end;
$$;

grant execute on function public.duplicate_dashboard(uuid) to authenticated;
```

- [ ] **Step 2: Apply the migration to the linked DB and regenerate types**

```bash
supabase db push
pnpm db:types
```

Expected: `db push` applies `20260622140000_duplicate_board_and_dashboard.sql`;
`database.types.ts` now lists `duplicate_board_structure` and `duplicate_dashboard`
under `Database["public"]["Functions"]`.

> If `supabase db push` is unavailable in the environment, apply the same SQL via
> the Supabase MCP `apply_migration` tool (name: `duplicate_board_and_dashboard`),
> then run `pnpm db:types`.

- [ ] **Step 3: Write the board RPC integration/RLS test (failing first if run before Step 2)**

Create `src/lib/boards/duplicate-board.rls.integration.test.ts`. Mirror the setup
in `src/lib/boards/automations.rls.integration.test.ts` (dotenv, anon client via
`signInWithRetry`, `describe.skipIf(!SERVICE_ROLE_KEY)`, service-role `admin`
client for teardown). Two orgs: user A in org A owns a board with 1 group, 1
column, 1 view, and 1 item with a cell value; user B is NOT a member of org A.

```ts
it("duplicates groups, columns and views but NOT items/cell_values", async () => {
  const { data: dup, error } = await userAAnon.rpc(
    "duplicate_board_structure",
    {
      p_board_id: boardAId,
    },
  );
  expect(error).toBeNull();
  expect(dup).toBeTruthy();
  expect(dup!.id).not.toBe(boardAId);
  expect(dup!.name).toBe("Source Board (copy)");

  const [groups, columns, views, items] = await Promise.all([
    admin.from("groups").select("id").eq("board_id", dup!.id),
    admin.from("columns").select("id").eq("board_id", dup!.id),
    admin.from("board_views").select("id").eq("board_id", dup!.id),
    admin.from("items").select("id").eq("board_id", dup!.id),
  ]);
  expect(groups.data!.length).toBe(1);
  expect(columns.data!.length).toBe(1);
  expect(views.data!.length).toBe(1);
  expect(items.data!.length).toBe(0); // structure-only: no items copied
});

it("denies duplication to a non-member (cross-tenant)", async () => {
  const { error } = await userBAnon.rpc("duplicate_board_structure", {
    p_board_id: boardAId,
  });
  // RLS hides the source row from B -> the function raises 'board not found'.
  expect(error).not.toBeNull();
});
```

- [ ] **Step 4: Write the dashboard RPC integration/RLS test**

Create `src/lib/dashboards/duplicate-dashboard.rls.integration.test.ts`, same
harness. User A owns a dashboard with 1 widget; user B is not a member.

```ts
it("duplicates the dashboard and its widgets", async () => {
  const { data: dup, error } = await userAAnon.rpc("duplicate_dashboard", {
    p_dashboard_id: dashboardAId,
  });
  expect(error).toBeNull();
  expect(dup!.name).toBe("Source Dashboard (copy)");

  const widgets = await admin
    .from("dashboard_widgets")
    .select("id")
    .eq("dashboard_id", dup!.id);
  expect(widgets.data!.length).toBe(1);
});

it("denies duplication to a non-member", async () => {
  const { error } = await userBAnon.rpc("duplicate_dashboard", {
    p_dashboard_id: dashboardAId,
  });
  expect(error).not.toBeNull();
});
```

- [ ] **Step 5: Run the integration tests**

Run: `pnpm test -- duplicate-board duplicate-dashboard`
Expected: PASS (skipped only if `SUPABASE_SERVICE_ROLE_KEY` is absent locally — in
that case they run in CI).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260622140000_duplicate_board_and_dashboard.sql \
        src/types/database.types.ts \
        src/lib/boards/duplicate-board.rls.integration.test.ts \
        src/lib/dashboards/duplicate-dashboard.rls.integration.test.ts
git commit -m "feat(db): structure-only duplicate RPCs for boards and dashboards"
```

---

## Task 2: Validation schemas + server actions

**Files:**

- Modify: `src/lib/validations/board-actions.ts`
- Modify: `src/lib/validations/dashboards.ts`
- Modify: `src/lib/boards/actions.ts`
- Modify: `src/lib/dashboards/actions.ts`

Depends on Task 1 (regenerated types expose the RPC names).

- [ ] **Step 1: Add the board validation schema**

In `src/lib/validations/board-actions.ts`, next to `deleteBoardSchema` (the `uuid`
helper is already defined at the top of the file):

```ts
export const duplicateBoardSchema = z.object({ boardId: uuid });
```

- [ ] **Step 2: Add the dashboard validation schemas**

In `src/lib/validations/dashboards.ts`, alongside `renameDashboardSchema`. Use the
same uuid form already used there (match the existing `dashboardId` field name):

```ts
export const deleteDashboardSchema = z.object({
  dashboardId: z.string().uuid(),
});
export const duplicateDashboardSchema = z.object({
  dashboardId: z.string().uuid(),
});
```

> If `validations/dashboards.ts` already defines a shared `uuid` helper, use it
> instead of `z.string().uuid()` to stay DRY.

- [ ] **Step 3: Add the `duplicateBoard` action**

In `src/lib/boards/actions.ts`: add `duplicateBoardSchema` to the existing import
block from `@/lib/validations/board-actions`, then add after `deleteBoard`:

```ts
export async function duplicateBoard(input: {
  boardId: string;
}): Promise<ActionResult<{ boardId: string }>> {
  const parsed = duplicateBoardSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("duplicate_board_structure", {
    p_board_id: parsed.data.boardId,
  });
  if (error || !data)
    return fail(error?.message ?? "Could not duplicate board.");

  revalidatePath("/", "layout");
  return { ok: true, data: { boardId: data.id } };
}
```

- [ ] **Step 4: Add the `deleteDashboard` and `duplicateDashboard` actions**

In `src/lib/dashboards/actions.ts`: add `deleteDashboardSchema` and
`duplicateDashboardSchema` to the existing import from
`@/lib/validations/dashboards`, then add (after `renameDashboard`):

```ts
/** Delete a dashboard. Widgets cascade via the dashboard_id FK. */
export async function deleteDashboard(input: {
  dashboardId: string;
}): Promise<ActionResult<undefined>> {
  const parsed = deleteDashboardSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const { error } = await supabase
    .from("dashboards")
    .delete()
    .eq("id", parsed.data.dashboardId);
  if (error) return fail(error.message);

  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

/** Duplicate a dashboard's structure (its widgets) via RPC. */
export async function duplicateDashboard(input: {
  dashboardId: string;
}): Promise<ActionResult<{ dashboardId: string }>> {
  const parsed = duplicateDashboardSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("duplicate_dashboard", {
    p_dashboard_id: parsed.data.dashboardId,
  });
  if (error || !data)
    return fail(error?.message ?? "Could not duplicate dashboard.");

  revalidatePath("/", "layout");
  return { ok: true, data: { dashboardId: data.id } };
}
```

> Note: `src/lib/dashboards/actions.ts` defines its own `ActionResult<T>` and
> `fail` at the top of the file — reuse those, do not import from boards.

- [ ] **Step 5: Verify it compiles**

Run: `pnpm typecheck`
Expected: PASS (no errors). The `.rpc()` calls type-check against the regenerated
`database.types.ts` from Task 1.

- [ ] **Step 6: Commit**

```bash
git add src/lib/validations/board-actions.ts src/lib/validations/dashboards.ts \
        src/lib/boards/actions.ts src/lib/dashboards/actions.ts
git commit -m "feat(boards,dashboards): duplicate + deleteDashboard server actions"
```

---

## Task 3: Sidebar typography + separators (parallel with Tasks 1–2)

**Files:**

- Modify: `src/components/sidebar.tsx`
- Modify: `src/components/boards/BoardsNav.tsx`
- Modify: `src/components/dashboards/DashboardsNav.tsx`

> Load the `pulse-ui` + `frontend-design` skills first.

Goal: one hierarchy — **section labels** = `text-xs font-medium text-muted-foreground`;
**item rows** = `text-sm`; `Separator`s between major blocks. This task changes
ONLY headers/labels/separators, not the row interior (the menu integration in
Tasks 4–5 owns the row markup), to keep the merge clean.

- [ ] **Step 1: Normalize the "Boards" section header**

In `src/components/boards/BoardsNav.tsx`, the expanded header (currently
`text-sm`):

```tsx
<span className="text-muted-foreground flex items-center gap-2 text-xs font-medium">
  <FolderKanban className="size-4" />
  Boards
</span>
```

- [ ] **Step 2: Normalize the "Dashboards" section header**

In `src/components/dashboards/DashboardsNav.tsx`, the expanded header `Link`
(currently `text-sm`) → `text-xs font-medium`:

```tsx
<Link
  href="/dashboards"
  className="text-muted-foreground hover:text-foreground flex items-center gap-2 text-xs font-medium transition-colors"
>
  <LayoutGrid className="size-4" />
  Dashboards
</Link>
```

- [ ] **Step 3: Add Separators between major blocks**

In `src/components/sidebar.tsx`, import the primitive:

```tsx
import { Separator } from "@/components/ui/separator";
```

Insert `<Separator className="mx-3 my-1 w-auto" />` between these siblings inside
`<aside>` (only when `!isCollapsed`; render `null` when collapsed to avoid clutter):
after `<BoardsNav … />`, after `<DashboardsNav … />`, and after the primary `<nav>`
block. Use a small helper inline:

```tsx
{
  !isCollapsed ? <Separator className="mx-3 my-1 w-auto" /> : null;
}
```

- [ ] **Step 4: Update the existing BoardsNav test expectation if it asserts header size**

`src/components/boards/BoardsNav.test.tsx` asserts header _text_ ("Boards",
"My boards"), not classes, so no change is expected. Run the suite to confirm:

Run: `pnpm test -- BoardsNav sidebar`
Expected: PASS. If any assertion checked `text-sm` on a header, update it to
`text-xs`.

- [ ] **Step 5: Visually verify (dev server)**

Run: `pnpm dev` and open the app; confirm section headers are visually smaller than
rows and separators divide Boards / Dashboards / nav / Workspaces / Platform. (Or
note "verified by reading the diff" if a dev server isn't available in-session.)

- [ ] **Step 6: Commit**

```bash
git add src/components/sidebar.tsx src/components/boards/BoardsNav.tsx \
        src/components/dashboards/DashboardsNav.tsx
git commit -m "style(sidebar): unify section-label typography + add separators"
```

---

## Task 4: BoardItemMenu component + BoardsNav integration

**Files:**

- Create: `src/components/boards/BoardItemMenu.tsx`
- Create: `src/components/boards/BoardItemMenu.test.tsx`
- Modify: `src/components/boards/BoardsNav.tsx`

Depends on Task 2 (actions) and Task 3 (BoardsNav header changes already landed).

> Load `pulse-ui` + `frontend-design` first.

- [ ] **Step 1: Write the failing component test**

Create `src/components/boards/BoardItemMenu.test.tsx`. Mock the actions module and
`next/navigation` (Radix dropdowns work with `userEvent` here — see
`AddColumnMenu.test.tsx`).

```tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BoardItemMenu } from "./BoardItemMenu";

const duplicateBoard = vi.fn(async () => ({
  ok: true,
  data: { boardId: "x" },
}));
const renameBoard = vi.fn(async () => ({ ok: true, data: undefined }));
const deleteBoard = vi.fn(async () => ({ ok: true, data: undefined }));

vi.mock("@/lib/boards/actions", () => ({
  duplicateBoard: (...a: unknown[]) => duplicateBoard(...a),
  renameBoard: (...a: unknown[]) => renameBoard(...a),
  deleteBoard: (...a: unknown[]) => deleteBoard(...a),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

beforeEach(() => vi.clearAllMocks());

function open() {
  return userEvent.click(
    screen.getByRole("button", { name: /board actions/i }),
  );
}

describe("BoardItemMenu", () => {
  it("shows Rename, Duplicate and Delete", async () => {
    render(
      <BoardItemMenu board={{ id: "b1", name: "Roadmap" }} isActive={false} />,
    );
    await open();
    expect(
      screen.getByRole("menuitem", { name: "Rename" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Duplicate" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Delete" }),
    ).toBeInTheDocument();
  });

  it("calls duplicateBoard when Duplicate is chosen", async () => {
    render(
      <BoardItemMenu board={{ id: "b1", name: "Roadmap" }} isActive={false} />,
    );
    await open();
    await userEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }));
    expect(duplicateBoard).toHaveBeenCalledWith({ boardId: "b1" });
  });

  it("renames via the dialog", async () => {
    render(
      <BoardItemMenu board={{ id: "b1", name: "Roadmap" }} isActive={false} />,
    );
    await open();
    await userEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    const input = screen.getByRole("textbox", { name: /board name/i });
    await userEvent.clear(input);
    await userEvent.type(input, "Roadmap 2");
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(renameBoard).toHaveBeenCalledWith({
      boardId: "b1",
      name: "Roadmap 2",
    });
  });

  it("deletes after confirming", async () => {
    render(
      <BoardItemMenu board={{ id: "b1", name: "Roadmap" }} isActive={false} />,
    );
    await open();
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    await userEvent.click(
      screen.getByRole("button", { name: /delete board/i }),
    );
    expect(deleteBoard).toHaveBeenCalledWith({ boardId: "b1" });
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm test -- BoardItemMenu`
Expected: FAIL ("Cannot find module './BoardItemMenu'").

- [ ] **Step 3: Implement `BoardItemMenu.tsx`**

Create `src/components/boards/BoardItemMenu.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";

import { deleteBoard, duplicateBoard, renameBoard } from "@/lib/boards/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function BoardItemMenu({
  board,
  isActive,
}: {
  board: { id: string; name: string };
  isActive: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [name, setName] = useState(board.name);
  const [error, setError] = useState<string | null>(null);

  function submitRename() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === board.name) {
      setRenameOpen(false);
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await renameBoard({ boardId: board.id, name: trimmed });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setRenameOpen(false);
      router.refresh();
    });
  }

  function doDuplicate() {
    startTransition(async () => {
      const res = await duplicateBoard({ boardId: board.id });
      if (res.ok) router.refresh();
    });
  }

  function doDelete() {
    startTransition(async () => {
      const res = await deleteBoard({ boardId: board.id });
      if (!res.ok) return;
      setDeleteOpen(false);
      if (isActive) router.push("/boards");
      else router.refresh();
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Board actions"
            className="text-muted-foreground hover:text-foreground size-6 shrink-0 opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem
            onSelect={() => {
              setName(board.name);
              setError(null);
              setRenameOpen(true);
            }}
          >
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={doDuplicate}>Duplicate</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => setDeleteOpen(true)}
          >
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename board</DialogTitle>
          </DialogHeader>
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              submitRename();
            }}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`rename-board-${board.id}`}>Board name</Label>
              <Input
                id={`rename-board-${board.id}`}
                aria-label="Board name"
                autoFocus
                value={name}
                disabled={isPending}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            {error ? (
              <p role="alert" className="text-destructive text-xs">
                {error}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="submit" disabled={isPending || !name.trim()}>
                {isPending ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{board.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the board and all its items. This cannot
              be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                doDelete();
              }}
              disabled={isPending}
              className="bg-destructive hover:bg-destructive/90 text-white"
            >
              Delete board
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
```

> Verify the actual prop/variant names against the local primitives before
> finalizing (`ui/dropdown-menu` exports `DropdownMenuItem` with a `variant`
> prop per the Task-0 exploration; `ui/alert-dialog` exports the parts used).
> Adjust destructive styling to match `pulse-ui` tokens.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- BoardItemMenu`
Expected: PASS (all four tests).

- [ ] **Step 5: Integrate into BoardsNav (owned boards, expanded only)**

In `src/components/boards/BoardsNav.tsx`, import the menu:

```tsx
import { BoardItemMenu } from "@/components/boards/BoardItemMenu";
```

Replace the expanded-mode owned-board `<Link>` (the `boards.map` non-collapsed
branch) with a row wrapper that reveals the menu on hover/focus. The active/hover
background moves to the wrapper:

```tsx
<div
  key={b.id}
  className={cn(
    "group/row flex items-center rounded-md pr-1 transition-colors",
    b.id === activeBoardId
      ? "bg-surface text-foreground"
      : "text-muted-foreground hover:bg-accent hover:text-foreground",
  )}
>
  <Link
    href={`/boards/${b.id}`}
    aria-current={b.id === activeBoardId ? "page" : undefined}
    className="flex min-w-0 flex-1 items-center gap-1.5 px-3 py-1 text-sm"
  >
    <span className="truncate">{b.name}</span>
    {b.shared_out ? (
      <Users2
        aria-label="Shared with others"
        className="text-muted-foreground size-3.5 shrink-0"
      />
    ) : null}
  </Link>
  <BoardItemMenu
    board={{ id: b.id, name: b.name }}
    isActive={b.id === activeBoardId}
  />
</div>
```

Leave the collapsed branch and the "Shared with me" rows unchanged (no menu).

- [ ] **Step 6: Run the BoardsNav suite**

Run: `pnpm test -- BoardsNav`
Expected: PASS. The existing tests query by link role/name, which still resolve;
if a test that asserted the active class on the `<Link>` now needs the wrapper,
update it to assert `aria-current` on the link (already the case) — no class
assertions should break.

- [ ] **Step 7: Commit**

```bash
git add src/components/boards/BoardItemMenu.tsx \
        src/components/boards/BoardItemMenu.test.tsx \
        src/components/boards/BoardsNav.tsx
git commit -m "feat(sidebar): board overflow menu (rename/duplicate/delete)"
```

---

## Task 5: DashboardItemMenu component + DashboardsNav integration

**Files:**

- Create: `src/components/dashboards/DashboardItemMenu.tsx`
- Create: `src/components/dashboards/DashboardItemMenu.test.tsx`
- Modify: `src/components/dashboards/DashboardsNav.tsx`

Depends on Task 2 + Task 3. Runs in parallel with Task 4 (different files).

> Load `pulse-ui` + `frontend-design` first.

- [ ] **Step 1: Write the failing component test**

Create `src/components/dashboards/DashboardItemMenu.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DashboardItemMenu } from "./DashboardItemMenu";

const duplicateDashboard = vi.fn(async () => ({
  ok: true,
  data: { dashboardId: "x" },
}));
const renameDashboard = vi.fn(async () => ({
  ok: true,
  data: { dashboard: {} },
}));
const deleteDashboard = vi.fn(async () => ({ ok: true, data: undefined }));

vi.mock("@/lib/dashboards/actions", () => ({
  duplicateDashboard: (...a: unknown[]) => duplicateDashboard(...a),
  renameDashboard: (...a: unknown[]) => renameDashboard(...a),
  deleteDashboard: (...a: unknown[]) => deleteDashboard(...a),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

beforeEach(() => vi.clearAllMocks());
const open = () =>
  userEvent.click(screen.getByRole("button", { name: /dashboard actions/i }));

describe("DashboardItemMenu", () => {
  it("shows Rename, Duplicate and Delete", async () => {
    render(
      <DashboardItemMenu
        dashboard={{ id: "d1", name: "Ops" }}
        isActive={false}
      />,
    );
    await open();
    expect(
      screen.getByRole("menuitem", { name: "Rename" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Duplicate" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Delete" }),
    ).toBeInTheDocument();
  });

  it("calls duplicateDashboard when Duplicate is chosen", async () => {
    render(
      <DashboardItemMenu
        dashboard={{ id: "d1", name: "Ops" }}
        isActive={false}
      />,
    );
    await open();
    await userEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }));
    expect(duplicateDashboard).toHaveBeenCalledWith({ dashboardId: "d1" });
  });

  it("deletes after confirming", async () => {
    render(
      <DashboardItemMenu
        dashboard={{ id: "d1", name: "Ops" }}
        isActive={false}
      />,
    );
    await open();
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    await userEvent.click(
      screen.getByRole("button", { name: /delete dashboard/i }),
    );
    expect(deleteDashboard).toHaveBeenCalledWith({ dashboardId: "d1" });
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm test -- DashboardItemMenu`
Expected: FAIL ("Cannot find module './DashboardItemMenu'").

- [ ] **Step 3: Implement `DashboardItemMenu.tsx`**

Create `src/components/dashboards/DashboardItemMenu.tsx` — identical structure to
`BoardItemMenu` (Task 4 Step 3) with these substitutions (repeated in full so this
task is self-contained; do not "see Task 4"):

- Props: `dashboard: { id: string; name: string }`, `isActive: boolean`.
- Import from `@/lib/dashboards/actions`:
  `deleteDashboard, duplicateDashboard, renameDashboard`.
- Trigger `aria-label="Dashboard actions"`.
- Rename calls `renameDashboard({ dashboardId: dashboard.id, name: trimmed })`
  (note: `renameDashboard` returns `{ ok, data: { dashboard } }` — only branch on
  `res.ok`).
- Duplicate calls `duplicateDashboard({ dashboardId: dashboard.id })`.
- Delete calls `deleteDashboard({ dashboardId: dashboard.id })`; on `isActive`,
  `router.push("/dashboards")`, else `router.refresh()`.
- AlertDialog title `Delete “{dashboard.name}”?`, confirm button label
  `Delete dashboard`, description "This permanently deletes the dashboard and all
  its widgets. This cannot be undone."
- Rename dialog title `Rename dashboard`, input `aria-label="Dashboard name"`,
  id `rename-dashboard-${dashboard.id}`.

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";

import {
  deleteDashboard,
  duplicateDashboard,
  renameDashboard,
} from "@/lib/dashboards/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function DashboardItemMenu({
  dashboard,
  isActive,
}: {
  dashboard: { id: string; name: string };
  isActive: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [name, setName] = useState(dashboard.name);
  const [error, setError] = useState<string | null>(null);

  function submitRename() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === dashboard.name) {
      setRenameOpen(false);
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await renameDashboard({
        dashboardId: dashboard.id,
        name: trimmed,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setRenameOpen(false);
      router.refresh();
    });
  }

  function doDuplicate() {
    startTransition(async () => {
      const res = await duplicateDashboard({ dashboardId: dashboard.id });
      if (res.ok) router.refresh();
    });
  }

  function doDelete() {
    startTransition(async () => {
      const res = await deleteDashboard({ dashboardId: dashboard.id });
      if (!res.ok) return;
      setDeleteOpen(false);
      if (isActive) router.push("/dashboards");
      else router.refresh();
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Dashboard actions"
            className="text-muted-foreground hover:text-foreground size-6 shrink-0 opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem
            onSelect={() => {
              setName(dashboard.name);
              setError(null);
              setRenameOpen(true);
            }}
          >
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={doDuplicate}>Duplicate</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => setDeleteOpen(true)}
          >
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename dashboard</DialogTitle>
          </DialogHeader>
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              submitRename();
            }}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`rename-dashboard-${dashboard.id}`}>
                Dashboard name
              </Label>
              <Input
                id={`rename-dashboard-${dashboard.id}`}
                aria-label="Dashboard name"
                autoFocus
                value={name}
                disabled={isPending}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            {error ? (
              <p role="alert" className="text-destructive text-xs">
                {error}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="submit" disabled={isPending || !name.trim()}>
                {isPending ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{dashboard.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the dashboard and all its widgets. This
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                doDelete();
              }}
              disabled={isPending}
              className="bg-destructive hover:bg-destructive/90 text-white"
            >
              Delete dashboard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- DashboardItemMenu`
Expected: PASS.

- [ ] **Step 5: Integrate into DashboardsNav (expanded only)**

In `src/components/dashboards/DashboardsNav.tsx`, import the menu:

```tsx
import { DashboardItemMenu } from "@/components/dashboards/DashboardItemMenu";
```

Replace the expanded-mode dashboard `<Link>` (the `dashboards.map` non-collapsed
branch) with a hover-reveal row wrapper:

```tsx
<div
  key={d.id}
  className={cn(
    "group/row flex items-center rounded-md pr-1 transition-colors",
    d.id === activeDashboardId
      ? "bg-surface text-foreground"
      : "text-muted-foreground hover:bg-accent hover:text-foreground",
  )}
>
  <Link
    href={`/dashboards/${d.id}`}
    aria-current={d.id === activeDashboardId ? "page" : undefined}
    className="min-w-0 flex-1 truncate px-3 py-1 text-sm"
  >
    {d.name}
  </Link>
  <DashboardItemMenu
    dashboard={{ id: d.id, name: d.name }}
    isActive={d.id === activeDashboardId}
  />
</div>
```

Leave the collapsed branch unchanged (no menu).

- [ ] **Step 6: Run the dashboards suite**

Run: `pnpm test -- DashboardsNav DashboardItemMenu`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/dashboards/DashboardItemMenu.tsx \
        src/components/dashboards/DashboardItemMenu.test.tsx \
        src/components/dashboards/DashboardsNav.tsx
git commit -m "feat(sidebar): dashboard overflow menu (rename/duplicate/delete)"
```

---

## Task 6: Full verification + closure

**Files:** none (verification only).

- [ ] **Step 1: Run all four gates**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: all PASS. (Integration tests for the RPCs run if `SUPABASE_SERVICE_ROLE_KEY`
is present; otherwise they skip locally and run in CI.)

- [ ] **Step 2: Manual smoke (dev server)**

Run `pnpm dev`, then verify the "How to test" walkthrough below end-to-end.

- [ ] **Step 3: Finish the task (auto-integrates + merges to develop)**

```bash
scripts/finish-task.sh
```

Expected: rebases onto latest `develop`, re-runs gates against merged state, merges
`task/sidebar-item-menu` into `develop`, pushes, removes the worktree and branch.
If it stops on a rebase conflict, resolve `git rebase develop` and re-run.

- [ ] **Step 4: Deliver the "How to test" walkthrough** (in the closing message and the `/wrapup` note).

---

## How to test (manual acceptance)

After `develop` is updated (pull `develop`, `pnpm install`, `pnpm dev`):

1. Open the app with the sidebar expanded. Confirm section headers ("Boards",
   "Dashboards", "Workspaces") read as smaller, muted labels — visually distinct
   from the clickable rows — with thin separators between Boards / Dashboards /
   the Goals-Portfolios-Inbox nav / Workspaces / Platform.
2. Hover a board under **My boards** → a 3-dots button appears at the right edge.
   Tab to the row with the keyboard → the button is reachable (focus-visible).
3. Click the 3-dots → **Rename**. Change the name, Save → the sidebar row updates.
4. 3-dots → **Duplicate** → a new “<name> (copy)” row appears with the same
   columns/groups/views but **no items** (open it to confirm it's empty of rows).
5. 3-dots → **Delete** → confirm in the dialog. The board disappears. If you
   deleted the board you were viewing, you're routed to `/boards`.
6. Confirm a board under **Shared with me** has **no** 3-dots menu.
7. Repeat steps 2–5 on a **dashboard** (Duplicate copies its widgets; Delete is
   confirmed; deleting the active dashboard routes to `/dashboards`).
8. Collapse the sidebar (⌘\) → boards/dashboards show as initials with **no**
   menu (unchanged behavior).

```

```
