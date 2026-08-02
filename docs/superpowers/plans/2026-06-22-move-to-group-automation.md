# Move-to-group automation action — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `move_to_group` automation action so a rule like "When status changes to Done, move the item to the Done group" works end to end.

**Architecture:** Extend the existing automation subsystem with one new action variant across three layers — the Zod validation union (`automations.ts`), the Postgres action runner (`_automation_run`, via a new migration), and the builder UI (`AutomationBuilder.tsx` + summary + recipe + group plumbing). Same-board, group-to-group only. No new tables/enums; `database.types.ts` is untouched.

**Tech Stack:** Next.js 16 (App Router, RSC), Supabase (Postgres triggers, RLS), Zod, React + React Query, Vitest. Spec: `docs/superpowers/specs/2026-06-22-status-change-move-to-group-automation-design.md`.

**Worktree gates caveat (from memory):** inside `.claude/worktrees/*` the CLI bins aren't on PATH (export the main checkout's `node_modules/.bin`), `next build` can't run here (build in the main checkout), and `*.integration.test.ts` SILENTLY SKIP without `.env.local` (already symlinked in this worktree). Run gates manually.

---

## Execution DAG

- **Task 1 — Validation + recipe** (`automations.ts`, `recipes.ts`). No deps.
- **Task 2 — Engine migration + integration tests** (`_automation_run`). No deps.
- **Task 3 — Builder UI + plumbing + summary** (`AutomationBuilder.tsx`, `AutomationsDialog.tsx`, `BoardHeader.tsx`, 4 view components). Depends on **Task 1** (uses the new `AutomationAction` variant).

**Batches:** Batch A = {Task 1, Task 2} (disjoint footprints — parallel). Batch B = {Task 3} (after Task 1).
**Critical path:** Task 1 → Task 3.

---

## Task 1: Validation schema + recipe

**Files:**

- Modify: `src/lib/validations/automations.ts`
- Test: `src/lib/validations/automations.test.ts`
- Modify: `src/components/boards/automations/recipes.ts`

- [ ] **Step 1: Write the failing validation test**

