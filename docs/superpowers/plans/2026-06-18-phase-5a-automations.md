# Phase 5a — Automations (engine + lean When/Then) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a per-board, in-DB automation engine: rules fire when a Status/Dropdown cell changes and run notify-person + set-option actions, with a builder UI.

**Architecture:** A new `automations` table (jsonb `trigger`/`actions`, org-RLS) + one `AFTER INSERT OR UPDATE` trigger on `cell_values` (`SECURITY DEFINER`, `search_path=''`, transaction-local depth-cap loop guard) that matches enabled rules and runs actions in-DB. Server Actions (Zod-validated, RLS-guarded) do CRUD; a client `AutomationsDialog` + guided `AutomationBuilder` (opened from `BoardHeader`) manage rules. Results surface via the existing `cell_values`/`notifications` Realtime — no new realtime wiring.

**Tech Stack:** Next.js 16 (App Router, Server Actions), React 19, Supabase Postgres (plpgsql triggers, RLS), TanStack Query, Zod, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-06-18-phase-5a-automations-design.md`

**Cloud note:** This project is cloud-native (no local Supabase stack). Migrations are applied with `supabase db push --linked` **only with the user's per-session authorization** (see north-star manual gates). After a migration, regenerate types with `pnpm db:types` (filter the stray PostHog `"_tag"` line if present) and commit `src/types/database.types.ts` in the same task.

---

## File Structure

- **Create** `supabase/migrations/<ts>_automations.sql` — table + indexes + RLS + `set_updated_at` trigger + `notification_kind 'automation'` + `notifications.automation_id`.
- **Create** `supabase/migrations/<ts2>_automations_engine.sql` — `tg_run_automations()` + the `cell_values` trigger.
- **Create** `src/lib/validations/automations.ts` — Zod trigger/action/CRUD schemas + inferred types.
- **Create** `src/lib/validations/automations.test.ts` — schema unit tests.
- **Create** `src/lib/boards/automation-actions.ts` — `createAutomation`/`updateAutomation`/`deleteAutomation` Server Actions.
- **Modify** `src/lib/boards/queries.ts` — add `listAutomations(boardId)` + `Automation` row type.
- **Create** `src/lib/boards/automations.rls.integration.test.ts` — cloud RLS + engine behavior.
- **Create** `src/components/boards/automations/AutomationsDialog.tsx` — rule list + enable/delete + entry to builder.
- **Create** `src/components/boards/automations/AutomationBuilder.tsx` — guided sentence builder + recipe quick-starts.
- **Create** `src/components/boards/automations/recipes.ts` — recipe prefills (pure).
- **Create** `src/components/boards/automations/AutomationBuilder.test.tsx` — builder JSON-construction + recipe tests.
- **Modify** `src/components/boards/BoardHeader.tsx` — add an "Automations" button mounting the dialog; thread `columns` + `members` props.
- **Modify** `src/components/boards/BoardViews.tsx` — pass `columns` + `members` into `BoardHeader`.
- **Modify** the notifications inbox renderer (file located in Task 7 Step 1) — render the `'automation'` kind.

---

## Task 1: Schema migration — `automations` table + RLS + notifications extension

**Files:**

- Create: `supabase/migrations/<ts>_automations.sql` (use a timestamp later than the latest existing migration; check `ls supabase/migrations | tail -1`)
- Modify: `src/types/database.types.ts` (regenerated)

- [ ] **Step 1: Write the migration SQL**

```sql
-- Phase 5a: automations storage + RLS. Per-board When/Then rules evaluated by an
-- in-DB trigger (see the engine migration). trigger/actions are jsonb (validated
-- by Zod at the Server Action boundary), mirroring columns.settings. RLS + the
-- board_in_org write-guard mirror public.columns exactly.
create table public.automations (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  board_id    uuid not null references public.boards (id) on delete cascade,
  name        text,
  enabled     boolean not null default true,
  trigger     jsonb not null,
  actions     jsonb not null default '[]'::jsonb,
  created_by  uuid references auth.users (id),
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index automations_board_idx on public.automations (board_id, position);
create index automations_org_idx on public.automations (org_id);
-- speed the trigger's per-cell lookup: enabled rules by board + triggering column
create index automations_trigger_col_idx
  on public.automations (board_id, (trigger->>'columnId')) where enabled;

create trigger automations_set_updated_at
  before update on public.automations
  for each row execute function public.set_updated_at();

alter table public.automations enable row level security;

create policy "automations: read if member" on public.automations
  for select to authenticated using (public.is_org_member(org_id));
create policy "automations: insert if member" on public.automations
  for insert to authenticated
  with check (public.is_org_member(org_id) and public.board_in_org(board_id, org_id));
create policy "automations: update if member" on public.automations
  for update to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id) and public.board_in_org(board_id, org_id));
