# Phase 4a — Item Panel + Updates + Activity Log Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a board item a right-side detail drawer (opened via `?item=<id>`) with three tabs — Fields, Updates (human comments), and a trigger-driven Activity Log.

**Architecture:** New `item_updates` + `item_activities` tables (org-scoped, RLS default-deny, on the Realtime publication). `item_activities` is **append-only and written only by Postgres triggers** (SECURITY DEFINER) on `items` / `cell_values` / `item_updates`, storing raw `old_value`/`new_value` jsonb; presentation is resolved at **render time** from the columns/members already in the board cache. The panel mounts in the existing client shell `BoardViews`, opens via the History API (0 RSC refetch), reads the item's fields from the existing `["board", boardId]` cache, and fetches Updates + Activity on open via item-keyed React-Query caches with a per-item Realtime subscription. Updates mutate optimistically through Server Actions, mirroring `useBoardMutations`.

**Tech Stack:** Next.js 16 (App Router, RSC + Server Actions), Supabase (Postgres, RLS, Realtime), `@supabase/ssr`, TanStack Query, Zod, shadcn/Radix (Dialog → Sheet), Vitest + RTL, Playwright. Verify with `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

**Plan-time decisions (flagged for the spec author):**

- **Updates are plaintext in 4a.** `body` is stored as jsonb `{ "text": string }` (future-proofs for marks) and `body_text` mirrors the text. Inline rich-text marks (bold/italic/align) are deferred to a 4a fast-follow so the composer stays buildable/testable. (Spec §1 implied basic marks; this narrows it.)
- **`item_moved` logs only on group change**, not position-only reorders (drag-reorder would otherwise spam the log).
- **@mention parsing is NOT in 4a** (it belongs to 4b); `addUpdate` writes the update only.
- **No `revalidatePath` in the update actions** — the panel reads client-state caches (React Query) fed by optimistic writes + Realtime, per spec §6.

---

## File structure

| File                                                          | Responsibility                                                            |
| ------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `supabase/migrations/<ts>_collaboration_updates_activity.sql` | Tables, enum, 3 trigger fns + triggers, RLS, grants, publication          |
| `src/types/database.types.ts`                                 | Regenerated (do not hand-edit)                                            |
| `src/lib/validations/collaboration-actions.ts`                | Zod schemas: add/edit/delete update                                       |
| `src/lib/collaboration/actions.ts`                            | Server Actions: `addUpdate` / `editUpdate` / `deleteUpdate`               |
| `src/lib/collaboration/activity.ts`                           | Pure render-resolution: activity row + columns/members → descriptor       |
| `src/lib/collaboration/cache.ts`                              | Pure immutable patch helpers for the item-update/activity caches          |
| `src/lib/collaboration/use-item-collab.ts`                    | Client hook: fetch updates+activity (keyed by itemId) + per-item Realtime |
| `src/lib/collaboration/use-update-mutations.ts`               | Optimistic add/edit/delete update mutations                               |
| `src/components/ui/sheet.tsx`                                 | shadcn Sheet primitive (Radix Dialog, right side)                         |
| `src/components/boards/item-panel/ItemPanel.tsx`              | Drawer shell + tab state + `?item=` open/close                            |
| `src/components/boards/item-panel/UpdatesTab.tsx`             | Composer + updates list                                                   |
| `src/components/boards/item-panel/ActivityTab.tsx`            | Activity list using `activity.ts` + `ActivityRow`                         |
| `src/components/boards/item-panel/ActivityRow.tsx`            | One resolved activity line (from→to)                                      |
| `src/components/boards/BoardViews.tsx`                        | Mount `<ItemPanel>`; read `?item=`                                        |
| `src/components/boards/BoardTable.tsx`                        | Row "open" affordance → `pushState(?item=)`                               |
| `src/lib/collaboration/*.test.ts(x)`                          | Unit tests per module                                                     |
| `src/lib/collaboration/collaboration.rls.integration.test.ts` | RLS + trigger behavior (live DB)                                          |
| `e2e/item-panel.spec.ts`                                      | Add update → appears + logs activity                                      |

Each task is independently committable.

---

## Task 1: Add the shadcn Sheet primitive

**Files:**

- Create: `src/components/ui/sheet.tsx`

The repo has `dialog.tsx` (Radix Dialog) but no side drawer. A Sheet is a Radix Dialog with side-anchored content. Mirror the existing `dialog.tsx` imports/utilities (`@/lib/utils` `cn`).

- [ ] **Step 1: Create the Sheet primitive**

```tsx
"use client";

import * as React from "react";
import * as SheetPrimitive from "@radix-ui/react-dialog";
import { XIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const Sheet = SheetPrimitive.Root;
const SheetTrigger = SheetPrimitive.Trigger;
const SheetClose = SheetPrimitive.Close;
const SheetPortal = SheetPrimitive.Portal;

function SheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
  return (
    <SheetPrimitive.Overlay
      className={cn(
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50",
        className,
      )}
      {...props}
    />
  );
}

function SheetContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content>) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        className={cn(
          "bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right fixed inset-y-0 right-0 z-50 flex h-full w-full max-w-xl flex-col gap-4 border-l p-6 shadow-lg transition ease-in-out data-[state=closed]:duration-300 data-[state=open]:duration-300",
          className,
        )}
        {...props}
      >
        {children}
        <SheetPrimitive.Close className="absolute top-4 right-4 rounded-sm opacity-70 transition-opacity hover:opacity-100 focus:outline-none">
          <XIcon className="size-4" />
          <span className="sr-only">Close</span>
        </SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </SheetPortal>
  );
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-1.5", className)} {...props} />;
}

function SheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      className={cn("text-foreground text-lg font-semibold", className)}
      {...props}
    />
  );
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  );
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
};
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (no errors). If `@radix-ui/react-dialog` is missing, it is already a dependency of the existing `dialog.tsx`; confirm with `grep -r "@radix-ui/react-dialog" package.json` (expected: present).

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/sheet.tsx
git commit -m "feat(ui): add sheet primitive (radix dialog, right side)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Migration — updates + activity tables, triggers, RLS

**Files:**

- Create: `supabase/migrations/<ts>_collaboration_updates_activity.sql` (use a timestamp later than `20260616192633`, e.g. `20260617090000`)

- [ ] **Step 1: Write the migration**

```sql
-- Phase 4a (Collaboration): item_updates (human comments) + item_activities
-- (append-only audit log written ONLY by triggers). Mirrors Phase-2 RLS:
-- denormalized org_id, is_org_member() reads, *_in_org() write guards, and
-- SECURITY DEFINER trigger fns with set search_path = ''.

-- ── Updates ──────────────────────────────────────────────────────────────
create table public.item_updates (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations (id) on delete cascade,
  board_id   uuid not null references public.boards (id) on delete cascade,
  item_id    uuid not null references public.items (id) on delete cascade,
  author_id  uuid not null references auth.users (id),
  body       jsonb not null,            -- { "text": string } in 4a (marks later)
  body_text  text not null default '',  -- denormalized plaintext (search / 4b mentions)
  edited_at  timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index item_updates_item_id_idx  on public.item_updates (item_id, created_at desc);
create index item_updates_board_id_idx on public.item_updates (board_id);
create index item_updates_org_id_idx   on public.item_updates (org_id);

create trigger item_updates_set_updated_at
  before update on public.item_updates
  for each row execute function public.set_updated_at();

-- ── Activity log (append-only; never capped; only triggers insert) ─────────
create type public.activity_action as enum (
  'item_created', 'item_renamed', 'item_moved', 'item_deleted',
  'cell_changed', 'update_added'
);
create table public.item_activities (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations (id) on delete cascade,
  board_id   uuid not null references public.boards (id) on delete cascade,
  item_id    uuid not null references public.items (id) on delete cascade,
  actor_id   uuid references auth.users (id),                     -- null = system
  action     public.activity_action not null,
  column_id  uuid references public.columns (id) on delete set null,
  old_value  jsonb,
  new_value  jsonb,
  created_at timestamptz not null default now()
);
create index item_activities_item_id_idx  on public.item_activities (item_id, created_at desc);
create index item_activities_board_id_idx on public.item_activities (board_id, created_at desc);
create index item_activities_org_id_idx   on public.item_activities (org_id);

-- ── Trigger fns (SECURITY DEFINER → bypass RLS to write the log) ───────────
create or replace function public.tg_log_item_activity()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (tg_op = 'INSERT') then
    insert into public.item_activities (org_id, board_id, item_id, actor_id, action, new_value)
    values (new.org_id, new.board_id, new.id, (select auth.uid()), 'item_created',
            jsonb_build_object('name', new.name));
    return new;
  elsif (tg_op = 'UPDATE') then
    if (new.name is distinct from old.name) then
      insert into public.item_activities (org_id, board_id, item_id, actor_id, action, old_value, new_value)
      values (new.org_id, new.board_id, new.id, (select auth.uid()), 'item_renamed',
              to_jsonb(old.name), to_jsonb(new.name));
    end if;
    if (new.group_id is distinct from old.group_id) then
      insert into public.item_activities (org_id, board_id, item_id, actor_id, action, old_value, new_value)
      values (new.org_id, new.board_id, new.id, (select auth.uid()), 'item_moved',
              to_jsonb(old.group_id), to_jsonb(new.group_id));
    end if;
    return new;
  elsif (tg_op = 'DELETE') then
    insert into public.item_activities (org_id, board_id, item_id, actor_id, action, old_value)
    values (old.org_id, old.board_id, old.id, (select auth.uid()), 'item_deleted',
            jsonb_build_object('name', old.name));
    return old;
  end if;
  return null;
end; $$;

create or replace function public.tg_log_cell_activity()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (tg_op = 'INSERT') then
    insert into public.item_activities (org_id, board_id, item_id, actor_id, action, column_id, new_value)
    values (new.org_id, new.board_id, new.item_id, (select auth.uid()), 'cell_changed', new.column_id, new.value);
    return new;
  elsif (tg_op = 'UPDATE') then
    if (new.value is distinct from old.value) then
      insert into public.item_activities (org_id, board_id, item_id, actor_id, action, column_id, old_value, new_value)
      values (new.org_id, new.board_id, new.item_id, (select auth.uid()), 'cell_changed', new.column_id, old.value, new.value);
    end if;
    return new;
  elsif (tg_op = 'DELETE') then
    insert into public.item_activities (org_id, board_id, item_id, actor_id, action, column_id, old_value)
    values (old.org_id, old.board_id, old.item_id, (select auth.uid()), 'cell_changed', old.column_id, old.value);
    return old;
  end if;
  return null;
end; $$;

create or replace function public.tg_log_update_activity()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.item_activities (org_id, board_id, item_id, actor_id, action, new_value)
  values (new.org_id, new.board_id, new.item_id, new.author_id, 'update_added',
          jsonb_build_object('update_id', new.id));
  return new;
end; $$;

create trigger items_log_activity
  after insert or update or delete on public.items
  for each row execute function public.tg_log_item_activity();
create trigger cell_values_log_activity
  after insert or update or delete on public.cell_values
  for each row execute function public.tg_log_cell_activity();
create trigger item_updates_log_activity
  after insert on public.item_updates
  for each row execute function public.tg_log_update_activity();

-- ── RLS ────────────────────────────────────────────────────────────────────
alter table public.item_updates    enable row level security;
alter table public.item_activities enable row level security;

-- item_updates: read if member; author writes own; author-or-admin edit/delete.
create policy "item_updates: read if member" on public.item_updates
  for select to authenticated using (public.is_org_member(org_id));
create policy "item_updates: insert if member+author" on public.item_updates
  for insert to authenticated with check (
    public.is_org_member(org_id)
    and public.board_in_org(board_id, org_id)
    and public.item_in_org(item_id, org_id)
    and author_id = (select auth.uid())
  );
create policy "item_updates: update if author/admin" on public.item_updates
  for update to authenticated using (
    public.is_org_member(org_id)
    and (author_id = (select auth.uid())
         or public.has_org_role(org_id, array['owner','admin']::public.org_role[]))
  ) with check (public.is_org_member(org_id));
create policy "item_updates: delete if author/admin" on public.item_updates
  for delete to authenticated using (
    public.is_org_member(org_id)
    and (author_id = (select auth.uid())
         or public.has_org_role(org_id, array['owner','admin']::public.org_role[]))
  );

-- item_activities: read-only to members. NO insert/update/delete policy →
-- clients can never write; only the SECURITY DEFINER triggers above can.
create policy "item_activities: read if member" on public.item_activities
  for select to authenticated using (public.is_org_member(org_id));

-- ── Grants — RLS is the boundary. Activities: select only. ──────────────────
grant select, insert, update, delete on public.item_updates to authenticated;
grant select on public.item_activities to authenticated;

-- ── Realtime ────────────────────────────────────────────────────────────────
alter publication supabase_realtime add table public.item_updates;
alter publication supabase_realtime add table public.item_activities;
```

- [ ] **Step 2: Apply the migration locally**

Run: `pnpm supabase db reset` (or the project's apply command, e.g. `pnpm supabase migration up`)
Expected: migration applies with no errors; `item_updates` and `item_activities` exist.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/
git commit -m "feat(db): item_updates + trigger-driven item_activities (rls, realtime)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Regenerate database types

**Files:**

- Modify: `src/types/database.types.ts` (generated — never hand-edit)

- [ ] **Step 1: Regenerate**

Run: `pnpm db:types`
Expected: file updates; `git diff src/types/database.types.ts` shows new `item_updates`, `item_activities`, and the `activity_action` enum in `Tables`/`Enums`.

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/types/database.types.ts
git commit -m "chore(db): regenerate types for collaboration tables

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Validation schemas

**Files:**

- Create: `src/lib/validations/collaboration-actions.ts`
- Test: `src/lib/validations/collaboration-actions.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import {
  addUpdateSchema,
  editUpdateSchema,
  deleteUpdateSchema,
} from "@/lib/validations/collaboration-actions";

const ITEM = "11111111-1111-4111-8111-111111111111";
const UPD = "22222222-2222-4222-8222-222222222222";

describe("collaboration validation", () => {
  it("accepts a valid add-update payload", () => {
    const r = addUpdateSchema.safeParse({ itemId: ITEM, text: "hello" });
    expect(r.success).toBe(true);
  });
  it("rejects empty text", () => {
    expect(addUpdateSchema.safeParse({ itemId: ITEM, text: "" }).success).toBe(
      false,
    );
  });
  it("rejects a non-uuid itemId", () => {
    expect(
      addUpdateSchema.safeParse({ itemId: "nope", text: "x" }).success,
    ).toBe(false);
  });
  it("validates edit + delete payloads", () => {
    expect(
      editUpdateSchema.safeParse({ updateId: UPD, text: "edited" }).success,
    ).toBe(true);
    expect(deleteUpdateSchema.safeParse({ updateId: UPD }).success).toBe(true);
    expect(deleteUpdateSchema.safeParse({ updateId: "bad" }).success).toBe(
      false,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/validations/collaboration-actions.test.ts`
Expected: FAIL ("Cannot find module .../collaboration-actions").

- [ ] **Step 3: Write the schemas**

```ts
import { z } from "zod";

const TEXT = z.string().trim().min(1, "Update cannot be empty").max(10_000);

export const addUpdateSchema = z.object({
  itemId: z.string().uuid(),
  text: TEXT,
});

export const editUpdateSchema = z.object({
  updateId: z.string().uuid(),
  text: TEXT,
});

export const deleteUpdateSchema = z.object({
  updateId: z.string().uuid(),
});

export type AddUpdateInput = z.infer<typeof addUpdateSchema>;
export type EditUpdateInput = z.infer<typeof editUpdateSchema>;
export type DeleteUpdateInput = z.infer<typeof deleteUpdateSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/validations/collaboration-actions.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/validations/collaboration-actions.ts src/lib/validations/collaboration-actions.test.ts
git commit -m "feat(collab): add update validation schemas

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Server Actions — add/edit/delete update

**Files:**

- Create: `src/lib/collaboration/actions.ts`
- Test: `src/lib/collaboration/actions.test.ts`

Mirrors `dependency-actions.ts`: `"use server"`, `createClient()` from `@/lib/supabase/server`, the shared `ActionResult` type, a local `fail()`. `author_id` comes from `supabase.auth.getUser()`. No `revalidatePath` (client-state reads).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const from = vi.fn();
const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from, auth: { getUser } }),
}));

import { addUpdate, deleteUpdate } from "@/lib/collaboration/actions";

const ITEM = "11111111-1111-4111-8111-111111111111";
const UPD = "22222222-2222-4222-8222-222222222222";
const USER = "99999999-9999-4999-8999-999999999999";

beforeEach(() => {
  from.mockReset();
  getUser.mockReset();
  getUser.mockResolvedValue({ data: { user: { id: USER } }, error: null });
});

describe("addUpdate", () => {
  it("rejects invalid input without touching the db", async () => {
    const res = await addUpdate({ itemId: "bad", text: "" });
    expect(res.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it("derives org/board from the item then inserts the update", async () => {
    const insert = vi.fn().mockReturnValue({
      select: () => ({
        single: async () => ({ data: { id: UPD }, error: null }),
      }),
    });
    from.mockImplementation((table: string) => {
      if (table === "items") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { org_id: "org", board_id: "board" },
                error: null,
              }),
            }),
          }),
        } as never;
      }
      if (table === "item_updates") return { insert } as never;
      return {} as never;
    });
    const res = await addUpdate({ itemId: ITEM, text: "hello" });
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        org_id: "org",
        board_id: "board",
        item_id: ITEM,
        author_id: USER,
        body: { text: "hello" },
        body_text: "hello",
      }),
    );
    expect(res).toEqual({ ok: true, data: { updateId: UPD } });
  });

  it("fails when the item is not visible", async () => {
    from.mockImplementation(() => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
      }),
    }));
    const res = await addUpdate({ itemId: ITEM, text: "hello" });
    expect(res).toEqual({ ok: false, error: "Item not found." });
  });
});

describe("deleteUpdate", () => {
  it("deletes by id and returns ok", async () => {
    const eq = vi.fn().mockResolvedValue({ error: null });
    from.mockImplementation(() => ({ delete: () => ({ eq }) }));
    const res = await deleteUpdate({ updateId: UPD });
    expect(eq).toHaveBeenCalledWith("id", UPD);
    expect(res).toEqual({ ok: true, data: undefined });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/collaboration/actions.test.ts`
Expected: FAIL ("Cannot find module .../collaboration/actions").

- [ ] **Step 3: Write the actions**

```ts
"use server";

import { createClient } from "@/lib/supabase/server";
import {
  addUpdateSchema,
  editUpdateSchema,
  deleteUpdateSchema,
} from "@/lib/validations/collaboration-actions";
import type { ActionResult } from "@/lib/boards/actions";
import type { Json } from "@/types/database.types";

function fail(message: string): { ok: false; error: string } {
  return { ok: false, error: message };
}

export async function addUpdate(input: {
  itemId: string;
  text: string;
}): Promise<ActionResult<{ updateId: string }>> {
  const parsed = addUpdateSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("Not authenticated.");

  // org_id/board_id are denormalized — derive them from the item (RLS-scoped).
  const { data: item, error: itemErr } = await supabase
    .from("items")
    .select("org_id, board_id")
    .eq("id", parsed.data.itemId)
    .maybeSingle();
  if (itemErr || !item) return fail("Item not found.");

  const { data, error } = await supabase
    .from("item_updates")
    .insert({
      org_id: item.org_id,
      board_id: item.board_id,
      item_id: parsed.data.itemId,
      author_id: user.id,
      body: { text: parsed.data.text } as Json,
      body_text: parsed.data.text,
    })
    .select("id")
    .single();
  if (error || !data) return fail(error?.message ?? "Could not post update.");

  return { ok: true, data: { updateId: data.id } };
}

export async function editUpdate(input: {
  updateId: string;
  text: string;
}): Promise<ActionResult> {
  const parsed = editUpdateSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("item_updates")
    .update({
      body: { text: parsed.data.text } as Json,
      body_text: parsed.data.text,
      edited_at: new Date().toISOString(),
    })
    .eq("id", parsed.data.updateId)
    .select("id")
    .maybeSingle();
  if (error) return fail(error.message);
  if (!data) return fail("Update not found.");
  return { ok: true, data: undefined };
}

export async function deleteUpdate(input: {
  updateId: string;
}): Promise<ActionResult> {
  const parsed = deleteUpdateSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const { error } = await supabase
    .from("item_updates")
    .delete()
    .eq("id", parsed.data.updateId);
  if (error) return fail(error.message);
  return { ok: true, data: undefined };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/collaboration/actions.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/collaboration/actions.ts src/lib/collaboration/actions.test.ts
git commit -m "feat(collab): add/edit/delete update server actions

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Activity render-resolution (pure logic)

**Files:**

- Create: `src/lib/collaboration/activity.ts`
- Test: `src/lib/collaboration/activity.test.ts`

Turns a raw `item_activities` row + the board's `columns` (+ members) into a typed descriptor the UI renders. Resolves status/dropdown option ids → `{label,color}` and people ids → names, using cache data (no fetch).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import {
  resolveActivity,
  type ActivityRow,
} from "@/lib/collaboration/activity";
import type { Tables } from "@/types/database.types";

const COL: Tables<"columns"> = {
  id: "col-status",
  org_id: "o",
  board_id: "b",
  kind: "status",
  name: "Status",
  settings: {
    options: [
      { id: "s1", label: "Working on it", color: "#fdab3d" },
      { id: "s2", label: "Done", color: "#00c875" },
    ],
  },
  position: 0,
  created_at: "",
  updated_at: "",
} as unknown as Tables<"columns">;

function row(partial: Partial<ActivityRow>): ActivityRow {
  return {
    id: "a1",
    org_id: "o",
    board_id: "b",
    item_id: "i1",
    actor_id: "u1",
    action: "cell_changed",
    column_id: "col-status",
    old_value: null,
    new_value: null,
    created_at: "2026-06-17T00:00:00Z",
    ...partial,
  } as ActivityRow;
}

describe("resolveActivity", () => {
  it("resolves a status change to from/to chips", () => {
    const d = resolveActivity(
      row({ action: "cell_changed", old_value: "s1", new_value: "s2" }),
      [COL],
      [],
    );
    expect(d).toMatchObject({
      kind: "cell_changed",
      columnName: "Status",
      from: { label: "Working on it", color: "#fdab3d" },
      to: { label: "Done", color: "#00c875" },
    });
  });

  it("renders item_renamed with from/to strings", () => {
    const d = resolveActivity(
      row({
        action: "item_renamed",
        column_id: null,
        old_value: "Old",
        new_value: "New",
      }),
      [COL],
      [],
    );
    expect(d).toMatchObject({ kind: "item_renamed", from: "Old", to: "New" });
  });

  it("renders item_created", () => {
    const d = resolveActivity(
      row({
        action: "item_created",
        column_id: null,
        new_value: { name: "Task" },
      }),
      [COL],
      [],
    );
    expect(d.kind).toBe("item_created");
  });

  it("falls back to a literal for a number cell", () => {
    const numCol = {
      ...COL,
      id: "col-n",
      kind: "numbers",
      name: "Estimate",
    } as unknown as Tables<"columns">;
    const d = resolveActivity(
      row({ column_id: "col-n", old_value: 3, new_value: 5 }),
      [numCol],
      [],
    );
    expect(d).toMatchObject({
      kind: "cell_changed",
      columnName: "Estimate",
      from: "3",
      to: "5",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/collaboration/activity.test.ts`
Expected: FAIL ("Cannot find module .../activity").

- [ ] **Step 3: Write the resolver**

```ts
import type { Tables } from "@/types/database.types";

export type ActivityRow = Tables<"item_activities">;
export type Column = Tables<"columns">;
export type Member = { userId: string; fullName: string | null };

type Chip = { label: string; color: string };
type CellDisplay = Chip | string | null;

export type ActivityDescriptor =
  | { kind: "item_created" }
  | { kind: "item_deleted" }
  | { kind: "item_renamed"; from: string | null; to: string | null }
  | { kind: "item_moved" }
  | { kind: "update_added" }
  | {
      kind: "cell_changed";
      columnName: string;
      columnKind: Column["kind"] | "unknown";
      from: CellDisplay;
      to: CellDisplay;
    };

type StatusOption = { id: string; label: string; color: string };

function describeCell(
  kind: Column["kind"] | "unknown",
  column: Column | undefined,
  value: unknown,
  members: readonly Member[],
): CellDisplay {
  if (value === null || value === undefined) return null;
  switch (kind) {
    case "status":
    case "dropdown": {
      const options =
        (column?.settings as { options?: StatusOption[] })?.options ?? [];
      const opt = options.find((o) => o.id === value);
      return opt
        ? { label: opt.label, color: opt.color }
        : { label: String(value), color: "#c4c4c4" };
    }
    case "people": {
      const ids = Array.isArray(value) ? (value as string[]) : [String(value)];
      const names = ids.map(
        (id) => members.find((m) => m.userId === id)?.fullName ?? "Someone",
      );
      return names.join(", ");
    }
    case "date": {
      const v = value as { date?: string };
      return v?.date ?? String(value);
    }
    default:
      return String(value);
  }
}

export function resolveActivity(
  row: ActivityRow,
  columns: readonly Column[],
  members: readonly Member[],
): ActivityDescriptor {
  switch (row.action) {
    case "item_created":
      return { kind: "item_created" };
    case "item_deleted":
      return { kind: "item_deleted" };
    case "item_moved":
      return { kind: "item_moved" };
    case "update_added":
      return { kind: "update_added" };
    case "item_renamed":
      return {
        kind: "item_renamed",
        from: row.old_value === null ? null : String(row.old_value),
        to: row.new_value === null ? null : String(row.new_value),
      };
    case "cell_changed": {
      const column = columns.find((c) => c.id === row.column_id);
      const kind = column?.kind ?? "unknown";
      return {
        kind: "cell_changed",
        columnName: column?.name ?? "Field",
        columnKind: kind,
        from: describeCell(kind, column, row.old_value, members),
        to: describeCell(kind, column, row.new_value, members),
      };
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/collaboration/activity.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/collaboration/activity.ts src/lib/collaboration/activity.test.ts
git commit -m "feat(collab): pure activity render-resolution

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Pure cache helpers for item updates/activity

**Files:**

- Create: `src/lib/collaboration/cache.ts`
- Test: `src/lib/collaboration/cache.test.ts`

Immutable patch helpers mirroring `boards/cache.ts`, used by the fetch hook, mutations, and Realtime.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import {
  prependUpdate,
  replaceUpdate,
  removeUpdate,
  prependActivity,
  type UpdatesCache,
  type ActivityCache,
} from "@/lib/collaboration/cache";
import type { Tables } from "@/types/database.types";

function upd(id: string): Tables<"item_updates"> {
  return {
    id,
    org_id: "o",
    board_id: "b",
    item_id: "i",
    author_id: "u",
    body: { text: id },
    body_text: id,
    edited_at: null,
    created_at: "2026-06-17T00:00:00Z",
    updated_at: "2026-06-17T00:00:00Z",
  } as Tables<"item_updates">;
}

describe("updates cache", () => {
  it("prepends newest-first and is idempotent on id", () => {
    let c: UpdatesCache = { updates: [upd("a")] };
    c = prependUpdate(c, upd("b"));
    expect(c.updates.map((u) => u.id)).toEqual(["b", "a"]);
    c = prependUpdate(c, upd("b")); // echo
    expect(c.updates.map((u) => u.id)).toEqual(["b", "a"]);
  });
  it("replaces and removes by id", () => {
    let c: UpdatesCache = { updates: [upd("a"), upd("b")] };
    const edited = { ...upd("a"), body_text: "edited" };
    c = replaceUpdate(c, edited);
    expect(c.updates.find((u) => u.id === "a")?.body_text).toBe("edited");
    c = removeUpdate(c, "a");
    expect(c.updates.map((u) => u.id)).toEqual(["b"]);
  });
});

describe("activity cache", () => {
  it("prepends and de-dupes by id", () => {
    const a = { id: "x" } as Tables<"item_activities">;
    let c: ActivityCache = { activities: [] };
    c = prependActivity(c, a);
    c = prependActivity(c, a);
    expect(c.activities).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/collaboration/cache.test.ts`
Expected: FAIL ("Cannot find module .../collaboration/cache").

- [ ] **Step 3: Write the helpers**

```ts
import type { Tables } from "@/types/database.types";

export type ItemUpdate = Tables<"item_updates">;
export type ItemActivity = Tables<"item_activities">;

export type UpdatesCache = { updates: ItemUpdate[] };
export type ActivityCache = { activities: ItemActivity[] };

export function prependUpdate(c: UpdatesCache, u: ItemUpdate): UpdatesCache {
  if (c.updates.some((x) => x.id === u.id)) return c;
  return { updates: [u, ...c.updates] };
}

export function replaceUpdate(c: UpdatesCache, u: ItemUpdate): UpdatesCache {
  return { updates: c.updates.map((x) => (x.id === u.id ? u : x)) };
}

export function removeUpdate(c: UpdatesCache, id: string): UpdatesCache {
  return { updates: c.updates.filter((x) => x.id !== id) };
}

export function prependActivity(
  c: ActivityCache,
  a: ItemActivity,
): ActivityCache {
  if (c.activities.some((x) => x.id === a.id)) return c;
  return { activities: [a, ...c.activities] };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/collaboration/cache.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/collaboration/cache.ts src/lib/collaboration/cache.test.ts
git commit -m "feat(collab): pure cache helpers for item updates/activity

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Item-collab fetch hook + per-item Realtime

**Files:**

- Create: `src/lib/collaboration/use-item-collab.ts`

Client hook: when an item id is set, fetch the latest updates + activity (bounded) via the browser Supabase client (RLS-scoped) into item-keyed React-Query caches, and subscribe a Realtime channel filtered `item_id=eq.<id>` reconciling both tables. Null `itemId` → no fetch/subscribe (`enabled: false`). Mirrors `use-board-realtime.ts`.

- [ ] **Step 1: Write the hook**

```ts
"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import {
  prependActivity,
  prependUpdate,
  removeUpdate,
  replaceUpdate,
  type ActivityCache,
  type ItemActivity,
  type ItemUpdate,
  type UpdatesCache,
} from "@/lib/collaboration/cache";

const UPDATES_LIMIT = 30;
const ACTIVITY_LIMIT = 50;

export function itemUpdatesKey(itemId: string) {
  return ["item-updates", itemId] as const;
}
export function itemActivityKey(itemId: string) {
  return ["item-activity", itemId] as const;
}

export function useItemCollab(itemId: string | null) {
  const qc = useQueryClient();

  const updates = useQuery({
    queryKey: itemUpdatesKey(itemId ?? "none"),
    enabled: !!itemId,
    staleTime: Infinity,
    queryFn: async (): Promise<UpdatesCache> => {
      const supabase = createClient();
      const { data } = await supabase
        .from("item_updates")
        .select("*")
        .eq("item_id", itemId!)
        .order("created_at", { ascending: false })
        .limit(UPDATES_LIMIT);
      return { updates: (data ?? []) as ItemUpdate[] };
    },
  });

  const activity = useQuery({
    queryKey: itemActivityKey(itemId ?? "none"),
    enabled: !!itemId,
    staleTime: Infinity,
    queryFn: async (): Promise<ActivityCache> => {
      const supabase = createClient();
      const { data } = await supabase
        .from("item_activities")
        .select("*")
        .eq("item_id", itemId!)
        .order("created_at", { ascending: false })
        .limit(ACTIVITY_LIMIT);
      return { activities: (data ?? []) as ItemActivity[] };
    },
  });

  useEffect(() => {
    if (!itemId) return;
    const supabase = createClient();
    const filter = `item_id=eq.${itemId}`;
    const uKey = itemUpdatesKey(itemId);
    const aKey = itemActivityKey(itemId);

    function onUpdate(p: RealtimePostgresChangesPayload<ItemUpdate>) {
      if (p.eventType === "DELETE") {
        const id = (p.old as Partial<ItemUpdate>).id;
        if (id)
          qc.setQueryData<UpdatesCache>(uKey, (prev) =>
            prev ? removeUpdate(prev, id) : prev,
          );
        return;
      }
      const row = p.new as ItemUpdate;
      qc.setQueryData<UpdatesCache>(uKey, (prev) =>
        prev
          ? prev.updates.some((u) => u.id === row.id)
            ? replaceUpdate(prev, row)
            : prependUpdate(prev, row)
          : prev,
      );
    }

    function onActivity(p: RealtimePostgresChangesPayload<ItemActivity>) {
      if (p.eventType !== "INSERT") return; // append-only
      const row = p.new as ItemActivity;
      qc.setQueryData<ActivityCache>(aKey, (prev) =>
        prev ? prependActivity(prev, row) : prev,
      );
    }

    const channel = supabase
      .channel(`item:${itemId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "item_updates", filter },
        onUpdate,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "item_activities", filter },
        onActivity,
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [itemId, qc]);

  return { updates, activity };
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS. (Behavior is covered live in Task 12 / e2e; the hook is thin glue over already-tested pure helpers.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/collaboration/use-item-collab.ts
git commit -m "feat(collab): item updates/activity fetch hook + per-item realtime

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Optimistic update mutations

**Files:**

- Create: `src/lib/collaboration/use-update-mutations.ts`

Mirrors `useBoardMutations`: optimistic add (temp id, replaced by Realtime echo via `replaceUpdate`-on-id is unnecessary since server id differs — use patch-on-success like `addItem`), optimistic edit + delete with rollback.

- [ ] **Step 1: Write the hook**

```ts
"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  addUpdate,
  editUpdate,
  deleteUpdate,
} from "@/lib/collaboration/actions";
import {
  prependUpdate,
  replaceUpdate,
  removeUpdate,
  type ItemUpdate,
  type UpdatesCache,
} from "@/lib/collaboration/cache";
import { itemUpdatesKey } from "@/lib/collaboration/use-item-collab";

type Ctx = { previous?: UpdatesCache };

export function useUpdateMutations(
  itemId: string,
  authorId: string,
  ctx: { orgId: string; boardId: string },
) {
  const qc = useQueryClient();
  const key = itemUpdatesKey(itemId);

  const add = useMutation<{ updateId: string }, Error, { text: string }, Ctx>({
    mutationFn: async (vars) => {
      const res = await addUpdate({ itemId, text: vars.text });
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<UpdatesCache>(key);
      if (previous) {
        const optimistic: ItemUpdate = {
          id: `optimistic-${Date.now()}`,
          org_id: ctx.orgId,
          board_id: ctx.boardId,
          item_id: itemId,
          author_id: authorId,
          body: { text: vars.text },
          body_text: vars.text,
          edited_at: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } as ItemUpdate;
        qc.setQueryData<UpdatesCache>(key, prependUpdate(previous, optimistic));
      }
      return { previous };
    },
    onError: (_e, _v, c) => {
      if (c?.previous) qc.setQueryData(key, c.previous);
    },
    onSettled: () => {
      // Realtime INSERT echo carries the real row; drop the optimistic temp.
      qc.setQueryData<UpdatesCache>(key, (prev) =>
        prev
          ? {
              updates: prev.updates.filter(
                (u) => !u.id.startsWith("optimistic-"),
              ),
            }
          : prev,
      );
    },
  });

  const edit = useMutation<
    void,
    Error,
    { update: ItemUpdate; text: string },
    Ctx
  >({
    mutationFn: async (vars) => {
      const res = await editUpdate({
        updateId: vars.update.id,
        text: vars.text,
      });
      if (!res.ok) throw new Error(res.error);
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<UpdatesCache>(key);
      if (previous) {
        qc.setQueryData<UpdatesCache>(
          key,
          replaceUpdate(previous, {
            ...vars.update,
            body: { text: vars.text },
            body_text: vars.text,
            edited_at: new Date().toISOString(),
          }),
        );
      }
      return { previous };
    },
    onError: (_e, _v, c) => {
      if (c?.previous) qc.setQueryData(key, c.previous);
    },
  });

  const remove = useMutation<void, Error, { updateId: string }, Ctx>({
    mutationFn: async (vars) => {
      const res = await deleteUpdate({ updateId: vars.updateId });
      if (!res.ok) throw new Error(res.error);
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<UpdatesCache>(key);
      if (previous)
        qc.setQueryData<UpdatesCache>(
          key,
          removeUpdate(previous, vars.updateId),
        );
      return { previous };
    },
    onError: (_e, _v, c) => {
      if (c?.previous) qc.setQueryData(key, c.previous);
    },
  });

  return {
    addUpdate: (text: string) => add.mutate({ text }),
    editUpdate: (update: ItemUpdate, text: string) =>
      edit.mutate({ update, text }),
    deleteUpdate: (updateId: string) => remove.mutate({ updateId }),
    isAdding: add.isPending,
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/collaboration/use-update-mutations.ts
git commit -m "feat(collab): optimistic update mutations

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Panel components (ActivityRow, ActivityTab, UpdatesTab, ItemPanel)

**Files:**

- Create: `src/components/boards/item-panel/ActivityRow.tsx`
- Create: `src/components/boards/item-panel/ActivityTab.tsx`
- Create: `src/components/boards/item-panel/UpdatesTab.tsx`
- Create: `src/components/boards/item-panel/ItemPanel.tsx`
- Test: `src/components/boards/item-panel/ActivityRow.test.tsx`

`ItemPanel` owns the Sheet (open when `itemId` non-null), the local tab state (Fields | Updates | Activity — plain `useState`, no URL, 0 round-trips), and calls `useItemCollab(itemId)`. Fields tab reuses existing cell editors (out of this task's test scope; render the item name + a simple field list keyed off the board cache columns). The component reads board context (org/board/columns/members) from props passed by `BoardViews`.

- [ ] **Step 1: Write the failing test (ActivityRow rendering)**

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ActivityRow } from "@/components/boards/item-panel/ActivityRow";
import type { ActivityDescriptor } from "@/lib/collaboration/activity";

describe("ActivityRow", () => {
  it("renders a status from→to with both labels", () => {
    const d: ActivityDescriptor = {
      kind: "cell_changed",
      columnName: "Status",
      columnKind: "status",
      from: { label: "Working on it", color: "#fdab3d" },
      to: { label: "Done", color: "#00c875" },
    };
    render(
      <ActivityRow
        descriptor={d}
        actorName="Ada"
        when="2026-06-17T00:00:00Z"
      />,
    );
    expect(screen.getByText("Working on it")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
    expect(screen.getByText(/Status/)).toBeInTheDocument();
  });

  it("renders item_created", () => {
    render(
      <ActivityRow
        descriptor={{ kind: "item_created" }}
        actorName="Ada"
        when="2026-06-17T00:00:00Z"
      />,
    );
    expect(screen.getByText(/created/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/components/boards/item-panel/ActivityRow.test.tsx`
Expected: FAIL ("Cannot find module .../ActivityRow").

- [ ] **Step 3: Implement `ActivityRow.tsx`**

```tsx
"use client";

import type { ActivityDescriptor } from "@/lib/collaboration/activity";

function Chip({
  value,
}: {
  value: { label: string; color: string } | string | null;
}) {
  if (value === null) return <span className="text-muted-foreground">—</span>;
  if (typeof value === "string") return <span>{value}</span>;
  return (
    <span
      className="rounded px-1.5 py-0.5 text-xs font-medium text-white"
      style={{ backgroundColor: value.color }}
    >
      {value.label}
    </span>
  );
}

export function ActivityRow({
  descriptor,
  actorName,
  when,
}: {
  descriptor: ActivityDescriptor;
  actorName: string;
  when: string;
}) {
  const time = new Date(when).toLocaleString();
  return (
    <li className="flex flex-col gap-1 border-b py-2 text-sm">
      <div className="text-muted-foreground flex items-center gap-2 text-xs">
        <span className="text-foreground font-medium">{actorName}</span>
        <span>{time}</span>
      </div>
      <div className="flex items-center gap-2">
        {descriptor.kind === "item_created" && <span>created this item</span>}
        {descriptor.kind === "item_deleted" && <span>deleted this item</span>}
        {descriptor.kind === "item_moved" && (
          <span>moved this item to another group</span>
        )}
        {descriptor.kind === "update_added" && <span>posted an update</span>}
        {descriptor.kind === "item_renamed" && (
          <>
            <span>renamed</span>
            <Chip value={descriptor.from} /> <span aria-hidden>→</span>{" "}
            <Chip value={descriptor.to} />
          </>
        )}
        {descriptor.kind === "cell_changed" && (
          <>
            <span className="text-muted-foreground">
              {descriptor.columnName}:
            </span>
            <Chip value={descriptor.from} /> <span aria-hidden>→</span>{" "}
            <Chip value={descriptor.to} />
          </>
        )}
      </div>
    </li>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/components/boards/item-panel/ActivityRow.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Implement `ActivityTab.tsx`**

```tsx
"use client";

import {
  resolveActivity,
  type Column,
  type Member,
} from "@/lib/collaboration/activity";
import type { ActivityCache } from "@/lib/collaboration/cache";
import { ActivityRow } from "./ActivityRow";

export function ActivityTab({
  cache,
  columns,
  members,
}: {
  cache: ActivityCache | undefined;
  columns: readonly Column[];
  members: readonly Member[];
}) {
  if (!cache || cache.activities.length === 0) {
    return (
      <p className="text-muted-foreground py-6 text-center text-sm">
        No activity yet.
      </p>
    );
  }
  return (
    <ul className="flex flex-col">
      {cache.activities.map((a) => (
        <ActivityRow
          key={a.id}
          descriptor={resolveActivity(a, columns, members)}
          actorName={
            members.find((m) => m.userId === a.actor_id)?.fullName ?? "Someone"
          }
          when={a.created_at}
        />
      ))}
    </ul>
  );
}
```

- [ ] **Step 6: Implement `UpdatesTab.tsx`**

```tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { UpdatesCache } from "@/lib/collaboration/cache";
import type { Member } from "@/lib/collaboration/activity";

export function UpdatesTab({
  cache,
  members,
  onAdd,
  onDelete,
}: {
  cache: UpdatesCache | undefined;
  members: readonly Member[];
  onAdd: (text: string) => void;
  onDelete: (updateId: string) => void;
}) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);

  function submit() {
    const t = text.trim();
    if (!t) return;
    onAdd(t);
    setText("");
    setOpen(false);
  }

  return (
    <div className="flex flex-col gap-4">
      {!open ? (
        <button
          className="text-muted-foreground hover:bg-accent rounded-md border px-3 py-2 text-left text-sm"
          onClick={() => setOpen(true)}
        >
          Write an update
        </button>
      ) : (
        <div className="flex flex-col gap-2">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoFocus
            rows={3}
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={submit}>
              Update
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setOpen(false);
                setText("");
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {!cache || cache.updates.length === 0 ? (
        <p className="text-muted-foreground py-6 text-center text-sm">
          No updates yet for this item.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {cache.updates.map((u) => (
            <li key={u.id} className="rounded-md border p-3 text-sm">
              <div className="text-muted-foreground mb-1 flex items-center justify-between text-xs">
                <span className="text-foreground font-medium">
                  {members.find((m) => m.userId === u.author_id)?.fullName ??
                    "Someone"}
                </span>
                <button
                  className="opacity-60 hover:opacity-100"
                  onClick={() => onDelete(u.id)}
                  aria-label="Delete update"
                >
                  Delete
                </button>
              </div>
              <p className="whitespace-pre-wrap">{u.body_text}</p>
              {u.edited_at && (
                <span className="text-muted-foreground text-xs">(edited)</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Implement `ItemPanel.tsx`**

```tsx
"use client";

import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useItemCollab } from "@/lib/collaboration/use-item-collab";
import { useUpdateMutations } from "@/lib/collaboration/use-update-mutations";
import type { Column, Member } from "@/lib/collaboration/activity";
import { ActivityTab } from "./ActivityTab";
import { UpdatesTab } from "./UpdatesTab";

type Tab = "fields" | "updates" | "activity";

export function ItemPanel({
  itemId,
  itemName,
  orgId,
  boardId,
  currentUserId,
  columns,
  members,
  onClose,
}: {
  itemId: string | null;
  itemName: string;
  orgId: string;
  boardId: string;
  currentUserId: string;
  columns: readonly Column[];
  members: readonly Member[];
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("updates");
  const { updates, activity } = useItemCollab(itemId);
  const mutations = useUpdateMutations(itemId ?? "none", currentUserId, {
    orgId,
    boardId,
  });

  return (
    <Sheet open={!!itemId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{itemName}</SheetTitle>
        </SheetHeader>

        <div className="flex gap-1 border-b">
          {(["fields", "updates", "activity"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-2 text-sm capitalize ${
                tab === t
                  ? "border-primary border-b-2 font-medium"
                  : "text-muted-foreground"
              }`}
            >
              {t === "activity" ? "Activity Log" : t}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto">
          {tab === "fields" && (
            <p className="text-muted-foreground py-6 text-sm">
              Edit fields in the board grid. (Inline field editing in the panel
              is a fast-follow.)
            </p>
          )}
          {tab === "updates" && (
            <UpdatesTab
              cache={updates.data}
              members={members}
              onAdd={mutations.addUpdate}
              onDelete={mutations.deleteUpdate}
            />
          )}
          {tab === "activity" && (
            <ActivityTab
              cache={activity.data}
              columns={columns}
              members={members}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 8: Run the full collab test suite + typecheck**

Run: `pnpm vitest run src/components/boards/item-panel src/lib/collaboration && pnpm typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/components/boards/item-panel/
git commit -m "feat(collab): item panel (sheet) with updates + activity tabs

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Wire the panel into the board + open via `?item=`

**Files:**

- Modify: `src/components/boards/BoardViews.tsx`
- Modify: `src/components/boards/BoardTable.tsx`

Open/close uses the **History API** so there is no RSC re-run (gotcha-09), identical to how `ViewSwitcher` sets `?view=`. `BoardViews` reads `?item=` and renders `<ItemPanel>`; a row "open" affordance in `BoardTable` calls `pushState`.

- [ ] **Step 1: Add an `openItem` helper + render the panel in `BoardViews.tsx`**

Add to the imports:

```tsx
import { ItemPanel } from "@/components/boards/item-panel/ItemPanel";
```

Inside `BoardViews`, after computing `activeViewId`, derive the open item and a close handler (the cache holds the item name + columns; `members` is already a prop):

```tsx
const openItemId = searchParams.get("item");
const openItem = openItemId
  ? (payload.items.find((i) => i.id === openItemId) ?? null)
  : null;

function closeItem() {
  const url = new URL(window.location.href);
  url.searchParams.delete("item");
  window.history.pushState({}, "", url);
}
```

Wrap the returned view in a fragment that also renders the panel (example for the default `BoardTable` branch; apply the same `<ItemPanel>` block to each branch's wrapper, or render it once after the `switch` by lifting the view element into a variable). Simplest: render the panel once alongside whatever view is chosen:

```tsx
const currentUserId = members.length ? members[0].userId : ""; // replaced below
```

> **Note:** `BoardViews` does not currently receive the current user id. Add a `currentUserId: string` prop to `BoardViews`, thread it from `page.tsx` (`user.id` from `requireUser()`), and pass it to `<ItemPanel>`. Update the `BoardViews` prop type and the `page.tsx` call site in this step.

Final structure of the return:

```tsx
const view =
  selected?.kind === "kanban" ? (
    <KanbanBoard
      payload={payload}
      members={members}
      selectedViewId={activeViewId}
    />
  ) : selected?.kind === "calendar" ? (
    <CalendarBoard
      payload={payload}
      members={members}
      selectedViewId={activeViewId}
    />
  ) : selected?.kind === "timeline" ? (
    <GanttBoard
      payload={payload}
      members={members}
      selectedViewId={activeViewId}
    />
  ) : (
    <BoardTable
      payload={payload}
      members={members}
      selectedViewId={activeViewId}
    />
  );

return (
  <>
    {view}
    <ItemPanel
      itemId={openItem?.id ?? null}
      itemName={openItem?.name ?? ""}
      orgId={payload.board.org_id}
      boardId={payload.board.id}
      currentUserId={currentUserId}
      columns={payload.columns}
      members={members.map((m) => ({ userId: m.userId, fullName: m.fullName }))}
      onClose={closeItem}
    />
  </>
);
```

(Replace the temporary `currentUserId` line with the threaded prop.)

- [ ] **Step 2: Add a row-open affordance in `BoardTable.tsx`**

Add a small "expand" control on each item row (e.g. a button in the name cell) that opens the panel without an RSC navigation:

```tsx
function openItemPanel(itemId: string) {
  const url = new URL(window.location.href);
  url.searchParams.set("item", itemId);
  window.history.pushState({}, "", url);
}
```

Wire it to a button rendered next to each row's name (use an existing icon, e.g. `lucide-react`'s `Maximize2` / `ChevronRight`), `onClick={() => openItemPanel(item.id)}`. Match the existing row markup/classes in `BoardTable`.

- [ ] **Step 3: Typecheck + lint + build**

Run: `pnpm typecheck && pnpm lint && pnpm build`
Expected: PASS. Confirm `page.tsx` passes `currentUserId={user.id}` to `BoardViews`.

- [ ] **Step 4: Commit**

```bash
git add src/components/boards/BoardViews.tsx src/components/boards/BoardTable.tsx src/app/boards/[boardId]/page.tsx
git commit -m "feat(collab): open item panel via ?item= (history api, no rsc refetch)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: RLS + trigger integration tests (live DB)

**Files:**

- Create: `src/lib/collaboration/collaboration.rls.integration.test.ts`

Mirror `boards.rls.integration.test.ts`: `describe.skipIf(!SERVICE_ROLE_KEY)`, provision two users in two orgs via anon clients (`create_organization` → workspace insert → `create_board` → `create_item`). Then assert collaboration-specific guarantees.

- [ ] **Step 1: Write the integration test**

```ts
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/types/database.types";

config({ path: ".env.local", override: true });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = "Test-Password-123!";

describe.skipIf(!SERVICE_ROLE_KEY)("RLS: collaboration", () => {
  let admin: SupabaseClient<Database>;
  const createdUserIds: string[] = [];

  type U = {
    id: string;
    orgId: string;
    boardId: string;
    itemId: string;
    anon: SupabaseClient<Database>;
  };

  async function provision(label: string): Promise<U> {
    const email = `rls-collab-${randomUUID()}@example.com`;
    const { data: created } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    });
    const id = created.user!.id;
    createdUserIds.push(id);
    const anon = createClient<Database>(SUPABASE_URL!, ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await anon.auth.signInWithPassword({ email, password: PASSWORD });
    const { data: org } = await anon.rpc("create_organization", {
      p_name: `Org ${label}`,
      p_slug: `collab-${label}-${randomUUID().slice(0, 8)}`,
    });
    const orgId = (org as { id: string }).id;
    const { data: ws } = await anon
      .from("workspaces")
      .insert({ org_id: orgId, name: `WS ${label}`, created_by: id })
      .select("id")
      .single();
    const { data: board } = await anon.rpc("create_board", {
      p_workspace_id: (ws as { id: string }).id,
      p_name: `Board ${label}`,
    });
    const boardId = (board as { id: string }).id;
    const { data: group } = await anon
      .from("groups")
      .select("id")
      .eq("board_id", boardId)
      .limit(1)
      .single();
    const { data: item } = await anon.rpc("create_item", {
      p_group_id: (group as { id: string }).id,
      p_name: "Item",
    });
    return { id, orgId, boardId, itemId: (item as { id: string }).id, anon };
  }

  let a: U;
  let b: U;
  beforeAll(async () => {
    admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    a = await provision("a");
    b = await provision("b");
  });
  afterAll(async () => {
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  });

  it("logs item_created on create_item via trigger", async () => {
    const { data } = await a.anon
      .from("item_activities")
      .select("action")
      .eq("item_id", a.itemId);
    expect(data?.some((r) => r.action === "item_created")).toBe(true);
  });

  it("logs an update_added activity when an update is posted", async () => {
    await a.anon.from("item_updates").insert({
      org_id: a.orgId,
      board_id: a.boardId,
      item_id: a.itemId,
      author_id: a.id,
      body: { text: "hi" },
      body_text: "hi",
    });
    const { data } = await a.anon
      .from("item_activities")
      .select("action")
      .eq("item_id", a.itemId);
    expect(data?.some((r) => r.action === "update_added")).toBe(true);
  });

  it("denies cross-tenant read of another org's updates", async () => {
    const { data } = await b.anon
      .from("item_updates")
      .select("id")
      .eq("item_id", a.itemId);
    expect(data ?? []).toHaveLength(0);
  });

  it("forbids a client INSERT into item_activities", async () => {
    const { error } = await a.anon.from("item_activities").insert({
      org_id: a.orgId,
      board_id: a.boardId,
      item_id: a.itemId,
      action: "cell_changed",
    } as never);
    expect(error).not.toBeNull(); // no insert policy → RLS rejects
  });

  it("forbids deleting another member's-org update", async () => {
    const { data: upd } = await a.anon
      .from("item_updates")
      .select("id")
      .eq("item_id", a.itemId)
      .limit(1)
      .single();
    const { error } = await b.anon
      .from("item_updates")
      .delete()
      .eq("id", (upd as { id: string }).id);
    // RLS hides the row from b → delete affects 0 rows (no error, no effect)
    const { data: still } = await a.anon
      .from("item_updates")
      .select("id")
      .eq("id", (upd as { id: string }).id);
    expect(still ?? []).toHaveLength(1);
    expect(error).toBeNull();
  });
});
```

- [ ] **Step 2: Run the integration test**

Run: `pnpm vitest run src/lib/collaboration/collaboration.rls.integration.test.ts`
Expected: PASS (5 tests) when `.env.local` has service-role creds; otherwise the suite is skipped (matches the boards harness).

- [ ] **Step 3: Commit**

```bash
git add src/lib/collaboration/collaboration.rls.integration.test.ts
git commit -m "test(collab): rls isolation + trigger activity integration tests

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: e2e — add an update, see it + the activity

**Files:**

- Create: `e2e/item-panel.spec.ts`

Follow the existing Playwright setup (sign-in helper, a seeded board). Open a board, open an item panel via the row affordance, post an update, assert it appears, switch to Activity Log, assert an "update" entry appears.

- [ ] **Step 1: Write the e2e spec**

```ts
import { test, expect } from "@playwright/test";
// Reuse the project's existing auth/board fixtures. If a helper like
// `signInAndOpenBoard(page)` exists in e2e/, import and use it; otherwise
// replicate the sign-in steps used by the other specs in e2e/.

test("post an update and see it logged in activity", async ({ page }) => {
  await page.goto("/boards"); // adjust to the seeded board route used by other specs
  // Open the first board, then open the first item's panel.
  await page
    .getByRole("button", { name: /open item|expand/i })
    .first()
    .click();

  // Updates tab is default; post an update.
  await page.getByRole("button", { name: "Write an update" }).click();
  await page.getByRole("textbox").fill("Kickoff scheduled");
  await page.getByRole("button", { name: "Update" }).click();
  await expect(page.getByText("Kickoff scheduled")).toBeVisible();

  // Switch to Activity Log; an update entry should be present.
  await page.getByRole("button", { name: "Activity Log" }).click();
  await expect(page.getByText(/posted an update/i)).toBeVisible();
});
```

- [ ] **Step 2: Run e2e**

Run: `pnpm exec playwright test e2e/item-panel.spec.ts`
Expected: PASS. (If selectors differ from the seeded fixture, align them with the other specs in `e2e/`.)

- [ ] **Step 3: Commit**

```bash
git add e2e/item-panel.spec.ts
git commit -m "test(collab): e2e add-update -> activity flow

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: Full verification gate

- [ ] **Step 1: Run the full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all PASS.

- [ ] **Step 2: Supabase advisors**

Run the Supabase advisors (security + performance) against the project and confirm no new warnings for `item_updates` / `item_activities` (RLS enabled on both; expected clean).

- [ ] **Step 3: Wrap up**

Run `/wrapup` to log the session and bump the north-star (flip Phase 4 4a → Done, link the PR).

---

## Self-Review

**1. Spec coverage (spec §1–§12):**

- §1/§3 tables `item_updates`, `item_activities` → Task 2. (`notifications`, `attachments` correctly excluded — 4b/4c.)
- §4 trigger-driven activity, raw diffs, render-time resolution → Task 2 (triggers) + Task 6 (`activity.ts`). ✔
- §5 panel: Sheet (Task 1/10), `?item=` History API 0-refetch (Task 11), Fields/Updates/Activity tabs (Task 10), fields from board cache (Task 10/11), bounded reads (Task 8 `UPDATES_LIMIT`/`ACTIVITY_LIMIT`). ✔
- §6 queries/actions/realtime: actions (Task 5), fetch hook + per-item realtime (Task 8), optimistic mutations (Task 9), no `revalidatePath` (Task 5). ✔
- §9 perf budget: tab switch = local state (Task 10); open = 0 RSC refetch (Task 11); bounded indexed reads (Task 2 indexes + Task 8 limits). ✔
- §10 reject-list: append-only activity (no cap; no client insert — Task 2 + Task 12 test); updates as rows (Task 2); row-level realtime (Task 8); Zod-validated writes (Task 4/5). ✔
- §11 testing: RLS + trigger integration (Task 12), pure unit tests (Tasks 4/6/7), component (Task 10), e2e (Task 13). ✔
- §12 build order: matches Tasks 2→3→5/6→8→10→11→12→13. ✔
- **Gaps consciously narrowed (flagged at top):** plaintext updates (marks deferred), `item_moved` on group change only, no @mention parsing in 4a. The Fields tab is a placeholder (inline cell editing in-panel is a fast-follow) — items' fields remain fully editable in the grid; this does not block 4a.

**2. Placeholder scan:** No "TBD"/"implement later". Every code step has complete code. Task 11 contains prose-guided edits (threading `currentUserId`, adding the row affordance) because they are small modifications to existing files whose exact surrounding markup the implementer must match — the code to add is given verbatim; only the insertion point follows existing patterns.

**3. Type/name consistency:** `ActionResult` imported from `@/lib/boards/actions`; `addUpdate/editUpdate/deleteUpdate` names consistent across Tasks 5/9; cache helpers `prependUpdate/replaceUpdate/removeUpdate/prependActivity` consistent across Tasks 7/8/9; `itemUpdatesKey/itemActivityKey` defined in Task 8 and consumed in Task 9; `resolveActivity`/`ActivityDescriptor`/`Column`/`Member` consistent across Tasks 6/10; body shape `{ text }` consistent across Tasks 4/5/9; enum `activity_action` values consistent between Task 2 and `resolveActivity`'s switch (Task 6).