Add to `src/lib/validations/automations.test.ts` (use the existing `import` of `automationActionSchema` / `createAutomationSchema`; match the file's existing style):

```ts
describe("move_to_group action", () => {
  it("accepts a valid move_to_group action", () => {
    const result = automationActionSchema.safeParse({
      type: "move_to_group",
      groupId: "11111111-1111-1111-1111-111111111111",
    });
    expect(result.success).toBe(true);
  });

  it("rejects move_to_group without a groupId", () => {
    const result = automationActionSchema.safeParse({ type: "move_to_group" });
    expect(result.success).toBe(false);
  });

  it("rejects move_to_group with a non-uuid groupId", () => {
    const result = automationActionSchema.safeParse({
      type: "move_to_group",
      groupId: "not-a-uuid",
    });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/lib/validations/automations.test.ts`
Expected: the three new cases fail (the first because `move_to_group` is not a known discriminator yet, so `success` is `false`).

- [ ] **Step 3: Add the `move_to_group` variant to the action union**

In `src/lib/validations/automations.ts`, add a member to `automationActionSchema` (the `z.discriminatedUnion("type", [...])`), after the `set_option` entry:

```ts
  z.object({
    type: z.literal("move_to_group"),
    groupId: z.string().uuid(),
  }),
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/lib/validations/automations.test.ts`
Expected: PASS (all cases, including existing ones).

- [ ] **Step 5: Add the recipe**

Append to `src/components/boards/automations/recipes.ts`:

```ts
/**
 * "When status changes (to X), move the item to a group."
 * `optionId === null` means the trigger fires on any value change.
 */
export function recipeStatusChangedMoveToGroup(
  statusColumnId: string,
  optionId: string | null,
  groupId: string,
): Draft {
  return {
    trigger: {
      type: "status_changed",
      columnId: statusColumnId,
      toOptionId: optionId,
    },
    actions: [{ type: "move_to_group", groupId }],
  };
}
```

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm typecheck` (expect no errors). Then:

```bash
git add src/lib/validations/automations.ts src/lib/validations/automations.test.ts src/components/boards/automations/recipes.ts
git commit -m "feat(automations): add move_to_group action schema + recipe"
```

---

## Task 2: Engine — `_automation_run` branch + integration tests

**Files:**

- Create: `supabase/migrations/20260622120000_automation_move_to_group.sql`
- Test: `src/lib/boards/automations.movegroup.integration.test.ts`

The migration `CREATE OR REPLACE`s `public._automation_run` — copy the **current** body from `supabase/migrations/20260618160001_automations_5b1_engine.sql` (section 3) verbatim, then add one `elsif` branch and one `declare`d variable. Do not change the signature or the `security definer set search_path = ''` clause.

- [ ] **Step 1: Write the failing integration test**

Create `src/lib/boards/automations.movegroup.integration.test.ts`. Mirror the setup/teardown and helpers of `src/lib/boards/automations.engine.5b1.integration.test.ts` (same `config({ path: ".env.local" })`, `describe.skipIf(!SERVICE_ROLE_KEY)`, admin/anon clients, `poll`, `insertAutomation`, `setCell`, `createFreshItem`). Add a second group in `beforeAll` and a helper to read an item's `group_id`:

```ts
// in beforeAll, after groupAId is resolved — create a target group:
const { data: g2 } = await admin
  .from("groups")
  .insert({
    org_id: orgAId,
    board_id: boardAId,
    name: "Done group",
    position: 100,
  })
  .select("id")
  .single();
targetGroupId = (g2 as { id: string }).id;

// helper:
async function itemGroup(itemId: string): Promise<string | null> {
  const { data } = await admin
    .from("items")
    .select("group_id")
    .eq("id", itemId)
    .single();
  return (data as { group_id: string } | null)?.group_id ?? null;
}
```

Tests (each isolates state via `cleanItemState` / fresh items, like the 5b1 file):

```ts
it("status_changed → move_to_group moves the item to the target group", async () => {
  const item = await createFreshItem(); // lands in groupAId
  const autoId = await insertAutomation({
    trigger: {
      type: "status_changed",
      columnId: colSId,
      toOptionId: optDoneId,
    },
    actions: [{ type: "move_to_group", groupId: targetGroupId }],
  });
  await setCell(item, colSId, { optionId: optDoneId });
  const moved = await poll(async () =>
    (await itemGroup(item)) === targetGroupId ? true : null,
  );
  expect(moved).toBe(true);
  await admin.from("automations").delete().eq("id", autoId);
  await admin.from("items").delete().eq("id", item);
});

it("does not move when the trigger option does not match", async () => {
  const item = await createFreshItem();
  const autoId = await insertAutomation({
    trigger: {
      type: "status_changed",
      columnId: colSId,
      toOptionId: optDoneId,
    },
    actions: [{ type: "move_to_group", groupId: targetGroupId }],
  });
  await setCell(item, colSId, { optionId: optWorkingId }); // not Done
  await new Promise((r) => setTimeout(r, 800));
  expect(await itemGroup(item)).toBe(groupAId);
  await admin.from("automations").delete().eq("id", autoId);
  await admin.from("items").delete().eq("id", item);
});

it("is a no-op when the target group is on another board / does not exist", async () => {
  const item = await createFreshItem();
  const bogusGroup = randomUUID();
  const autoId = await insertAutomation({
    trigger: { type: "status_changed", columnId: colSId, toOptionId: null },
    actions: [{ type: "move_to_group", groupId: bogusGroup }],
  });
  await setCell(item, colSId, { optionId: optDoneId });
  await new Promise((r) => setTimeout(r, 800));
  expect(await itemGroup(item)).toBe(groupAId); // unchanged, no error
  await admin.from("automations").delete().eq("id", autoId);
  await admin.from("items").delete().eq("id", item);
});

it("respects the condition gate (no move when condition fails)", async () => {
  const item = await createFreshItem();
  const autoId = await insertAutomation({
    trigger: { type: "status_changed", columnId: colSId, toOptionId: null },
    actions: [{ type: "move_to_group", groupId: targetGroupId }],
    condition: {
      combinator: "and",
      conditions: [{ columnId: colPId, operator: "is", value: optHighId }],
    },
  });
  // P is unset → condition fails
  await setCell(item, colSId, { optionId: optDoneId });
  await new Promise((r) => setTimeout(r, 800));
  expect(await itemGroup(item)).toBe(groupAId);
  await admin.from("automations").delete().eq("id", autoId);
  await admin.from("items").delete().eq("id", item);
});
```

> Reuse the column/option fixture names from the 5b1 test (`colSId`, `colPId`, `optDoneId`, `optWorkingId`, `optHighId`). If the simplest path is to add these cases as a new `describe` block inside the existing `automations.engine.5b1.integration.test.ts` (which already builds all those fixtures), that is acceptable — prefer it if it avoids duplicating ~250 lines of setup. In that case skip creating the new file and add the block there instead.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/lib/boards/automations.movegroup.integration.test.ts` (or the 5b1 file if you co-located).
Expected: the move test FAILS (item stays in `groupAId` because the engine has no `move_to_group` branch yet). Confirm the suite is NOT skipped — if every test shows "skipped", `.env.local` / `SUPABASE_SERVICE_ROLE_KEY` is missing; fix before continuing.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260622120000_automation_move_to_group.sql`. Paste the current `_automation_run` definition from `20260618160001_automations_5b1_engine.sql` section 3, then: (a) add `v_group uuid;` to the `declare` block; (b) add the new branch inside the `for a in ... loop` after the `set_option` branch:

```sql
    elsif a->>'type' = 'move_to_group' then
      v_group := (a->>'groupId')::uuid;
      update public.items i
         set group_id = v_group,
             position = coalesce(
               (select max(i2.position) from public.items i2
                 where i2.group_id = v_group and i2.parent_id is null),
               0
             ) + 1
       where i.id = p_item_id
         and i.parent_id is null
         and i.group_id is distinct from v_group
         and exists (
           select 1 from public.groups g
            where g.id = v_group and g.board_id = p_board_id
         );
```

Header comment for the file:

```sql
-- Add the move_to_group action to the shared automation action runner.
-- Same-board, top-level items only; no-op on stale/cross-board group or self.
-- CREATE OR REPLACE only — no schema/type change.
```

- [ ] **Step 4: Apply the migration to the linked project**

Apply via the Supabase MCP `apply_migration` tool (name: `automation_move_to_group`) with the file's SQL, OR `supabase db push` if the CLI is configured. Confirm success (no error).

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm vitest run src/lib/boards/automations.movegroup.integration.test.ts`
Expected: PASS (move happens; non-match, bogus-group, and condition-gate cases stay in `groupAId`).

- [ ] **Step 6: Regression — existing engine tests still pass**

Run: `pnpm vitest run src/lib/boards/automations.engine.5b1.integration.test.ts`
Expected: PASS (the runner change is additive).

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260622120000_automation_move_to_group.sql src/lib/boards/automations.movegroup.integration.test.ts
git commit -m "feat(automations): engine move_to_group action + integration tests"
```

(If you co-located tests in the 5b1 file, stage that file instead of the new one.)

---

## Task 3: Builder UI + group plumbing + summary

**Depends on Task 1** (the `move_to_group` variant must exist on `AutomationAction`).

**Files:**

- Modify: `src/components/boards/automations/AutomationBuilder.tsx`
- Test: `src/components/boards/automations/AutomationBuilder.test.tsx`
- Modify: `src/components/boards/automations/AutomationsDialog.tsx`
- Test: `src/components/boards/automations/AutomationsDialog.test.tsx`
- Modify: `src/components/boards/BoardHeader.tsx`
- Modify: `src/components/boards/BoardTable.tsx`, `KanbanBoard.tsx`, `CalendarBoard.tsx`, `GanttBoard.tsx` (pass `groups` to `BoardHeader`)

### 3a. Builder accepts groups + renders the action

- [ ] **Step 1: Write the failing builder test**

In `src/components/boards/automations/AutomationBuilder.test.tsx`, add a test (follow the file's existing render helper — it passes `columns`, `members`, `onSubmit`, `onCancel`; add a `groups` prop):

```ts
it("adds a move_to_group action and submits it", async () => {
  const onSubmit = vi.fn();
  render(
    <AutomationBuilder
      columns={columns}
      members={[]}
      groups={[{ id: "g-done", name: "Done" }]}
      canWebhook={false}
      onSubmit={onSubmit}
      onCancel={() => {}}
    />,
  );
  // status trigger is the default when a status column exists
  await userEvent.click(screen.getByRole("button", { name: /move to group/i }));
  await userEvent.selectOptions(
    screen.getByLabelText(/target group/i),
    "g-done",
  );
  await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
  expect(onSubmit).toHaveBeenCalledWith(
    expect.objectContaining({
      actions: [{ type: "move_to_group", groupId: "g-done" }],
    }),
  );
});
```

> Check the existing tests in this file for the exact `columns` fixture shape and whether they use `userEvent` or `fireEvent`; match them. The `groups` prop type is `{ id: string; name: string }[]`.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/components/boards/automations/AutomationBuilder.test.tsx`
Expected: FAIL — `AutomationBuilder` has no `groups` prop / no "Move to group" button.

- [ ] **Step 3: Add the `groups` prop + types**

In `AutomationBuilder.tsx`:

1. Add a `BuilderGroup` type near `BuilderMember`:

```ts
export type BuilderGroup = { id: string; name: string };
```

2. Add `groups` to the component props (default `[]`):

```ts
  groups = [],
```

```ts
  groups?: BuilderGroup[];
```

- [ ] **Step 4: Add completeness + add-handler + render row**

In `AutomationBuilder.tsx`:

1. In `isActionComplete`, before the final `return`:

```ts
if (a.type === "move_to_group") {
  return !!a.groupId;
}
```

2. Add an add-handler near `addSetOption`:

```ts
function addMoveToGroup() {
  setActions((prev) => [
    ...prev,
    { _id: nextId(), type: "move_to_group", groupId: "" },
  ]);
}
```

3. In the action-row render switch (the `action.type === "notify" ? ... : ...` chain), add a branch for `move_to_group` that renders a new `MoveToGroupRow` with `groups`, `action`, and `onChange={(next) => updateAction(action._id, next)}`. (The existing fallthrough is `SetOptionRow`; add an explicit `action.type === "move_to_group"` branch before it.)

4. Add a "Move to group" button in the "Then" toolbar next to "Set a column":

```tsx
<Button type="button" variant="outline" size="sm" onClick={addMoveToGroup}>
  <Plus className="size-3.5" /> Move to group
</Button>
```

5. Add the `MoveToGroupRow` component (mirror `SetOptionRow`):

```tsx
function MoveToGroupRow({
  action,
  groups,
  onChange,
}: {
  action: Extract<AutomationAction, { type: "move_to_group" }>;
  groups: BuilderGroup[];
  onChange: (next: AutomationAction) => void;
}) {
  return (
    <label className="col-span-2 text-sm">
      <span className="text-muted-foreground">Move to group</span>
      <select
        aria-label="Target group"
        className={selectClass}
        value={action.groupId}
        onChange={(e) =>
          onChange({ type: "move_to_group", groupId: e.target.value })
        }
      >
        <option value="">Select…</option>
        {groups.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
      </select>
    </label>
  );
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm vitest run src/components/boards/automations/AutomationBuilder.test.tsx`
Expected: PASS.

### 3b. Dialog threads groups + summarizes the action

- [ ] **Step 6: Write the failing summary test**

In `src/components/boards/automations/AutomationsDialog.test.tsx`, add a test asserting a rule with a `move_to_group` action renders a human summary containing the group name (follow how existing summary tests seed `rules` and assert text). The dialog will need a `groups` prop of `{ id; name }[]`; pass `groups={[{ id: "g-done", name: "Done" }]}` and a rule whose action is `{ type: "move_to_group", groupId: "g-done" }`. Assert the rendered text matches `/move to Done/i`.

- [ ] **Step 7: Run to verify it fails**

Run: `pnpm vitest run src/components/boards/automations/AutomationsDialog.test.tsx`
Expected: FAIL — no `groups` prop / summary lacks the move clause.

- [ ] **Step 8: Add `groups` prop + group-name resolver + summary clause**

In `AutomationsDialog.tsx`:

1. Add `groups: BuilderGroup[]` to the dialog props (import `BuilderGroup` from `AutomationBuilder`), and pass `groups={groups}` down to `<AutomationBuilder .../>`.

2. Add a resolver near `colName`:

```ts
function groupName(groups: BuilderGroup[], id: string): string {
  return groups.find((g) => g.id === id)?.name ?? "a group";
}
```

3. Thread `groups` into `summarize(rule, columns, members, groups)` and add a clause in the `thens` map:

```ts
if (a.type === "move_to_group") {
  return `move to ${groupName(groups, a.groupId)}`;
}
```

(Update the `summarize` call site to pass `groups`.)

- [ ] **Step 9: Run to verify it passes**

Run: `pnpm vitest run src/components/boards/automations/AutomationsDialog.test.tsx`
Expected: PASS.

### 3c. Thread groups from the board views

- [ ] **Step 10: Add `groups` to BoardHeader and pass to the dialog**

In `src/components/boards/BoardHeader.tsx`:

1. Import `BuilderGroup` from `AutomationsDialog`/`AutomationBuilder` (whichever exports it) — or accept `groups?: { id: string; name: string }[]`.
2. Add `groups = []` to props and its type.
3. Pass `groups={groups}` to `<AutomationsDialog ... />`.

- [ ] **Step 11: Pass `groups` from each view component**

In each of `BoardTable.tsx`, `KanbanBoard.tsx`, `CalendarBoard.tsx`, `GanttBoard.tsx`, at every `<BoardHeader ...>` render site, add `groups={cache.groups.map((g) => ({ id: g.id, name: g.name }))}` (these files already have `cache`/`groups` in scope). Map to `{ id, name }` to keep the header prop slim.

> Each view renders `BoardHeader` twice (loading + loaded). Add the prop to BOTH. For the loading-skeleton render where `cache` may be absent, pass `groups={[]}`.

- [ ] **Step 12: Typecheck + full unit test run**

Run: `pnpm typecheck`
Expected: no errors.
Run: `pnpm vitest run src/components/boards/automations`
Expected: PASS.

- [ ] **Step 13: Commit**

```bash
git add src/components/boards/automations/AutomationBuilder.tsx src/components/boards/automations/AutomationBuilder.test.tsx src/components/boards/automations/AutomationsDialog.tsx src/components/boards/automations/AutomationsDialog.test.tsx src/components/boards/BoardHeader.tsx src/components/boards/BoardTable.tsx src/components/boards/KanbanBoard.tsx src/components/boards/CalendarBoard.tsx src/components/boards/GanttBoard.tsx
git commit -m "feat(automations): move_to_group builder UI, summary, and group plumbing"
```

---

## Final verification (after all tasks)

- [ ] `pnpm typecheck` — no errors.
- [ ] `pnpm lint` — clean.
- [ ] `pnpm test` — full unit + integration suite green (integration needs the symlinked `.env.local`; confirm the new engine tests RAN, not skipped).
- [ ] `pnpm build` — run in the **main checkout** (not the worktree) for a clean compile graph, per the worktree caveat.
- [ ] Merge via `scripts/finish-task.sh` from inside the worktree.
- [ ] Hand the user the manual test walkthrough from the spec ("Manual test walkthrough").

## Self-review notes

- **Spec coverage:** validation (Task 1), recipe (Task 1), engine branch + guards (Task 2), all edge cases as tests (Task 2: non-match, bogus/cross-board group, condition gate; subitem/no-op guards are enforced by the SQL `where` clause — covered by the bogus-group test exercising the `exists` guard and could add an explicit subitem case if desired), builder UI + summary + plumbing (Task 3). Realtime/cascade need no code (spec §"Why this is safe").
- **No type drift:** `move_to_group` / `groupId` used identically across schema, engine JSON keys (`a->>'groupId'`), recipe, and UI. `BuilderGroup = { id; name }` is the single shared UI shape.
- **Placeholders:** none — every code step shows the code; the two "match the existing fixture" notes point at concrete files to copy style from, not deferred work.