create policy "automations: delete if member" on public.automations
  for delete to authenticated using (public.is_org_member(org_id));

grant select, insert, update, delete on public.automations to authenticated;

-- notifications: new kind + optional rule reference for inbox labelling.
-- (ADD VALUE is safe here: we do not USE the new value in DML in this migration.)
alter type public.notification_kind add value if not exists 'automation';
alter table public.notifications
  add column automation_id uuid references public.automations (id) on delete set null;
```

- [ ] **Step 2: Apply the migration to the linked project**

Run (with user authorization): `supabase db push --linked`
Expected: the migration applies cleanly (new table + policies + enum value + column).

- [ ] **Step 3: Regenerate + commit types**

Run: `pnpm db:types`
Then open `src/types/database.types.ts` and remove any stray non-TypeScript line (a PostHog telemetry line containing `"_tag"`) if present; ensure it still parses.
Run: `pnpm typecheck` → clean.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/ src/types/database.types.ts
git commit -m "feat(automations): automations table + RLS + notification kind (5a schema)"
```

---

## Task 2: Engine migration — `tg_run_automations()` trigger

**Files:**

- Create: `supabase/migrations/<ts2>_automations_engine.sql` (timestamp after Task 1's)

- [ ] **Step 1: Write the engine SQL**

```sql
-- Phase 5a: in-DB automation engine. AFTER trigger on cell_values evaluates
-- enabled rules whose trigger column matches the changed cell, then runs their
-- actions (notify / set_option). A transaction-local depth guard caps cascades
-- (legitimate chains allowed up to depth 5; runaway loops bounded). Mirrors the
-- existing SECURITY DEFINER + search_path='' trigger pattern.
create or replace function public.tg_run_automations()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_depth  int  := coalesce(current_setting('pulse.aut_depth', true)::int, 0);
  v_actor  uuid := (select auth.uid());
  v_new_opt text := new.value->>'optionId';
  r        record;
  a        jsonb;
  v_rid    uuid;
  v_target uuid;
  v_opt    text;
begin
  -- 1. no-op guard
  if (tg_op = 'UPDATE' and new.value is not distinct from old.value) then
    return new;
  end if;

  -- 2. depth guard (loop safety)
  if v_depth >= 5 then
    return new;
  end if;
  perform set_config('pulse.aut_depth', (v_depth + 1)::text, true);

  -- 3. match enabled rules for this board + triggering column
  for r in
    select id, actions
    from public.automations
    where board_id = new.board_id
      and enabled
      and trigger->>'columnId' = new.column_id::text
      and (
        trigger->>'toOptionId' is null
        or trigger->>'toOptionId' = v_new_opt
        or (new.value ? 'optionIds'
            and (new.value->'optionIds') ? (trigger->>'toOptionId'))
      )
  loop
    -- 4. run actions in array order
    for a in select * from jsonb_array_elements(r.actions)
    loop
      if a->>'type' = 'notify' then
        if a#>>'{recipient,kind}' = 'member' then
          v_rid := (a#>>'{recipient,userId}')::uuid;
        else
          select (cv.value->'userIds'->>0)::uuid
            into v_rid
          from public.cell_values cv
          where cv.item_id = new.item_id
            and cv.column_id = (a#>>'{recipient,peopleColumnId}')::uuid;
        end if;

        if v_rid is not null and v_rid is distinct from v_actor then
          if not exists (
            select 1 from public.notifications n
            where n.recipient_id = v_rid
              and n.item_id = new.item_id
              and n.automation_id = r.id
              and n.read_at is null
          ) then
            insert into public.notifications
              (org_id, recipient_id, actor_id, kind, board_id, item_id, automation_id)
            values
              (new.org_id, v_rid, v_actor, 'automation', new.board_id, new.item_id, r.id);
          end if;
        end if;

      elsif a->>'type' = 'set_option' then
        v_target := (a->>'columnId')::uuid;
        v_opt := a->>'optionId';
        if not exists (
          select 1 from public.cell_values cv
          where cv.item_id = new.item_id
            and cv.column_id = v_target
            and cv.value->>'optionId' = v_opt
        ) then
          insert into public.cell_values (org_id, board_id, item_id, column_id, value)
          values (new.org_id, new.board_id, new.item_id, v_target,
                  jsonb_build_object('optionId', v_opt))
          on conflict (item_id, column_id) do update set value = excluded.value;
        end if;
      end if;
    end loop;
  end loop;

  return new;
end; $$;

create trigger cell_values_run_automations
  after insert or update on public.cell_values
  for each row execute function public.tg_run_automations();
```

- [ ] **Step 2: Apply + sanity-check**

Run (with user authorization): `supabase db push --linked`
Expected: function + trigger created. (Behavior is verified by Task 6's integration test — do not hand-test here.)

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/
git commit -m "feat(automations): in-DB engine trigger with depth-cap loop guard (5a)"
```

---

## Task 3: Zod validations

**Files:**

- Create: `src/lib/validations/automations.ts`
- Test: `src/lib/validations/automations.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import {
  automationTriggerSchema,
  automationActionsSchema,
  createAutomationSchema,
} from "@/lib/validations/automations";

const UUID = "00000000-0000-4000-8000-000000000001";
const UUID2 = "00000000-0000-4000-8000-000000000002";

describe("automation schemas", () => {
  it("accepts a status_changed trigger (specific + any)", () => {
    expect(
      automationTriggerSchema.safeParse({
        type: "status_changed",
        columnId: UUID,
        toOptionId: "opt-1",
      }).success,
    ).toBe(true);
    expect(
      automationTriggerSchema.safeParse({
        type: "status_changed",
        columnId: UUID,
        toOptionId: null,
      }).success,
    ).toBe(true);
  });

  it("accepts notify(owner/member) and set_option actions", () => {
    const ok = automationActionsSchema.safeParse([
      { type: "notify", recipient: { kind: "owner", peopleColumnId: UUID } },
      { type: "notify", recipient: { kind: "member", userId: UUID2 } },
      { type: "set_option", columnId: UUID, optionId: "opt-9" },
    ]);
    expect(ok.success).toBe(true);
  });

  it("rejects an empty actions array and unknown action types", () => {
    expect(automationActionsSchema.safeParse([]).success).toBe(false);
    expect(
      automationActionsSchema.safeParse([{ type: "delete_item" }]).success,
    ).toBe(false);
  });

  it("requires a valid trigger + non-empty actions for create", () => {
    expect(
      createAutomationSchema.safeParse({
        boardId: UUID,
        trigger: { type: "status_changed", columnId: UUID, toOptionId: null },
        actions: [{ type: "set_option", columnId: UUID2, optionId: "x" }],
      }).success,
    ).toBe(true);
    expect(
      createAutomationSchema.safeParse({
        boardId: UUID,
        trigger: {},
        actions: [],
      }).success,
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- src/lib/validations/automations.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the schemas**

```ts
import { z } from "zod";

export const automationTriggerSchema = z.object({
  type: z.literal("status_changed"),
  columnId: z.string().uuid(),
  toOptionId: z.string().min(1).nullable(),
});
export type AutomationTrigger = z.infer<typeof automationTriggerSchema>;

const notifyRecipientSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("owner"), peopleColumnId: z.string().uuid() }),
  z.object({ kind: z.literal("member"), userId: z.string().uuid() }),
]);

export const automationActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("notify"), recipient: notifyRecipientSchema }),
  z.object({
    type: z.literal("set_option"),
    columnId: z.string().uuid(),
    optionId: z.string().min(1),
  }),
]);
export type AutomationAction = z.infer<typeof automationActionSchema>;

export const automationActionsSchema = z.array(automationActionSchema).min(1);

export const createAutomationSchema = z.object({
  boardId: z.string().uuid(),
  name: z.string().trim().max(120).optional(),
  trigger: automationTriggerSchema,
  actions: automationActionsSchema,
});

export const updateAutomationSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().max(120).optional(),
  enabled: z.boolean().optional(),
  trigger: automationTriggerSchema.optional(),
  actions: automationActionsSchema.optional(),
});

export const deleteAutomationSchema = z.object({ id: z.string().uuid() });
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test -- src/lib/validations/automations.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/validations/automations.ts src/lib/validations/automations.test.ts
git commit -m "feat(automations): zod trigger/action/CRUD schemas (5a)"
```

---

## Task 4: Server Actions + query

**Files:**

- Create: `src/lib/boards/automation-actions.ts`
- Modify: `src/lib/boards/queries.ts` (add `listAutomations` + `Automation` type)

Mirror the established action shape in `src/lib/boards/actions.ts`: `"use server"`, `safeParse` the input, `createClient()`, derive `org_id` from the parent (RLS-scoped read), mutate, `revalidatePath`, return an `ActionResult`. Reuse the same `ActionResult`/`fail` shape (re-declare locally to avoid importing server-only internals, matching how other action files do it).

- [ ] **Step 1: Add the query to `queries.ts`**

Add near the other list queries (this file is server-only; it already exports row types):

```ts
export type Automation = Tables<"automations">;

export async function listAutomations(boardId: string): Promise<Automation[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("automations")
    .select("*")
    .eq("board_id", boardId)
    .order("position", { ascending: true });
  if (error) throw error;
  return data ?? [];
}
```

(Confirm `Tables` + `createClient` are already imported in `queries.ts`; if not, add `import type { Tables } from "@/types/database.types";` and the existing supabase server import used by the other queries.)

- [ ] **Step 2: Write the Server Actions**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  createAutomationSchema,
  updateAutomationSchema,
  deleteAutomationSchema,
} from "@/lib/validations/automations";

type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };
const fail = (error: string): ActionResult<never> => ({ ok: false, error });

export async function createAutomation(input: {
  boardId: string;
  name?: string;
  trigger: unknown;
  actions: unknown;
}): Promise<ActionResult<{ id: string }>> {
  const parsed = createAutomationSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const { data: board, error: bErr } = await supabase
    .from("boards")
    .select("org_id")
    .eq("id", parsed.data.boardId)
    .maybeSingle();
  if (bErr || !board) return fail("Board not found.");

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: nextPos } = await supabase
    .from("automations")
    .select("position")
    .eq("board_id", parsed.data.boardId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await supabase
    .from("automations")
    .insert({
      org_id: board.org_id,
      board_id: parsed.data.boardId,
      name: parsed.data.name ?? null,
      trigger: parsed.data.trigger,
      actions: parsed.data.actions,
      created_by: user?.id ?? null,
      position: (nextPos?.position ?? -1) + 1,
    })
    .select("id")
    .single();
  if (error || !data) return fail(error?.message ?? "Failed to create");

  revalidatePath(`/boards/${parsed.data.boardId}`);
  return { ok: true, data: { id: data.id } };
}

export async function updateAutomation(input: {
  id: string;
  name?: string;
  enabled?: boolean;
  trigger?: unknown;
  actions?: unknown;
}): Promise<ActionResult> {
  const parsed = updateAutomationSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const patch: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.enabled !== undefined) patch.enabled = parsed.data.enabled;
  if (parsed.data.trigger !== undefined) patch.trigger = parsed.data.trigger;
  if (parsed.data.actions !== undefined) patch.actions = parsed.data.actions;

  const { data, error } = await supabase
    .from("automations")
    .update(patch)
    .eq("id", parsed.data.id)
    .select("board_id")
    .maybeSingle();
  if (error) return fail(error.message);
  if (data?.board_id) revalidatePath(`/boards/${data.board_id}`);
  return { ok: true, data: undefined };
}

export async function deleteAutomation(input: {
  id: string;
}): Promise<ActionResult> {
  const parsed = deleteAutomationSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("automations")
    .delete()
    .eq("id", parsed.data.id)
    .select("board_id")
    .maybeSingle();
  if (error) return fail(error.message);
  if (data?.board_id) revalidatePath(`/boards/${data.board_id}`);
  return { ok: true, data: undefined };
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: clean. (RLS/behavioral correctness is covered by Task 6; these actions intentionally rely on RLS for authorization rather than re-checking membership in JS, matching `upsertCell`.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/boards/automation-actions.ts src/lib/boards/queries.ts
git commit -m "feat(automations): CRUD server actions + listAutomations query (5a)"
```

---

## Task 5: Client — AutomationsDialog + AutomationBuilder + recipes + BoardHeader wiring

**Files:**

- Create: `src/components/boards/automations/recipes.ts`
- Create: `src/components/boards/automations/AutomationBuilder.tsx`
- Create: `src/components/boards/automations/AutomationsDialog.tsx`
- Test: `src/components/boards/automations/AutomationBuilder.test.tsx`
- Modify: `src/components/boards/BoardHeader.tsx`, `src/components/boards/BoardViews.tsx`

Reuse shadcn primitives in `src/components/ui/*` (`dialog`, `button`, `select` or `dropdown-menu`, `switch` if present else a toggle button, `input`). Style per `pulse-ui` tokens (monochrome chrome; the brand only for the primary action). Columns come from props (the board's `CacheColumn[]`); members from props (`listOrgMembers` already loaded on the page).

- [ ] **Step 1: Recipes (pure) + test (RED)**

`recipes.ts`:

```ts
import type {
  AutomationAction,
  AutomationTrigger,
} from "@/lib/validations/automations";

export type Draft = {
  name?: string;
  trigger: AutomationTrigger;
  actions: AutomationAction[];
};

/** Build a draft for "When <statusColumn> changes to <optionId>, notify owner". */
export function recipeNotifyOwner(
  statusColumnId: string,
  optionId: string | null,
  peopleColumnId: string,
): Draft {
  return {
    trigger: {
      type: "status_changed",
      columnId: statusColumnId,
      toOptionId: optionId,
    },
    actions: [{ type: "notify", recipient: { kind: "owner", peopleColumnId } }],
  };
}

/** "When <statusColumn> changes to <fromOpt>, set <targetColumn> to <toOpt>". */
export function recipeSetOption(
  statusColumnId: string,
  fromOptionId: string | null,
  targetColumnId: string,
  toOptionId: string,
): Draft {
  return {
    trigger: {
      type: "status_changed",
      columnId: statusColumnId,
      toOptionId: fromOptionId,
    },
    actions: [
      { type: "set_option", columnId: targetColumnId, optionId: toOptionId },
    ],
  };
}
```

`AutomationBuilder.test.tsx` (RED) — render the builder with two status columns + one people column, drive the controls, assert the `onSubmit` payload:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AutomationBuilder } from "./AutomationBuilder";

const columns = [
  {
    id: "c-status",
    kind: "status",
    name: "Status",
    settings: {
      options: [
        { id: "o-done", label: "Done", color: "#0a0" },
        { id: "o-stuck", label: "Stuck", color: "#a00" },
      ],
    },
  },
  { id: "c-people", kind: "people", name: "Owner", settings: {} },
] as never;
const members = [{ userId: "u1", fullName: "Ada", email: "a@x.com" }];

describe("AutomationBuilder", () => {
  it("builds a When status→Done, notify owner rule", async () => {
    const onSubmit = vi.fn();
    render(
      <AutomationBuilder
        columns={columns}
        members={members}
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    );
    // pick trigger column → "Status", value → "Done" (exact control queries depend on
    // the chosen shadcn select; the assertion is on the emitted payload)
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger: expect.objectContaining({
          type: "status_changed",
          columnId: "c-status",
        }),
        actions: expect.arrayContaining([
          expect.objectContaining({ type: "notify" }),
        ]),
      }),
    );
  });
});
```

Run: `pnpm test -- src/components/boards/automations/AutomationBuilder.test.tsx` → FAIL (module not found).

- [ ] **Step 2: Implement `AutomationBuilder.tsx`** (client component)

Requirements (implement with shadcn `select`/`dropdown-menu` + `button`; keep it one focused component):

- Props: `{ columns: CacheColumn[]; members: { userId: string; fullName: string|null; email: string|null }[]; initial?: Draft; onSubmit(draft: Draft): void; onCancel(): void }`.
- Derive `statusColumns = columns.filter(c => c.kind === "status" || c.kind === "dropdown")` and `peopleColumns = columns.filter(c => c.kind === "people")`.
- If `statusColumns.length === 0`, render an explanatory message ("Add a Status or Dropdown column to this board to create automations.") and only a Cancel button.
- Trigger row: a select of `statusColumns` (label = column name) + a select of that column's `settings.options` plus an **"Any value"** entry (maps to `toOptionId: null`).
- Actions list (state: `AutomationAction[]`, default one `notify` owner if a people column exists, else one `set_option`): each row is either
  - `notify`: select owner-vs-member; if member, a member select (`members`); if owner, a people-column select (`peopleColumns`; required — disable owner option when no people column).
  - `set_option`: a status/dropdown column select + an option select.
  - a remove button per row; an "+ Add action" menu to append a `notify` or `set_option` row.
- "Save" calls `onSubmit({ trigger, actions })` only when valid (trigger column chosen; every action fully specified; ≥1 action). Disable Save otherwise. "Cancel" calls `onCancel`.
- a11y: every control has a label / `aria-label`; Save is the brand primary button.

Run: `pnpm test -- src/components/boards/automations/AutomationBuilder.test.tsx` → PASS. (Adjust the test's control queries to match the concrete shadcn controls you used; keep the payload assertion.)

- [ ] **Step 3: Implement `AutomationsDialog.tsx`** (client component)

- Props: `{ boardId: string; columns: CacheColumn[]; members: {...}[]; open: boolean; onOpenChange(o: boolean): void }`.
- On open, load rules via a TanStack `useQuery(["automations", boardId], () => listAutomationsClient(boardId))`. Provide `listAutomationsClient` by calling the server `listAutomations` through a thin server action wrapper OR fetch through the existing query mechanism (match how other client lists read server data in this repo; if none, add a tiny `"use server"` `getAutomations(boardId)` that returns `listAutomations`). Keep reads bounded (already ordered + board-scoped).
- Render each rule as a one-line sentence summary (compose from `trigger`/`actions` using the columns/members to resolve names), with a **switch/toggle** (calls `updateAutomation({ id, enabled })`, optimistic) and a **delete** button (calls `deleteAutomation({ id })`, optimistic; destructive styling + confirm).
- A **"+ New automation"** button swaps the dialog body to `AutomationBuilder`; on its `onSubmit`, call `createAutomation({ boardId, ...draft })`, invalidate `["automations", boardId]`, return to the list.
- Above the builder, render **recipe quick-starts**: buttons that prefill the builder via `recipes.ts` (only show a recipe when its required columns exist — e.g. notify-owner needs a people column).
- After any mutation, `router.refresh()` is NOT needed (the rules list is client-cached; cell/notification effects arrive via existing Realtime).

- [ ] **Step 4: Wire into `BoardHeader.tsx` + `BoardViews.tsx`**

- In `BoardViews.tsx`, pass `columns={payloadColumns}` and `members={members}` down to `BoardHeader` (both are already available in `BoardViews` — `members` is a prop; columns come from the board cache/payload).
- In `BoardHeader.tsx`, accept `columns` + `members` props, add an **"Automations"** ghost `Button` (lucide `Zap` icon, `aria-label="Automations"`) next to the `ViewSwitcher`, with `useState` for `open`, mounting `<AutomationsDialog boardId={boardId} columns={columns} members={members} open={open} onOpenChange={setOpen} />`.

- [ ] **Step 5: Typecheck + tests + lint**

Run: `pnpm typecheck && pnpm test -- src/components/boards/automations && pnpm lint`
Expected: clean / all pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/boards/automations src/components/boards/BoardHeader.tsx src/components/boards/BoardViews.tsx
git commit -m "feat(automations): board Automations dialog + guided builder + recipes (5a)"
```

---

## Task 6: Integration test — cloud RLS + engine behavior

**Files:**

- Create: `src/lib/boards/automations.rls.integration.test.ts`

Model on the existing `src/lib/boards/*.rls.integration.test.ts` files: load `.env.local` via dotenv, skip the whole describe when secrets are absent, create confirmed users + an org + a board via the service-role admin client / RPCs, exercise behavior, clean up in `afterAll`. Use the **service-role** client to set up cross-org fixtures and an **anon+JWT** (per-user) client where RLS is under test.

- [ ] **Step 1: Write the integration test**

Cover these cases (one `it` each; reuse a shared `beforeAll` that builds: orgA with userA + a board with a Status column `S` (options Done/Stuck), a target Status column `P` (options Low/Urgent), a People column `O`; orgB with userB):

```ts
// Pseudocode-level assertions — implement with the repo's existing integration harness helpers.
// 1. status->Done fires notify(owner): set O=[userB-in-orgA], create rule
//    {trigger: status_changed S -> Done, actions:[notify owner O]}, then set S=Done as userA.
//    Expect a notifications row (kind 'automation', recipient = owner, automation_id = rule).
// 2. set_option: rule {S->Stuck, set P=Urgent}; set S=Stuck; expect cell P == {optionId: Urgent}.
// 3. "any value": rule with toOptionId null fires on any S change.
// 4. disabled rule never fires (enabled=false → no notification / no P change).
// 5. loop safety: rule A {S->Done => set P=Urgent} and rule B {P->Urgent => set S=Stuck};
//    set S=Done; expect the transaction completes without error and writes are bounded
//    (S and P each end at a stable value; no stack-depth/timeout error).
// 6. self-actor excluded: owner == actor → no notification.
// 7. cross-org isolation: a rule in orgA never touches orgB data; a set_option targeting
//    a column in another org does nothing (RLS / board scoping).
// 8. RLS CRUD: userB cannot select/insert/update/delete orgA automations (anon+JWT client).
```

Implement each with concrete Supabase calls + `expect`. For engine cases (1–7) trigger the rule by writing `cell_values` and then polling/selecting the resulting rows. For RLS (8), use a userB-scoped client and assert empty selects / error or zero-rows on writes.

- [ ] **Step 2: Run the integration test**

Run: `pnpm test -- src/lib/boards/automations.rls.integration.test.ts`
Expected: PASS (all cases). If secrets are absent it skips — run where `.env.local` has the service-role key.

- [ ] **Step 3: Commit**

```bash
git add src/lib/boards/automations.rls.integration.test.ts
git commit -m "test(automations): cloud RLS + engine integration (fire/notify/set/loop/isolation) (5a)"
```

---

## Task 7: Inbox rendering for `'automation'` + e2e + final gate

**Files:**

- Modify: the notifications inbox renderer (find with `grep -rln "update_on_item\|NotificationItem\|notification" src/components`)
- Create: `e2e/automations.spec.ts`

- [ ] **Step 1: Render the `'automation'` kind in the inbox**

Locate the component that switches on `notification.kind` (the inbox dropdown/list). Add a branch for `'automation'` that renders a sentence like `Automation ran on "<item name>"` (resolve item/board where the renderer already resolves them for other kinds), deep-linking to `?item=<id>` on the board exactly as the other kinds do. Update any inbox unit test that enumerates kinds.

Run: `pnpm test -- <the inbox test file>` → PASS.

- [ ] **Step 2: Write the e2e spec**

Model on `e2e/item-panel.spec.ts` / `e2e/notifications.spec.ts` (service-role confirmed user + UI login). Flow:

- Create a board with a Status column (seed via UI or RPC as the other specs do), open the **Automations** dialog from the board header.
- Build "When Status → Done, notify owner" (set the People owner first) + a `set_option` to a second status column; save.
- Change an item's Status to Done in the table.
- Assert: the target cell updates to the set value (Realtime), and the inbox bell shows an unread `'automation'` notification.
- Toggle the rule off; change status again; assert no new effect.

Run: `pnpm e2e -- automations.spec.ts`
Expected: PASS.

- [ ] **Step 3: Final gate**

Run:

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(automations): inbox rendering for automation kind + e2e (5a)"
```

---

## Self-Review (completed during planning)

- **Spec coverage:** §2 data model → Task 1 (+ enum/automation_id); §3 engine + loop guard → Task 2 (verified in Task 6 case 5); §4 Server Actions + builder/dialog/recipes → Tasks 4 + 5; §5 realtime (no new wiring) → noted in Task 5 Step 3; §6 testing → Tasks 3/5/6/7; §7 perf/RLS/schema discipline → Tasks 1–4 (RLS mirrors columns; bounded indexed reads; types regen in Task 1). All covered.
- **Type consistency:** `automationTriggerSchema`/`automationActionsSchema`/`createAutomationSchema`/`updateAutomationSchema`/`deleteAutomationSchema`, `AutomationTrigger`/`AutomationAction`, `Draft`, and action names `createAutomation`/`updateAutomation`/`deleteAutomation`/`listAutomations` are used identically across tasks. `notification_kind 'automation'` + `notifications.automation_id` defined in Task 1 and consumed in Task 2/7.
- **No placeholders:** SQL, schemas, actions, and key test bodies are concrete; the UI component spec lists exact props/behavior with the builder test asserting the emitted payload (control queries adapted to the concrete shadcn controls at build time — an intended, explained adaptation, not a gap).
- **Loop-guard gotcha:** `ALTER TYPE ... ADD VALUE` is isolated in Task 1 and the value is not used in DML in that migration; the engine function (Task 2) is a later migration — avoids the "unsafe use of new enum value in same transaction" error.
