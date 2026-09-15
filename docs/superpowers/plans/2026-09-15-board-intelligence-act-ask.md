# Board Intelligence — Act and Ask Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Phase 3 (Act — turn a suggestion into a board automation) and Phase 4 (Ask — streaming Q&A grounded in the cached Intelligence run) of Board Intelligence.

**Architecture:** Phase 3 adds one new automation action, `assign_person`, to the existing engine (Zod union → plpgsql executor → editor row), plus a pure mapper that turns an Intelligence `Action` into the engine's not-yet-persisted `Draft`, handed to the already-shipped automation editor through a third nonce-stamped command on the existing dock↔header store. Phase 4 adds a streaming NDJSON route that runs the proven Ask tool loop with a read-only toolset over the cached run, a composer in the Intelligence tab holding at most five Q/A pairs in component state, and a server action that promotes one pair into a real board thread.

**Tech Stack:** Next.js 16 (App Router, RSC, Server Actions), TypeScript strict, Zod, Supabase (Postgres + RLS, `supabase-dev` MCP for migrations), Vitest + React Testing Library, Zustand, Tailwind v4 + shadcn, Anthropic SDK (tool loop, NDJSON streaming).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-13-board-intelligence-act-ask-design.md` (parent: `2026-09-11-board-intelligence-design.md`). Every ruling there applies; this plan adds no requirement of its own.
- Server Components by default; **Server Actions for all mutations**; Next.js 16 APIs confirmed against `node_modules/next/dist/docs/`.
- Validate at boundaries with Zod. TypeScript strict; no `any`.
- RLS is the security boundary: default-deny, org-scoped. `SUPABASE_SERVICE_ROLE_KEY` never reaches the browser. The `_automation_run` executor is `security definer` and bypasses RLS — every id it takes from client-authored jsonb must be re-confined in SQL.
- Server actions return `ActionResult` / `fail` from `src/lib/actions/result.ts`. Never re-declare those shapes.
- Migrations are minted **only** via `scripts/new-migration.sh <slug>`, applied to DEV through the `supabase-dev` MCP with the **same version + name**, then verified with `pnpm db:ledger-check`. Types regenerated and committed in the same change. In a worktree `pnpm db:types` fails (`LegacyProjectNotLinkedError`) — regenerate via the MCP's `generate_typescript_types` and run prettier.
- **DEV holds real, live, user-facing data.** No destructive experiments.
- User-facing label is **"Intelligence"**. The word "Pulse" never appears in UI copy.
- UI work loads the `pulse-ui` and `frontend-design` skills first.
- All four gates pass before any merge: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
- Commit identity: `Danijel Jovanovic <info@synapse-solutions.ai>`. Stage explicitly by path — never `git add -A`.
- **Implementers do not run `finish-task.sh`, do not merge, do not push.** The orchestrator integrates.

## Two corrections to the spec, carried into these tasks

1. The action dispatch chain is in **`public._automation_run`**, not `tg_run_automations` (that trigger only calls it). Task 2 redefines `_automation_run`.
2. `useAskStream` cannot be reused as-is: it hardcodes `POST /api/ask` with a `{ conversationId }` body, and the protocol's `done` event requires a `conversationId` + `assistantMessageId` that an unpersisted Q/A has none of. What _is_ reused is `readAskStream` (generalized over its event type in Task 7) and the NDJSON line format. Phase 4 gets its own two-event protocol module and its own hook.

## File Structure

**Phase 3**

| File                                                                     | Responsibility                                                                              |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `src/lib/validations/automations.ts` (modify)                            | `assign_person` member of `automationActionSchema`; excluded from `AI_STEP_ALLOWED_ACTIONS` |
| `supabase/migrations/<new>_automation_assign_person_action.sql` (create) | `_automation_run` redefinition with the `assign_person` branch and its SQL guards           |
| `src/types/database.types.ts` (regenerate)                               | Generated types after the migration                                                         |
| `src/components/boards/automations/ActionRows.tsx` (modify)              | `AssignPersonRow` editor row                                                                |
| `src/components/boards/automations/AutomationBuilder.tsx` (modify)       | `addAssignPerson`, row dispatch, "Assign a person" button                                   |
| `src/components/boards/automations/builder-utils.ts` (modify)            | `isActionComplete` arm                                                                      |
| `src/components/boards/automations/AutomationsDialog.tsx` (modify)       | rule-list sentence; `seedDraft` prop                                                        |
| `src/components/boards/automations/recipes.ts` (modify)                  | `recipeItemCreatedAssignPerson`                                                             |
| `src/lib/ai/board-intelligence/rule-draft.ts` (create)                   | `ruleDraftFor(action, meta): Draft \| null` — pure mapper                                   |
| `src/stores/board-intelligence.ts` (modify)                              | `ruleRequest` / `requestRule` / `consumeRule`                                               |
| `src/components/boards/BoardHeader.tsx` (modify)                         | consume `ruleRequest`, open the dialog seeded                                               |
| `src/components/boards/dock/intelligence/SuggestionCard.tsx` (modify)    | "Always do this" button                                                                     |
| `src/components/boards/dock/intelligence/IntelligenceTab.tsx` (modify)   | build the draft, issue `requestRule`                                                        |
| `src/app/(app)/boards/[boardId]/page.tsx` (modify)                       | supply `ruleMeta` (column kinds + member ids) to the dock — no new query                    |

**Phase 4**

| File                                                                       | Responsibility                                              |
| -------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `src/lib/ai/board-intelligence/ask-protocol.ts` (create)                   | client-safe `IntelAskEvent` union + `encodeIntelEvent`      |
| `src/components/ai/ask/use-ask-stream.ts` (modify)                         | generalize `readAskStream` over its event type              |
| `src/lib/ai/ask/ask-stream.ts` (modify)                                    | optional `toolset: "read-only"` — two read tools, no writer |
| `src/app/api/board-intelligence/ask/route.ts` (create)                     | auth, entitlement, run read, context, stream                |
| `src/lib/ai/board-intelligence/ask-context.ts` (create)                    | system prompt + question framing from the cached run        |
| `src/lib/ai/board-intelligence/ask-input.ts` (create)                      | Zod request schema; truncating history cap                  |
| `src/components/boards/dock/intelligence/use-intelligence-ask.ts` (create) | hook: POST, stream, ≤5 pairs                                |
| `src/components/boards/dock/intelligence/AskComposer.tsx` (create)         | composer + Q/A pair list                                    |
| `src/lib/ai/board-intelligence/qa-thread.ts` (create)                      | `openQaInChat` server action                                |
| `src/components/boards/dock/{DockBody,BoardDock}.tsx` (modify)             | thread `onOpenInChat` handoff                               |

---

### Task 1: `assign_person` in the action union

**Files:**

- Modify: `src/lib/validations/automations.ts:49` (the `automationActionSchema` union)
- Test: `src/lib/validations/automations.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `assign_person` as a member of `automationActionSchema`, shape `{ type: "assign_person"; columnId: string /* uuid */; userId: string /* uuid */ }`, reachable as `Extract<AutomationAction, { type: "assign_person" }>`.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/validations/automations.test.ts`:

```ts
describe("assign_person action", () => {
  const valid = {
    type: "assign_person" as const,
    columnId: "11111111-1111-4111-8111-111111111111",
    userId: "22222222-2222-4222-8222-222222222222",
  };

  it("accepts a people column id and a member id", () => {
    expect(automationActionSchema.parse(valid)).toEqual(valid);
  });

  it("rejects a non-uuid columnId", () => {
    expect(() =>
      automationActionSchema.parse({ ...valid, columnId: "not-a-uuid" }),
    ).toThrow();
  });

  it("rejects a missing userId", () => {
    const { userId: _drop, ...rest } = valid;
    expect(() => automationActionSchema.parse(rest)).toThrow();
  });

  // An ai_step picks its action at fire time from board text the org does not
  // control. Assigning work to a named person is reversible in data and not in
  // perception, so it is deliberately OUTSIDE that vocabulary (spec §2.1).
  it("is NOT in the vocabulary an ai_step may choose from", () => {
    expect(AI_STEP_ALLOWED_ACTIONS).not.toContain("assign_person");
  });

  // The agent-filed-rule vocabulary is DERIVED from the union minus
  // AGENT_FORBIDDEN, so inclusion here is automatic — this asserts the
  // derivation actually carried it, by name.
  it("IS in the vocabulary an agent may file a whole rule with", () => {
    const types = agentAutomationActionSchema.options.map(
      (o) => o.shape.type.value,
    );
    expect(types).toContain("assign_person");
    expect(types).not.toContain("call_webhook");
  });
});
```

Add `AI_STEP_ALLOWED_ACTIONS` and `agentAutomationActionSchema` to the file's existing import from `@/lib/validations/automations` (check the exported name of the derived agent union at the bottom of that module and use it verbatim — if it is not exported, export it in Step 3).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/lib/validations/automations.test.ts`
Expected: FAIL — the `assign_person` parses throw ("Invalid discriminator value"), and the derived-union assertion reports the type missing.

- [ ] **Step 3: Add the union member**

In `src/lib/validations/automations.ts`, inside `automationActionSchema`, after the `set_percent` member:

```ts
  /**
   * Replace the people cell with exactly this member (spec §2.1).
   *
   * REPLACE, not append: Intelligence's own `reassign` writes
   * `next: [toUserId]` (`src/lib/ai/board-intelligence/apply.ts`) and diffs
   * against the prior `userIds` to notify. Two paths that write one column must
   * agree on what writing it means.
   *
   * Absent from `AI_STEP_ALLOWED_ACTIONS` on purpose — see that list.
   */
  z.object({
    type: z.literal("assign_person"),
    columnId: z.string().uuid(),
    userId: z.string().uuid(),
  }),
```

Extend the `AI_STEP_ALLOWED_ACTIONS` doc comment with one sentence: it excludes `assign_person` because the effect is outward-facing at a named person, not because it is irreversible.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/lib/validations/automations.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck — the union is exhaustively switched in several places**

Run: `pnpm typecheck`
Expected: errors listing every exhaustive `switch`/`if` chain over `AutomationAction` that does not yet handle `assign_person`. **Do not fix them here** — Task 3 owns the editor and summary arms. Record the file:line list in the commit body so Task 3 has the complete set.

- [ ] **Step 6: Commit**

```bash
git add src/lib/validations/automations.ts src/lib/validations/automations.test.ts
git commit -m "feat(automations): add the assign_person action shape"
```

---

### Task 2: `assign_person` executor migration

**Files:**

- Create: `supabase/migrations/<minted>_automation_assign_person_action.sql`
- Modify: `src/types/database.types.ts` (regenerated)
- Test: `src/lib/boards/automations-assign-person.integration.test.ts`

**Interfaces:**

- Consumes: Task 1's action shape (`{ type, columnId, userId }`) — the jsonb keys the SQL reads.
- Produces: an `_automation_run` that executes `assign_person`, recording outcome `set` / `skipped_equal` / `skipped_bad_target` / `skipped_not_member` in `automation_runs.actions`.

- [ ] **Step 1: Mint the migration file**

```bash
scripts/new-migration.sh automation_assign_person_action
```

Expected: prints a path like `supabase/migrations/20260915HHMMSS_automation_assign_person_action.sql`. Never hand-write a version stamp.

- [ ] **Step 2: Write the migration**

Copy the **entire** `create or replace function public._automation_run(...)` body from `supabase/migrations/20260704111500_automation_run_recipient_and_target_guards.sql` — the latest of seven definitions — into the new file, add only the branch below, and keep the trailing `revoke execute` statement. Copying from an earlier definition silently reverts six later fixes.

Insert after the `set_percent` branch, before `move_to_group`:

```sql
      elsif a->>'type' = 'assign_person' then
        v_target := (a->>'columnId')::uuid;
        v_rid := (a->>'userId')::uuid;
        -- Confine the target column to this board AND to kind 'people': the
        -- column id arrives in client-authored actions jsonb and this function
        -- is security definer, so RLS is not standing behind it (same class of
        -- guard as findings #4b/#4c).
        select kind into v_kind from public.columns
          where id = v_target and board_id = p_board_id;
        if v_kind is distinct from 'people' then
          v_outcome := 'skipped_bad_target';
        -- Never write a uuid from outside this org into a people cell: the
        -- board would show a member nobody can resolve, and every downstream
        -- notify would target a non-member (finding #4a's reasoning).
        elsif v_rid is null or not public.is_member_of(v_rid, p_org_id) then
          v_outcome := 'skipped_not_member';
        else
          v_newval := jsonb_build_object('userIds', jsonb_build_array(v_rid));
          if exists (
            select 1 from public.cell_values cv
            where cv.item_id = p_item_id
              and cv.column_id = v_target
              and cv.value = v_newval
          ) then
            v_outcome := 'skipped_equal';
          else
            insert into public.cell_values (org_id, board_id, item_id, column_id, value)
            values (p_org_id, p_board_id, p_item_id, v_target, v_newval)
            on conflict (item_id, column_id) do update set value = excluded.value;
            v_outcome := 'set';
          end if;
        end if;
        v_outcomes := v_outcomes || jsonb_build_object('type','assign_person','outcome',v_outcome);
```

Head the file with a comment saying which definition the body was copied from and that only this branch was added. `{ userIds: [uuid] }` is the shape `peopleValueSchema` (`src/lib/validations/boards.ts:160`) and the `notify` owner lookup (`cv.value->'userIds'->>0`) both already use.

- [ ] **Step 3: Write the failing integration test**

Create `src/lib/boards/automations-assign-person.integration.test.ts`, following the skip-unless-`PULSE_TEST_DB` pattern of the suites beside it (copy the guard and fixture helpers from `src/lib/ai/board-intelligence/board-intelligence-runs.rls.integration.test.ts`). Cover exactly the four outcomes:

```ts
it("replaces the people cell with the named member", async () => {
  await fireAssignPerson({ columnId: peopleCol, userId: memberB });
  const cell = await readCell(itemId, peopleCol);
  expect(cell).toEqual({ userIds: [memberB] });
});

it("records skipped_bad_target for a column on another board", async () => {
  const run = await fireAssignPerson({
    columnId: otherBoardPeopleCol,
    userId: memberB,
  });
  expect(run.actions).toEqual([
    { type: "assign_person", outcome: "skipped_bad_target" },
  ]);
});

it("records skipped_bad_target for a non-people column on this board", async () => {
  const run = await fireAssignPerson({ columnId: statusCol, userId: memberB });
  expect(run.actions).toEqual([
    { type: "assign_person", outcome: "skipped_bad_target" },
  ]);
});

it("records skipped_not_member for a uuid outside the org", async () => {
  const run = await fireAssignPerson({
    columnId: peopleCol,
    userId: outsiderId,
  });
  expect(run.actions).toEqual([
    { type: "assign_person", outcome: "skipped_not_member" },
  ]);
  expect(await readCell(itemId, peopleCol)).toBeNull();
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `PULSE_TEST_DB=1 pnpm vitest run src/lib/boards/automations-assign-person.integration.test.ts`
Expected: FAIL — the branch does not exist yet, so the engine records no `assign_person` outcome and the cell stays null.

- [ ] **Step 5: Apply the migration to DEV**

Through the `supabase-dev` MCP `apply_migration`, passing the **same version and name** as the minted filename. Then:

```bash
pnpm db:ledger-check
```

Expected: no diff either way. `apply_migration` has mis-stamped the version every time so far — if the ledger row's version drifted while the file exists, repair it with `scripts/reconcile-migration-version.sh` and re-run `pnpm db:ledger-check` until clean.

- [ ] **Step 6: Run the test to verify it passes**

Run: `PULSE_TEST_DB=1 pnpm vitest run src/lib/boards/automations-assign-person.integration.test.ts`
Expected: PASS — all four outcomes.

- [ ] **Step 7: Regenerate types**

Use the `supabase-dev` MCP `generate_typescript_types`, write the result to `src/types/database.types.ts`, then `pnpm prettier --write src/types/database.types.ts`. (`pnpm db:types` throws `LegacyProjectNotLinkedError` inside a worktree.) The function signature is unchanged, so expect a no-op or whitespace-only diff — commit whatever it produces so the file is never stale.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations src/types/database.types.ts src/lib/boards/automations-assign-person.integration.test.ts
git commit -m "feat(automations): execute assign_person in the engine"
```

---

### Task 3: editor row, recipe and rule sentence

**Files:**

- Modify: `src/components/boards/automations/ActionRows.tsx` (new `AssignPersonRow`)
- Modify: `src/components/boards/automations/AutomationBuilder.tsx:184-235` (add helper), `:518-556` (row dispatch), `:569-610` (button row)
- Modify: `src/components/boards/automations/builder-utils.ts:47`
- Modify: `src/components/boards/automations/AutomationsDialog.tsx:148-171`
- Modify: `src/components/boards/automations/recipes.ts`
- Test: `src/components/boards/automations/AutomationBuilder.test.tsx`, `src/components/boards/automations/recipes.test.ts`

**Interfaces:**

- Consumes: Task 1's `Extract<AutomationAction, { type: "assign_person" }>`.
- Produces: `recipeItemCreatedAssignPerson(peopleColumnId: string, userId: string): Draft` exported from `recipes.ts`.

- [ ] **Step 1: Write the failing tests**

In `src/components/boards/automations/recipes.test.ts`:

```ts
it("builds an item_created → assign_person draft", () => {
  expect(recipeItemCreatedAssignPerson("col-1", "user-1")).toEqual({
    trigger: { type: "item_created" },
    actions: [{ type: "assign_person", columnId: "col-1", userId: "user-1" }],
  });
});
```

In `src/components/boards/automations/AutomationBuilder.test.tsx` (follow the existing render helper in that file for `columns`/`members`/`groups`):

```ts
it("adds an assign_person action and requires both fields", async () => {
  const onSubmit = vi.fn();
  render(<AutomationBuilder {...baseProps} onSubmit={onSubmit} />);
  await userEvent.click(screen.getByRole("button", { name: /assign a person/i }));

  expect(screen.getByLabelText("Assign in column")).toBeInTheDocument();
  // Incomplete: no person picked yet, so Save stays shut.
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

  await userEvent.selectOptions(screen.getByLabelText("Assign in column"), "people-1");
  await userEvent.selectOptions(screen.getByLabelText("Assign to"), "user-1");
  expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
});

it("does not offer assign a person on a board with no people column", () => {
  render(<AutomationBuilder {...baseProps} columns={columnsWithoutPeople} />);
  expect(
    screen.queryByRole("button", { name: /assign a person/i }),
  ).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/components/boards/automations/recipes.test.ts src/components/boards/automations/AutomationBuilder.test.tsx`
Expected: FAIL — `recipeItemCreatedAssignPerson` is not exported; the "Assign a person" button is not found.

- [ ] **Step 3: Add the row**

In `ActionRows.tsx`, after `NotifyRow`:

```tsx
export function AssignPersonRow({
  action,
  peopleColumns,
  members,
  onChange,
}: {
  action: Extract<AutomationAction, { type: "assign_person" }>;
  peopleColumns: CacheColumn[];
  members: BuilderMember[];
  onChange: (next: AutomationAction) => void;
}) {
  return (
    <>
      <label className="text-sm">
        <span className="text-muted-foreground">Assign in column</span>
        <select
          aria-label="Assign in column"
          className={selectClass}
          value={action.columnId}
          onChange={(e) => onChange({ ...action, columnId: e.target.value })}
        >
          <option value="">Select…</option>
          {peopleColumns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        <span className="text-muted-foreground">Assign to</span>
        <select
          aria-label="Assign to"
          className={selectClass}
          value={action.userId}
          onChange={(e) => onChange({ ...action, userId: e.target.value })}
        >
          <option value="">Select…</option>
          {members.map((m) => (
            <option key={m.userId} value={m.userId}>
              {memberLabel(m)}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}
```

- [ ] **Step 4: Wire the builder**

In `AutomationBuilder.tsx`: import `AssignPersonRow`; add the helper beside `addNotify`:

```ts
function addAssignPerson() {
  setActions((prev) => [
    ...prev,
    {
      _id: nextId(),
      type: "assign_person",
      columnId: peopleColumns[0]?.id ?? "",
      userId: "",
    },
  ]);
}
```

Add the dispatch arm in the action list, after the `notify` arm:

```tsx
                ) : action.type === "assign_person" ? (
                  <AssignPersonRow
                    action={action}
                    peopleColumns={peopleColumns}
                    members={members}
                    onChange={(next) => updateAction(action._id, next)}
                  />
```

Add the button, gated exactly the way "Set percent" is gated on `percentColumns.length` — an assign action is unfillable without a people column:

```tsx
{
  peopleColumns.length > 0 ? (
    <Button type="button" variant="outline" size="sm" onClick={addAssignPerson}>
      <Plus className="size-3.5" /> Assign a person
    </Button>
  ) : null;
}
```

In `builder-utils.ts`, inside `isActionComplete`, before the final `return false`:

```ts
if (a.type === "assign_person") {
  return !!a.columnId && !!a.userId;
}
```

In `AutomationsDialog.tsx`, inside the `thens` map, before the final `return "do nothing"`:

```ts
if (a.type === "assign_person") {
  return `assign ${memberName(members, a.userId)} in ${colName(
    columns,
    a.columnId,
  )}`;
}
```

In `recipes.ts`:

```ts
/**
 * "When an item is created, assign it to N (in a people column)."
 *
 * The standing form of an Intelligence `reassign` suggestion: the card exists
 * because work is unowned or piled on one person, and the durable fix is that
 * NEW work lands on a named owner (spec §2.2).
 */
export function recipeItemCreatedAssignPerson(
  peopleColumnId: string,
  userId: string,
): Draft {
  return {
    trigger: { type: "item_created" },
    actions: [{ type: "assign_person", columnId: peopleColumnId, userId }],
  };
}
```

- [ ] **Step 5: Run the tests and the typecheck**

Run: `pnpm vitest run src/components/boards/automations/ src/lib/validations/automations.test.ts && pnpm typecheck`
Expected: PASS, and `pnpm typecheck` clean — the exhaustiveness errors Task 1 recorded are all now handled. If any remain, fix those arms here; that list is this task's definition of done.

- [ ] **Step 6: Commit**

```bash
git add src/components/boards/automations src/lib/validations/automations.ts
git commit -m "feat(automations): edit and describe assign_person rules"
```

---

### Task 4: `ruleDraftFor` — suggestion action → automation draft

**Files:**

- Create: `src/lib/ai/board-intelligence/rule-draft.ts`
- Test: `src/lib/ai/board-intelligence/rule-draft.test.ts`

**Interfaces:**

- Consumes: `Action` from `@/lib/ai/board-intelligence/runs`, `Draft` from `@/components/boards/automations/recipes`.
- Produces:
  - `export type RuleBoardMeta = { columns: readonly { id: string; kind: string }[]; memberIds: readonly string[] }`
  - `export function ruleDraftFor(action: Action, meta: RuleBoardMeta): Draft | null`

`RuleBoardMeta`, not `BoardContext`: the dock is a **sibling** of the board provider and holds no payload, and `buildBoardContext` needs the whole payload. Column kinds and member ids are all three mappings check, they are already on the board page, and passing that much keeps the interaction at zero server round-trips (spec §4).

- [ ] **Step 1: Write the failing tests**

Create `src/lib/ai/board-intelligence/rule-draft.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ruleDraftFor, type RuleBoardMeta } from "./rule-draft";

const DATE = "aaaaaaaa-0000-4000-8000-000000000001";
const PEOPLE = "aaaaaaaa-0000-4000-8000-000000000002";
const STATUS = "aaaaaaaa-0000-4000-8000-000000000003";
const USER = "bbbbbbbb-0000-4000-8000-000000000001";

function meta(kinds: Record<string, string>): RuleBoardMeta {
  return {
    columns: Object.entries(kinds).map(([id, kind]) => ({ id, kind })),
    memberIds: [USER],
  };
}

describe("ruleDraftFor", () => {
  it("maps reassign onto item_created + assign_person", () => {
    const draft = ruleDraftFor(
      {
        type: "reassign",
        itemIds: ["i1"],
        columnId: PEOPLE,
        toUserId: USER,
        label: "Reassign",
      },
      meta({ [PEOPLE]: "people" }),
    );
    expect(draft).toEqual({
      trigger: { type: "item_created" },
      actions: [{ type: "assign_person", columnId: PEOPLE, userId: USER }],
    });
  });

  it("maps set_status onto date_reached + set_option", () => {
    const draft = ruleDraftFor(
      {
        type: "set_status",
        itemId: "i1",
        columnId: STATUS,
        optionId: "o1",
        label: "Set status",
      },
      meta({ [DATE]: "date", [STATUS]: "status" }),
    );
    expect(draft).toEqual({
      trigger: { type: "date_reached", columnId: DATE, offsetDays: 0 },
      actions: [{ type: "set_option", columnId: STATUS, optionId: "o1" }],
    });
  });

  it("maps nudge onto date_reached + notify the owner", () => {
    const draft = ruleDraftFor(
      {
        type: "nudge",
        itemId: "i1",
        userId: USER,
        message: "ping",
        label: "Nudge",
      },
      meta({ [DATE]: "date", [PEOPLE]: "people" }),
    );
    // The engine's notify carries a recipient and NO message, so the card's
    // message text cannot survive into a rule (spec §2.2).
    expect(draft).toEqual({
      trigger: { type: "date_reached", columnId: DATE, offsetDays: 0 },
      actions: [
        {
          type: "notify",
          recipient: { kind: "owner", peopleColumnId: PEOPLE },
        },
      ],
    });
  });

  it("returns null for nudge with no people column", () => {
    expect(
      ruleDraftFor(
        {
          type: "nudge",
          itemId: "i1",
          userId: USER,
          message: "ping",
          label: "Nudge",
        },
        meta({ [DATE]: "date" }),
      ),
    ).toBeNull();
  });

  it("returns null for set_status with no date column", () => {
    expect(
      ruleDraftFor(
        {
          type: "set_status",
          itemId: "i1",
          columnId: STATUS,
          optionId: "o1",
          label: "Set status",
        },
        meta({ [STATUS]: "status" }),
      ),
    ).toBeNull();
  });

  it("returns null when reassign names a column that is not a people column here", () => {
    expect(
      ruleDraftFor(
        {
          type: "reassign",
          itemIds: ["i1"],
          columnId: STATUS,
          toUserId: USER,
          label: "Reassign",
        },
        meta({ [STATUS]: "status" }),
      ),
    ).toBeNull();
  });

  it("returns null when reassign names someone who is not a member", () => {
    expect(
      ruleDraftFor(
        {
          type: "reassign",
          itemIds: ["i1"],
          columnId: PEOPLE,
          toUserId: "cccccccc-0000-4000-8000-000000000009",
          label: "Reassign",
        },
        meta({ [PEOPLE]: "people" }),
      ),
    ).toBeNull();
  });

  it("returns null for set_due and filter — neither maps onto a primitive", () => {
    expect(
      ruleDraftFor(
        {
          type: "set_due",
          itemId: "i1",
          columnId: DATE,
          date: "2026-09-20",
          label: "Set due",
        },
        meta({ [DATE]: "date" }),
      ),
    ).toBeNull();
    expect(
      ruleDraftFor(
        { type: "filter", signalKind: "overdue", label: "Show" },
        meta({ [DATE]: "date" }),
      ),
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/lib/ai/board-intelligence/rule-draft.test.ts`
Expected: FAIL — "Failed to resolve import ./rule-draft".

- [ ] **Step 3: Write the mapper**

Create `src/lib/ai/board-intelligence/rule-draft.ts`:

```ts
import type { Draft } from "@/components/boards/automations/recipes";
import type { Action } from "./runs";

/** The least the mapper needs to decide: column kinds and who is a member.
 *  Deliberately not `BoardContext` — see the task note. */
export type RuleBoardMeta = {
  columns: readonly { id: string; kind: string }[];
  memberIds: readonly string[];
};

/**
 * A suggestion's one-off write, restated as the standing rule that would make
 * it unnecessary next time (spec §2.2).
 *
 * Pure: no React, no I/O — so every mapping is table-tested, and the button
 * that calls it decides whether to render by asking for a draft and checking
 * for null.
 *
 * `null` means "this action maps onto no engine primitive on THIS board" —
 * either the kind has no rule form (`set_due`, `filter`) or a column the draft
 * needs is missing. The caller renders no button.
 */
export function ruleDraftFor(
  action: Action,
  meta: RuleBoardMeta,
): Draft | null {
  const firstOfKind = (kind: string): string | null =>
    meta.columns.find((c) => c.kind === kind)?.id ?? null;
  const isKind = (id: string, kind: string): boolean =>
    meta.columns.some((c) => c.id === id && c.kind === kind);

  switch (action.type) {
    case "reassign": {
      // The column and the member both came from model output, so both are
      // re-checked against the board here — the same rule apply-time
      // validation follows, for the same reason.
      if (!isKind(action.columnId, "people")) return null;
      if (!meta.memberIds.includes(action.toUserId)) return null;
      return {
        trigger: { type: "item_created" },
        actions: [
          {
            type: "assign_person",
            columnId: action.columnId,
            userId: action.toUserId,
          },
        ],
      };
    }
    case "set_status": {
      const dateCol = firstOfKind("date");
      if (!dateCol) return null;
      if (!meta.columns.some((c) => c.id === action.columnId)) return null;
      return {
        trigger: { type: "date_reached", columnId: dateCol, offsetDays: 0 },
        actions: [
          {
            type: "set_option",
            columnId: action.columnId,
            optionId: action.optionId,
          },
        ],
      };
    }
    case "nudge": {
      const dateCol = firstOfKind("date");
      const peopleCol = firstOfKind("people");
      if (!dateCol || !peopleCol) return null;
      return {
        trigger: { type: "date_reached", columnId: dateCol, offsetDays: 0 },
        // `notify` has no message field. The card's one-off text does not
        // survive; the user sees the rule as it will actually fire before
        // saving it (spec §2.2).
        actions: [
          {
            type: "notify",
            recipient: { kind: "owner", peopleColumnId: peopleCol },
          },
        ],
      };
    }
    // `set_due` writes a date and the engine has no set-date action; `filter`
    // changes only what the reader is looking at. Neither is a rule.
    case "set_due":
    case "filter":
      return null;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/lib/ai/board-intelligence/rule-draft.test.ts`
Expected: PASS — eight cases.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/board-intelligence/rule-draft.ts src/lib/ai/board-intelligence/rule-draft.test.ts
git commit -m "feat(intelligence): map a suggestion action onto an automation draft"
```

---

### Task 5: `ruleRequest` on the store, consumed by the header

**Files:**

- Modify: `src/stores/board-intelligence.ts`
- Modify: `src/components/boards/BoardHeader.tsx:251-257`
- Modify: `src/components/boards/automations/AutomationsDialog.tsx` (new `seedDraft` prop)
- Test: `src/stores/board-intelligence.test.ts`, `src/components/boards/automations/AutomationsDialog.test.tsx`

**Interfaces:**

- Consumes: `Draft` from `@/components/boards/automations/recipes`.
- Produces: on the store — `ruleRequest: RuleRequest | null`, `requestRule(boardId: string, draft: Draft): void`, `consumeRule(nonce: number): void`, `export type RuleRequest = { boardId: string; draft: Draft; nonce: number }`. On `AutomationsDialog` — a new optional prop `seedDraft?: Draft`, which seeds the builder when the dialog opens.

- [ ] **Step 1: Write the failing tests**

In `src/stores/board-intelligence.test.ts`:

```ts
const draft = {
  trigger: { type: "item_created" as const },
  actions: [{ type: "assign_person" as const, columnId: "c1", userId: "u1" }],
};

it("carries a rule request and clears it by nonce", () => {
  const s = useBoardIntelligenceStore.getState();
  s.requestRule("board-1", draft);
  const req = useBoardIntelligenceStore.getState().ruleRequest;
  expect(req).toMatchObject({ boardId: "board-1", draft });

  // A stale nonce clears nothing — the same rule openRequest/filterRequest
  // follow, so a request issued while another is in flight is never lost.
  useBoardIntelligenceStore.getState().consumeRule(req!.nonce - 1);
  expect(useBoardIntelligenceStore.getState().ruleRequest).not.toBeNull();

  useBoardIntelligenceStore.getState().consumeRule(req!.nonce);
  expect(useBoardIntelligenceStore.getState().ruleRequest).toBeNull();
});
```

In `src/components/boards/automations/AutomationsDialog.test.tsx`:

```ts
it("opens straight into a seeded builder", async () => {
  render(<AutomationsDialog {...baseProps} open seedDraft={seededDraft} />);
  // Builder, not the rule list: the draft is the reason the dialog opened.
  expect(await screen.findByRole("button", { name: "Save" })).toBeInTheDocument();
  expect(screen.getByLabelText("Assign in column")).toHaveValue("people-1");
  expect(screen.getByLabelText("Assign to")).toHaveValue("user-1");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/stores/board-intelligence.test.ts src/components/boards/automations/AutomationsDialog.test.tsx`
Expected: FAIL — `requestRule is not a function`; `seedDraft` is not a known prop and the dialog renders the list.

- [ ] **Step 3: Extend the store**

In `src/stores/board-intelligence.ts`, add to the types and the creator, mirroring `filterRequest` exactly:

```ts
/** "Always do this" (spec §2.3): the dock hands the header a prefilled rule.
 *  A third command of the same nonce-stamped shape as the two above — the
 *  consumer clears exactly the request it handled. */
export type RuleRequest = { boardId: string; draft: Draft; nonce: number };
```

```ts
  ruleRequest: null,
  requestRule: (boardId, draft) =>
    set({ ruleRequest: { boardId, draft, nonce: nextNonce() } }),
  consumeRule: (n) =>
    set((s) => (s.ruleRequest?.nonce === n ? { ruleRequest: null } : {})),
```

Declare `ruleRequest`, `requestRule` and `consumeRule` in `BoardIntelligenceStoreState` and import `Draft` as a type.

- [ ] **Step 4: Seed the dialog**

In `AutomationsDialog.tsx`, accept `seedDraft?: Draft` and open into the builder when it arrives:

```tsx
// The dock asked for a specific rule, so the list is not what the user came
// for. Edge-triggered on the draft identity: re-seeding on every render would
// wipe edits the user had already made to the seeded draft.
const seeded = useRef<Draft | undefined>(undefined);
useEffect(() => {
  if (!open || !seedDraft || seeded.current === seedDraft) return;
  seeded.current = seedDraft;
  startBuild(seedDraft);
}, [open, seedDraft]);
```

Clear `seeded.current` in `closeAll`'s `!next` branch so reopening with the same draft object seeds again. Import `useEffect` and `useRef`.

- [ ] **Step 5: Consume the request in the header**

In `BoardHeader.tsx`, beside the existing automations state:

```tsx
const ruleRequest = useBoardIntelligenceStore((s) => s.ruleRequest);
const consumeRule = useBoardIntelligenceStore((s) => s.consumeRule);
const [seedDraft, setSeedDraft] = useState<Draft | undefined>();
useEffect(() => {
  if (!ruleRequest || ruleRequest.boardId !== boardId) return;
  setSeedDraft(ruleRequest.draft);
  setAutomationsOpen(true);
  consumeRule(ruleRequest.nonce);
}, [boardId, ruleRequest, consumeRule]);
```

Pass `seedDraft={seedDraft}` to `<AutomationsDialog>`, and clear it (`setSeedDraft(undefined)`) in the `onOpenChange` handler when the dialog closes.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm vitest run src/stores/board-intelligence.test.ts src/components/boards/ && pnpm typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add src/stores/board-intelligence.ts src/stores/board-intelligence.test.ts src/components/boards/BoardHeader.tsx src/components/boards/automations/AutomationsDialog.tsx src/components/boards/automations/AutomationsDialog.test.tsx
git commit -m "feat(intelligence): carry a prefilled automation draft to the header"
```

---

### Task 6: "Always do this" on the suggestion card

**Files:**

- Modify: `src/components/boards/dock/intelligence/SuggestionCard.tsx`
- Modify: `src/components/boards/dock/intelligence/IntelligenceTab.tsx`
- Modify: `src/components/boards/dock/DockBody.tsx`, `src/components/boards/dock/BoardDock.tsx` (thread `ruleMeta` down)
- Modify: `src/app/(app)/boards/[boardId]/page.tsx:113-119` (supply `ruleMeta`)
- Test: `src/components/boards/dock/intelligence/SuggestionCard.test.tsx` (create if absent), `src/components/boards/dock/intelligence/IntelligenceTab.test.tsx`

**Interfaces:**

- Consumes: `ruleDraftFor` + `RuleBoardMeta` (Task 4), `requestRule` (Task 5), the `canApply` flag already threaded into the tab.
- Produces: `SuggestionCard` prop `onAlwaysDoThis?: () => void` — absent renders no button. `IntelligenceTab`, `DockBody` and `BoardDock` each gain `ruleMeta: RuleBoardMeta`.

**Why `canApply` is the gate, not org-admin:** `getBoardAdminStatus` gates the **webhook** action only (`src/lib/boards/automation-actions.ts:72`, "the webhook admin-gate"); any board editor may create an ordinary rule. So the button follows the same permission as Apply, and none of these drafts contains a webhook.

- [ ] **Step 1: Write the failing tests**

In `SuggestionCard.test.tsx`:

```ts
it("offers Always do this when a handler is given", async () => {
  const onAlways = vi.fn();
  render(
    <SuggestionCard {...base} suggestion={reassignSuggestion} canApply onAlwaysDoThis={onAlways} />,
  );
  await userEvent.click(screen.getByRole("button", { name: /always do this/i }));
  expect(onAlways).toHaveBeenCalledTimes(1);
});

it("renders no Always do this when the handler is absent", () => {
  render(<SuggestionCard {...base} suggestion={reassignSuggestion} canApply />);
  expect(
    screen.queryByRole("button", { name: /always do this/i }),
  ).not.toBeInTheDocument();
});

it("renders no Always do this for a viewer", () => {
  render(
    <SuggestionCard
      {...base}
      suggestion={reassignSuggestion}
      canApply={false}
      onAlwaysDoThis={vi.fn()}
    />,
  );
  expect(
    screen.queryByRole("button", { name: /always do this/i }),
  ).not.toBeInTheDocument();
});
```

In `IntelligenceTab.test.tsx`, driving the real mapper — a `filter` card maps to nothing, so the tab must pass no handler for it:

```ts
it("issues a rule request for a reassign card and offers none for a filter card", async () => {
  renderTab({
    run: runWithReassignAndFilterCards,
    canApply: true,
    ruleMeta: {
      columns: [{ id: "people-1", kind: "people" }],
      memberIds: ["user-1"],
    },
  });
  const buttons = screen.getAllByRole("button", { name: /always do this/i });
  expect(buttons).toHaveLength(1);
  await userEvent.click(buttons[0]);
  expect(useBoardIntelligenceStore.getState().ruleRequest).toMatchObject({
    boardId: "board-1",
    draft: {
      trigger: { type: "item_created" },
      actions: [
        { type: "assign_person", columnId: "people-1", userId: "user-1" },
      ],
    },
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/components/boards/dock/intelligence/`
Expected: FAIL — no button with that name exists.

- [ ] **Step 3: Add the button**

In `SuggestionCard.tsx`, accept `onAlwaysDoThis?: () => void` and render it after `Dismiss`, in the same control row:

```tsx
{
  canApply && onAlwaysDoThis ? (
    <Button
      size="xs"
      variant="ghost"
      // Opening a prefilled editor writes nothing, so a board write
      // in flight is no reason to withhold it — the same reasoning
      // that keeps `filter` live under `pending`.
      onClick={onAlwaysDoThis}
    >
      Always do this
    </Button>
  ) : null;
}
```

- [ ] **Step 4: Wire the tab**

In `IntelligenceTab.tsx`, take `ruleMeta: RuleBoardMeta` as a prop, read `requestRule` from the store, and map per card:

```tsx
const requestRule = useBoardIntelligenceStore((s) => s.requestRule);
```

```tsx
{
  visible.map((s) => {
    // The draft is also the ANSWER to "should this card offer the
    // button" — asking the mapper is the whole check (spec §2.2).
    const draft = s.actions[0] ? ruleDraftFor(s.actions[0], ruleMeta) : null;
    return (
      <SuggestionCard
        key={s.id}
        suggestion={s}
        canApply={canApply}
        pending={pending}
        onApply={(i) => void apply(s.id, i)}
        onDismiss={() => void dismiss(s.id)}
        onAlwaysDoThis={draft ? () => requestRule(boardId, draft) : undefined}
      />
    );
  });
}
```

- [ ] **Step 5: Thread `ruleMeta` from the page**

The dock is a sibling of the board provider and holds no payload, so the metadata comes from the page — which already has both reads, so this adds **no** query.

In `src/app/(app)/boards/[boardId]/page.tsx`, on the existing `<BoardDock>`:

```tsx
<BoardDock
  boardId={boardId}
  agents={agentRows ?? []}
  currentUserId={user.id}
  access={access ?? "viewer"}
  initialRun={latestRun}
  // "Always do this" maps a suggestion onto an automation draft purely on
  // the client (spec §2.2/§4). Column kinds and member ids are all the
  // mapper checks, and both are already in hand here.
  ruleMeta={{
    columns: payload.columns.map((c) => ({ id: c.id, kind: c.kind })),
    memberIds: members.map((m) => m.userId),
  }}
/>
```

In `BoardDock.tsx` and `DockBody.tsx`, add `ruleMeta: RuleBoardMeta` to the props type and pass it straight through to `<IntelligenceTab>`.

- [ ] **Step 6: Run the tests and the typecheck**

Run: `pnpm vitest run src/components/boards/dock/ && pnpm typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add src/components/boards/dock "src/app/(app)/boards/[boardId]/page.tsx"
git commit -m "feat(intelligence): offer Always do this on mappable suggestions"
```

---

### Task 7: the streaming Ask route

**Files:**

- Create: `src/lib/ai/board-intelligence/ask-protocol.ts`, `src/lib/ai/board-intelligence/ask-input.ts`, `src/lib/ai/board-intelligence/ask-context.ts`, `src/app/api/board-intelligence/ask/route.ts`
- Modify: `src/components/ai/ask/use-ask-stream.ts` (generalize `readAskStream`), `src/lib/ai/ask/ask-stream.ts` (`toolset` option)
- Test: `src/lib/ai/board-intelligence/ask-input.test.ts`, `src/lib/ai/board-intelligence/ask-route.test.ts`, `src/lib/ai/ask/ask-stream.test.ts` (extend)

**Interfaces:**

- Consumes: `getLatestBoardIntelligenceRun` / `BoardIntelligenceRun` from `./runs`; `askPulseStream` from `@/lib/ai/ask/ask-stream`; `runAi` from `@/lib/ai/gateway`; `requireAiEntitlement`; `assertToolLoopCapable`.
- Produces:
  - `export type IntelAskEvent = { type: "token"; text: string } | { type: "status"; text: string } | { type: "done" } | { type: "error"; message: string }` and `encodeIntelEvent(e: IntelAskEvent): string`.
  - `export const intelAskRequestSchema` with output `{ runId: string; question: string; history: { question: string; answer: string }[] }`.
  - `export function buildIntelAskSystem(run: BoardIntelligenceRun, board: { id: string; name: string }): string`.
  - `askPulseStream` gains `toolset?: "full" | "read-only"` (default `"full"`, current behaviour byte-for-byte).
  - `POST /api/board-intelligence/ask` streaming `application/x-ndjson`.

- [ ] **Step 1: Write the failing input-schema test**

Create `src/lib/ai/board-intelligence/ask-input.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { intelAskRequestSchema, MAX_ASK_HISTORY } from "./ask-input";

const base = {
  runId: "11111111-1111-4111-8111-111111111111",
  question: "What slipped?",
};

describe("intelAskRequestSchema", () => {
  it("accepts a question with no history", () => {
    expect(
      intelAskRequestSchema.parse({ ...base, history: [] }).history,
    ).toEqual([]);
  });

  // SHAPE is strict, SIZE truncates. A cap the model was never told about must
  // never throw AFTER the call is metered — the failed run leaves the input
  // hash unchanged, so every retry pays again and fails again (spec §3.1).
  it("truncates over-long history to the most recent pairs", () => {
    const history = Array.from({ length: MAX_ASK_HISTORY + 3 }, (_, i) => ({
      question: `q${i}`,
      answer: `a${i}`,
    }));
    const parsed = intelAskRequestSchema.parse({ ...base, history });
    expect(parsed.history).toHaveLength(MAX_ASK_HISTORY);
    expect(parsed.history.at(-1)?.question).toBe(`q${MAX_ASK_HISTORY + 2}`);
  });

  it("rejects a malformed history entry", () => {
    expect(() =>
      intelAskRequestSchema.parse({ ...base, history: [{ question: "q" }] }),
    ).toThrow();
  });

  it("rejects an empty question and a non-uuid runId", () => {
    expect(() =>
      intelAskRequestSchema.parse({ ...base, question: "  ", history: [] }),
    ).toThrow();
    expect(() =>
      intelAskRequestSchema.parse({ ...base, runId: "nope", history: [] }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run src/lib/ai/board-intelligence/ask-input.test.ts`
Expected: FAIL — "Failed to resolve import ./ask-input".

- [ ] **Step 3: Write the input schema and the protocol module**

`src/lib/ai/board-intelligence/ask-input.ts`:

```ts
import { z } from "zod";

/** Pairs kept in the tab and replayed as context (spec §3.2). */
export const MAX_ASK_HISTORY = 4;

const pair = z.object({
  question: z.string().trim().min(1).max(500),
  answer: z.string().trim().min(1).max(4000),
});

export const intelAskRequestSchema = z.object({
  runId: z.string().uuid(),
  question: z.string().trim().min(1).max(500),
  /** Strict on shape, TRUNCATING on size: keep the most recent pairs rather
   *  than rejecting a request the client could not have known was too long. */
  history: z.array(pair).transform((h) => h.slice(-MAX_ASK_HISTORY)),
});
export type IntelAskRequest = z.infer<typeof intelAskRequestSchema>;
```

`src/lib/ai/board-intelligence/ask-protocol.ts`:

```ts
// Client-safe (no server-only): imported by the route AND the tab's hook.
//
// A separate union from `AskStreamEvent` on purpose. That protocol's `done`
// carries a conversationId and an assistantMessageId, and this turn persists
// NOTHING — there is no row to name (spec §3.2). Same NDJSON framing, two
// events fewer.
export type IntelAskEvent =
  | { type: "token"; text: string }
  | { type: "status"; text: string }
  | { type: "done" }
  | { type: "error"; message: string };

/** The first byte of every turn, before any model work — proof to the client
 *  that the stream is live rather than hung (the lesson of gotcha-62). */
export const INTEL_ASK_OPENING_STATUS = "Reading this board…";

export function encodeIntelEvent(e: IntelAskEvent): string {
  return JSON.stringify(e) + "\n";
}
```

- [ ] **Step 4: Run the input test to verify it passes**

Run: `pnpm vitest run src/lib/ai/board-intelligence/ask-input.test.ts`
Expected: PASS.

- [ ] **Step 5: Generalize `readAskStream`**

In `src/components/ai/ask/use-ask-stream.ts`, change the reader's signature only — no behaviour change:

```ts
export async function readAskStream<T extends { type: string } = AskStreamEvent>(
  res: Response,
  onEvent: (e: T) => void,
): Promise<boolean> {
```

and inside, `const dispatch = (e: T) => { ... }` with the same `e.type === "done" || e.type === "error"` terminal check, and both `JSON.parse(...) as T` casts. `useAskStream` keeps calling it unparameterized and is untouched otherwise.

Run: `pnpm vitest run src/components/ai/ask/use-ask-stream.test.ts`
Expected: PASS unchanged — this step must move no test.

- [ ] **Step 6: Write the failing toolset test**

In `src/lib/ai/ask/ask-stream.test.ts`, following that file's existing fake-Anthropic harness:

```ts
it("offers only the two read tools under toolset read-only", async () => {
  const client = fakeClient({ answer: "ok" });
  await askPulseStream({ ...baseArgs, client, toolset: "read-only" });
  const names = client.messages.stream.mock.calls[0][0].tools.map(
    (t: { name: string }) => t.name,
  );
  expect(names).toEqual(["query_items", "semantic_search_items"]);
  // Named explicitly: a write tool reaching this loop is the failure this
  // guards, and an assertion that never names one cannot see it.
  expect(names).not.toContain("propose_create_item");
  expect(names).not.toContain("propose_update_cell");
  expect(names).not.toContain("list_board_members");
});

it("still offers the full toolset by default", async () => {
  const client = fakeClient({ answer: "ok" });
  await askPulseStream({ ...baseArgs, client });
  const names = client.messages.stream.mock.calls[0][0].tools.map(
    (t: { name: string }) => t.name,
  );
  expect(names).toContain("list_boards");
  expect(names).toContain("propose_update_cell");
});
```

Run: `pnpm vitest run src/lib/ai/ask/ask-stream.test.ts`
Expected: FAIL — `toolset` is not a parameter, so the read-only call still gets the full list.

- [ ] **Step 7: Add the toolset option**

In `src/lib/ai/ask/ask-stream.ts`, add to the args type:

```ts
  /**
   * `"read-only"` (Board Intelligence Q&A, spec §3.1) narrows the loop to the
   * two board-read tools and attaches NO write executor, so no propose_* tool
   * is even offered to the model. `"full"` is Ask's shipped behaviour and the
   * default — a missing option must change nothing.
   */
  toolset?: "full" | "read-only";
```

and replace the tool list and writer construction:

```ts
const readOnly = args.toolset === "read-only";
const INTEL_READ_TOOLS = new Set(["query_items", "semantic_search_items"]);
const tools = readOnly
  ? ASK_TOOLS.filter((t) => INTEL_READ_TOOLS.has(t.name))
  : [...ASK_TOOLS, LIST_MEMBERS_TOOL, ...WRITE_TOOLS];
const writer = readOnly
  ? null
  : createWriteToolExecutor({
      orgId: args.orgId,
      workspaceId: args.workspaceId,
    });
```

In the tool-dispatch branch, route a non-read tool name to `writer` only when it exists; with `readOnly` the model cannot name one, and if it somehow does, return the existing "unknown tool" error result rather than executing anything. `proposedActions` is `[]` on this path by construction.

- [ ] **Step 8: Run the toolset tests to verify they pass**

Run: `pnpm vitest run src/lib/ai/ask/ask-stream.test.ts`
Expected: PASS, including the unchanged default-toolset cases.

- [ ] **Step 9: Write the context builder**

`src/lib/ai/board-intelligence/ask-context.ts`:

```ts
import "server-only";
import type { BoardIntelligenceRun } from "./runs";

/**
 * The system prompt for one Q&A turn: this board, and the brief the reader is
 * looking at. The run payload is the grounding — the reader's question is
 * nearly always about something the brief just told them (spec §3.1).
 */
export function buildIntelAskSystem(
  run: BoardIntelligenceRun,
  board: { id: string; name: string },
): string {
  const suggestions = run.payload.suggestions
    .map((s) => `- ${s.title}: ${s.body}`)
    .join("\n");
  return [
    `You are the Intelligence assistant for the Monolith board "${board.name}" (id ${board.id}).`,
    "Answer questions about THIS board only, grounded in the brief below and in the read tools.",
    "Use query_items and semantic_search_items for anything the brief does not already say. Never fabricate an item, a person or a date.",
    "You cannot change the board. If asked to, say what you would change and that the user can apply it from a suggestion card.",
    "Answer in at most four sentences unless asked for more.",
    "",
    `BRIEF (generated ${run.generatedAt}):`,
    run.payload.brief,
    suggestions ? `\nSUGGESTIONS ON SCREEN:\n${suggestions}` : "",
  ].join("\n");
}
```

- [ ] **Step 10: Write the failing route tests**

Create `src/lib/ai/board-intelligence/ask-route.test.ts`, mocking the same modules the Phase 2 run tests mock (`@/lib/auth/session`, `@/lib/org/active`, `@/lib/ai/entitlement`, `@/lib/ai/gateway`, `@/lib/supabase/server`, `@/lib/ai/ask/ask-stream`) and calling `POST` directly:

```ts
it("404s when the run is not readable", async () => {
  mockRun(null);
  const res = await POST(req({ runId: RUN_ID, question: "why?", history: [] }));
  expect(res.status).toBe(404);
  expect(askPulseStream).not.toHaveBeenCalled();
});

it("rejects a malformed body before any model call", async () => {
  const res = await POST(req({ runId: "nope", question: "", history: [] }));
  expect(res.status).toBe(400);
  expect(askPulseStream).not.toHaveBeenCalled();
});

it("runs the loop read-only under the board_intelligence feature and streams to done", async () => {
  mockRun(sampleRun);
  const res = await POST(
    req({ runId: RUN_ID, question: "what slipped?", history: [] }),
  );
  expect(res.headers.get("Content-Type")).toContain("application/x-ndjson");

  const events = await drain(res);
  expect(events[0]).toEqual({ type: "status", text: INTEL_ASK_OPENING_STATUS });
  expect(events.at(-1)).toEqual({ type: "done" });
  expect(runAi).toHaveBeenCalledWith(
    expect.objectContaining({ feature: "board_intelligence" }),
    expect.any(Function),
  );
  expect(askPulseStream).toHaveBeenCalledWith(
    expect.objectContaining({ toolset: "read-only" }),
  );
});

it("emits an error event when the turn throws, and never a done", async () => {
  mockRun(sampleRun);
  vi.mocked(askPulseStream).mockRejectedValueOnce(new Error("provider down"));
  const events = await drain(
    await POST(req({ runId: RUN_ID, question: "q", history: [] })),
  );
  expect(events.at(-1)).toEqual({ type: "error", message: "provider down" });
  expect(events).not.toContainEqual({ type: "done" });
});
```

Run: `pnpm vitest run src/lib/ai/board-intelligence/ask-route.test.ts`
Expected: FAIL — the route module does not exist.

- [ ] **Step 11: Write the route**

`src/app/api/board-intelligence/ask/route.ts`. Structure it exactly like `src/app/api/ask/route.ts` — no `runtime` export (Cache Components forbids one), the response body as a pure observer of a detached turn held open with `after`, `emit` writing NDJSON into the sink, `closeSink()` in `finally`:

```ts
export async function POST(request: Request) {
  const user = await requireUser();
  const org = await resolveActiveOrg();
  if (!org) return NextResponse.json({ error: "No organization." }, { status: 400 });

  const parsed = intelAskRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  const { runId, question, history } = parsed.data;

  try {
    await requireAiEntitlement(org.id, "board_intelligence");
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 402 });
  }

  const supabase = await createClient();
  const workspaceId = await getActiveWorkspaceId(await listWorkspacesCached(org.id));
  if (!workspaceId) return NextResponse.json({ error: "No workspace." }, { status: 400 });

  // RLS already restricts board_intelligence_runs to the owning user, so a
  // miss is "not yours or not there" and both answer the same way: 404. No
  // context is ever invented for a run we cannot read.
  const row = await supabase
    .from("board_intelligence_runs")
    .select("*")
    .eq("id", runId)
    .maybeSingle();
  const run = row.data ? rowToRun(row.data) : null;
  if (!run) return NextResponse.json({ error: "Run not found." }, { status: 404 });

  const { data: board } = await supabase
    .from("boards")
    .select("id, name")
    .eq("id", run.boardId)
    .maybeSingle();
  if (!board) return NextResponse.json({ error: "Board not found." }, { status: 404 });
  // … sink/emit/stream exactly as api/ask/route.ts, then:

  const turn = (async () => {
    emit({ type: "status", text: INTEL_ASK_OPENING_STATUS });
    try {
      await runAi(
        { orgId: org.id, userId: user.id, feature: "board_intelligence" },
        async ({ apiKey, provider, model }) => {
          assertToolLoopCapable(provider, "board_intelligence");
          const r = await askPulseStream({
            apiKey,
            model: model.requestModel,
            orgId: org.id,
            workspaceId,
            messages: buildIntelAskMessages(history, question),
            system: buildIntelAskSystem(run, board),
            toolset: "read-only",
            emit: (e) => {
              // Bridge the two protocols: this turn has no conversation, so
              // `done`/`proposal` have nothing to say here and are dropped.
              if (e.type === "token" || e.type === "status") emit(e);
            },
          });
          return {
            result: null,
            usage: r.usage,
          };
        },
      );
      emit({ type: "done" });
    } catch (e) {
      emit({ type: "error", message: (e as Error).message || "The assistant hit a snag." });
      console.error("[intelligence-ask] turn failed:", e);
    } finally {
      closeSink();
    }
  })();
```

`buildIntelAskMessages(history, question)` is a small local helper in `ask-context.ts` that maps each pair to a `user`/`assistant` message and appends the new question — the same `Anthropic.MessageParam[]` shape `buildAskMessages` produces.

Nothing is persisted: no `ai_messages`, no `ai_conversations`, no memory write. `runAi` meters the turn under `board_intelligence`.

- [ ] **Step 12: Run the route tests to verify they pass**

Run: `pnpm vitest run src/lib/ai/board-intelligence/`
Expected: PASS.

- [ ] **Step 13: Commit**

```bash
git add src/app/api/board-intelligence src/lib/ai/board-intelligence/ask-context.ts src/lib/ai/board-intelligence/ask-input.ts src/lib/ai/board-intelligence/ask-protocol.ts src/lib/ai/board-intelligence/ask-input.test.ts src/lib/ai/board-intelligence/ask-route.test.ts src/lib/ai/ask/ask-stream.ts src/lib/ai/ask/ask-stream.test.ts src/components/ai/ask/use-ask-stream.ts
git commit -m "feat(intelligence): stream a read-only Q&A turn over the cached run"
```

---

### Task 8: the composer and its Q/A pairs

**Files:**

- Create: `src/components/boards/dock/intelligence/use-intelligence-ask.ts`, `src/components/boards/dock/intelligence/AskComposer.tsx`
- Modify: `src/components/boards/dock/intelligence/IntelligenceTab.tsx`
- Test: `src/components/boards/dock/intelligence/use-intelligence-ask.test.ts`, `src/components/boards/dock/intelligence/AskComposer.test.tsx`

**Interfaces:**

- Consumes: `IntelAskEvent` / `INTEL_ASK_OPENING_STATUS` (Task 7), `readAskStream` (Task 7 Step 5), `MAX_ASK_HISTORY`.
- Produces: `useIntelligenceAsk(runId: string | null)` returning `{ pairs: QaPair[]; streaming: boolean; status: string | null; error: string | null; ask(question: string): Promise<void> }`, where `QaPair = { id: string; question: string; answer: string }`; and `AskComposer` taking `{ runId: string | null; boardId: string; onOpenInChat?: (pair: QaPair) => void }`.

- [ ] **Step 1: Write the failing hook test**

```ts
it("streams tokens into a pair and keeps at most five", async () => {
  fetchMock.mockResolvedValue(
    ndjson([
      { type: "status", text: "Reading this board…" },
      { type: "token", text: "Two " },
      { type: "token", text: "items slipped." },
      { type: "done" },
    ]),
  );
  const { result } = renderHook(() => useIntelligenceAsk(RUN_ID));

  await act(() => result.current.ask("what slipped?"));
  expect(result.current.pairs).toEqual([
    expect.objectContaining({
      question: "what slipped?",
      answer: "Two items slipped.",
    }),
  ]);

  for (let i = 0; i < 5; i++) await act(() => result.current.ask(`q${i}`));
  expect(result.current.pairs).toHaveLength(5);
  expect(result.current.pairs[0].question).toBe("q1"); // oldest dropped
});

it("sends at most MAX_ASK_HISTORY prior pairs", async () => {
  // … after six asks
  const body = JSON.parse(fetchMock.mock.lastCall![1].body);
  expect(body.history).toHaveLength(MAX_ASK_HISTORY);
});

it("surfaces an error event and keeps the question visible", async () => {
  fetchMock.mockResolvedValue(ndjson([{ type: "error", message: "nope" }]));
  const { result } = renderHook(() => useIntelligenceAsk(RUN_ID));
  await act(() => result.current.ask("q"));
  expect(result.current.error).toBe("nope");
});

it("refuses to ask with no run", async () => {
  const { result } = renderHook(() => useIntelligenceAsk(null));
  await act(() => result.current.ask("q"));
  expect(fetchMock).not.toHaveBeenCalled();
});
```

And the composer test:

```ts
it("is disabled with no run and says why", () => {
  render(<AskComposer runId={null} boardId="board-1" />);
  expect(screen.getByRole("textbox", { name: /ask about this board/i })).toBeDisabled();
  expect(screen.getByText(/catch me up/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run src/components/boards/dock/intelligence/`
Expected: FAIL — both modules are missing.

- [ ] **Step 3: Write the hook**

`use-intelligence-ask.ts` — a `"use client"` module that POSTs to `/api/board-intelligence/ask` and reads the body with `readAskStream<IntelAskEvent>`:

```ts
export type QaPair = { id: string; question: string; answer: string };

/** Spec §3.2: at most five pairs, component state, nothing persisted. */
const MAX_PAIRS = 5;

export function useIntelligenceAsk(runId: string | null) {
  const [pairs, setPairs] = useState<QaPair[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ask = useCallback(
    async (question: string) => {
      const q = question.trim();
      // No run means no grounding, which is the whole contract of this surface
      // — and the one place LLM spend on this tab starts.
      if (!runId || !q || streaming) return;
      setError(null);
      setStreaming(true);
      const id = crypto.randomUUID();
      setPairs((prev) =>
        [...prev, { id, question: q, answer: "" }].slice(-MAX_PAIRS),
      );
      try {
        const res = await fetch("/api/board-intelligence/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            runId,
            question: q,
            history: pairs
              .filter((p) => p.answer)
              .slice(-MAX_ASK_HISTORY)
              .map(({ question, answer }) => ({ question, answer })),
          }),
        });
        if (!res.ok || !res.body) {
          const message = await res
            .json()
            .then((b) => b.error)
            .catch(() => undefined);
          setError(message ?? "Request failed.");
          return;
        }
        await readAskStream<IntelAskEvent>(res, (e) => {
          if (e.type === "token")
            setPairs((prev) =>
              prev.map((p) =>
                p.id === id ? { ...p, answer: p.answer + e.text } : p,
              ),
            );
          else if (e.type === "status") setStatus(e.text);
          else if (e.type === "error") setError(e.message);
        });
      } catch {
        // Nothing is persisted on this surface, so a severed body has no
        // answer to recover — say so rather than leaving a blank pair.
        setError("The answer didn't finish. Try again.");
      } finally {
        setStreaming(false);
        setStatus(null);
      }
    },
    [pairs, runId, streaming],
  );

  return { pairs, streaming, status, error, ask };
}
```

- [ ] **Step 4: Write the composer**

Load the `pulse-ui` and `frontend-design` skills **before** writing this file; the classes below follow the dock's existing surface conventions (`bg-surface`, `text-3xs`, `Kicker`) and must be checked against the skill, not copied on faith.

`src/components/boards/dock/intelligence/AskComposer.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Kicker } from "@/components/ui/kicker";
import { Textarea } from "@/components/ui/textarea";
import { useIntelligenceAsk, type QaPair } from "./use-intelligence-ask";

/**
 * Ask a question about the brief on screen (spec §3.2).
 *
 * Disabled with no run: answers are grounded in the run by contract, and this
 * is the one place LLM spend starts on this tab. Nothing here is persisted — a
 * reload clears every pair.
 */
export function AskComposer({
  runId,
  onOpenInChat,
}: {
  runId: string | null;
  onOpenInChat?: (pair: QaPair) => void | Promise<void>;
}) {
  const { pairs, streaming, status, error, ask } = useIntelligenceAsk(runId);
  const [draft, setDraft] = useState("");

  async function submit() {
    const q = draft.trim();
    if (!q || !runId || streaming) return;
    setDraft("");
    await ask(q);
  }

  return (
    <div className="flex flex-col gap-3">
      {pairs.length > 0 && (
        <ul className="flex flex-col gap-3">
          {pairs.map((pair) => (
            <li key={pair.id} className="flex flex-col gap-1">
              <Kicker size="xs">{pair.question}</Kicker>
              <p className="text-sm whitespace-pre-wrap">
                {pair.answer || (
                  <span className="text-muted-foreground">
                    {status ?? "Thinking…"}
                  </span>
                )}
              </p>
              {pair.answer && onOpenInChat && (
                <div>
                  <Button
                    size="xs"
                    variant="link"
                    onClick={() => void onOpenInChat(pair)}
                  >
                    Open in Chat
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      )}

      <Textarea
        aria-label="Ask about this board"
        className="min-h-16"
        placeholder="Ask about this board…"
        value={draft}
        disabled={!runId || streaming}
        maxLength={500}
        onChange={(e) => setDraft(e.target.value)}
        // Enter sends, Shift+Enter is a newline — the dock composer's rule.
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void submit();
          }
        }}
      />
      {!runId && (
        <p className="text-muted-foreground text-3xs">
          Catch me up first — answers are grounded in the brief.
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Mount it in the tab**

In `IntelligenceTab.tsx`, inside the `run && (...)` block, immediately **above** the model/token footer:

```tsx
<AskComposer runId={run.id} onOpenInChat={onOpenInChat} />
```

`onOpenInChat` is the prop Task 9 threads in; until then the tab passes nothing and the button does not render.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm vitest run src/components/boards/dock/ && pnpm typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add src/components/boards/dock/intelligence
git commit -m "feat(intelligence): ask a question about the brief in the tab"
```

---

### Task 9: Open in Chat

**Files:**

- Create: `src/lib/ai/board-intelligence/qa-thread.ts`
- Test: `src/lib/ai/board-intelligence/qa-thread.test.ts`
- Modify: `src/components/boards/dock/intelligence/AskComposer.tsx`, `src/components/boards/dock/intelligence/IntelligenceTab.tsx`, `src/components/boards/dock/DockBody.tsx`, `src/components/boards/dock/BoardDock.tsx`

**Interfaces:**

- Consumes: `QaPair` (Task 8); `ActionResult` / `fail`.
- Produces: `openQaInChat(input: { runId: string; question: string; answer: string }): Promise<ActionResult<{ conversationId: string }>>`; an `onOpenInChat` prop threaded `AskComposer` → `IntelligenceTab` → `DockBody` → `BoardDock`.

- [ ] **Step 1: Write the failing test**

```ts
it("writes the conversation and both turns, user first", async () => {
  const res = await openQaInChat({
    runId: RUN_ID,
    question: "what slipped?",
    answer: "Two items.",
  });
  expect(res.ok).toBe(true);

  expect(inserted.conversations[0]).toMatchObject({
    org_id: ORG_ID,
    user_id: USER_ID,
    board_id: BOARD_ID,
    title: "what slipped?",
  });
  expect(inserted.messages.map((m) => [m.role, m.content])).toEqual([
    ["user", "what slipped?"],
    ["assistant", "Two items."],
  ]);
});

it("truncates a long question into the title", async () => {
  await openQaInChat({ runId: RUN_ID, question: "q".repeat(120), answer: "a" });
  expect(inserted.conversations[0].title).toHaveLength(60);
});

it("fails for a run the caller cannot read", async () => {
  mockRun(null);
  const res = await openQaInChat({ runId: RUN_ID, question: "q", answer: "a" });
  expect(res).toEqual({ ok: false, error: expect.any(String) });
  expect(inserted.conversations).toHaveLength(0);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run src/lib/ai/board-intelligence/qa-thread.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write the action**

`src/lib/ai/board-intelligence/qa-thread.ts`:

```ts
"use server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { resolveActiveOrg } from "@/lib/org/active";
import { createClient } from "@/lib/supabase/server";
import { type ActionResult, fail } from "@/lib/actions/result";
import { rowToRun } from "./runs";

const TITLE_MAX = 60;

const inputSchema = z.object({
  runId: z.string().uuid(),
  question: z.string().trim().min(1).max(500),
  answer: z.string().trim().min(1).max(4000),
});

/**
 * Promote one Q/A pair into a real board thread (spec §3.3).
 *
 * The answer is PERSISTED VERBATIM, never re-generated: the user is promoting
 * the answer they just read, so a second call would both cost money and risk
 * contradicting what is on screen.
 *
 * Written through the user's own client — RLS bounds this write exactly as it
 * bounds the run read above it. Modelled on `writeBriefingThread`, which does
 * the same two-insert dance for a scheduled agent.
 */
export async function openQaInChat(
  input: unknown,
): Promise<ActionResult<{ conversationId: string }>> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return fail("That question couldn't be opened in chat.");
  const { runId, question, answer } = parsed.data;

  const user = await requireUser();
  const org = await resolveActiveOrg();
  if (!org) return fail("No organization.");

  const supabase = await createClient();
  const row = await supabase
    .from("board_intelligence_runs")
    .select("*")
    .eq("id", runId)
    .maybeSingle();
  const run = row.data ? rowToRun(row.data) : null;
  if (!run) return fail("That brief is no longer available.");

  const conv = await supabase
    .from("ai_conversations")
    .insert({
      org_id: org.id,
      user_id: user.id,
      board_id: run.boardId,
      title: question.slice(0, TITLE_MAX),
    })
    .select("id")
    .single();
  if (conv.error || !conv.data) return fail("Couldn't start that thread.");

  const msgs = await supabase.from("ai_messages").insert([
    { conversation_id: conv.data.id, role: "user", content: question },
    { conversation_id: conv.data.id, role: "assistant", content: answer },
  ]);
  // A thread with no turns is worse than no thread: the ledger would list an
  // empty row the reader cannot make sense of.
  if (msgs.error) {
    await supabase.from("ai_conversations").delete().eq("id", conv.data.id);
    return fail("Couldn't save that answer to a thread.");
  }

  return { ok: true, data: { conversationId: conv.data.id } };
}
```

`visibility` is omitted deliberately: the column default (`private`) is the guarantee, exactly as in `writeBriefingThread`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/lib/ai/board-intelligence/qa-thread.test.ts`
Expected: PASS.

- [ ] **Step 5: Thread the handoff**

`IntelligenceTab.tsx` — accept and forward the prop:

```tsx
  onOpenInChat,
}: {
  // … existing props
  /** Promote one Q/A pair into a real board thread (spec §3.3). Absent for a
   *  viewer-only surface, which renders no button. */
  onOpenInChat?: (pair: QaPair) => void | Promise<void>;
```

`DockBody.tsx` — the same prop on its props type, passed straight to `<IntelligenceTab>`.

`BoardDock.tsx` — own the call and the handoff:

```tsx
const openInChat = useCallback(
  async (pair: QaPair) => {
    const res = await openQaInChat({
      runId: run?.id ?? "",
      question: pair.question,
      answer: pair.answer,
    });
    if (!res.ok) {
      setError(res.error);
      return;
    }
    // Order matters: load the ledger FIRST so `selectThread` lands on a row
    // the list already knows about, then show the chat. Reversed, the dock
    // mounts Chat on an id it cannot find and renders an empty transcript.
    await loadThreads();
    void selectThread(res.data.conversationId);
    setTab("chat");
  },
  [loadThreads, run?.id, selectThread, setTab],
);
```

Pass `onOpenInChat={openInChat}` down through `DockBody`. `run` is the store's run for this board, which the dock already reads for its badge — no new read. Reuse the dock's existing error state rather than adding a second one.

- [ ] **Step 6: Write the handoff test**

In `src/components/boards/dock/DockBody.test.tsx` (or the tab's test, wherever the existing dock render helper lives):

```ts
it("hands a promoted pair to the dock as a chat thread", async () => {
  const onOpenInChat = vi.fn();
  renderTab({ run: sampleRun, pairs: [answeredPair], onOpenInChat });
  await userEvent.click(screen.getByRole("button", { name: /open in chat/i }));
  expect(onOpenInChat).toHaveBeenCalledWith("conv-1");
});
```

- [ ] **Step 7: Run the whole suite and the gates**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all four pass. Report the actual output — no completion claim without it.

- [ ] **Step 8: Commit**

```bash
git add src/lib/ai/board-intelligence/qa-thread.ts src/lib/ai/board-intelligence/qa-thread.test.ts src/components/boards/dock
git commit -m "feat(intelligence): promote a Q&A pair into a board thread"
```

---

## Execution DAG

Dependency edges, read off the `Interfaces` blocks:

- Task 1 → Tasks 2, 3, 4 (the action shape)
- Task 4 → Task 6 (`ruleDraftFor`)
- Task 5 → Task 6 (`requestRule`)
- Task 7 → Task 8 (`IntelAskEvent`, the route, generalized `readAskStream`)
- Task 8 → Task 9 (`QaPair`, the composer)

Waves:

| Wave | Tasks                      | Notes                                                                                                      |
| ---- | -------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 1    | **1**, **5**, **7**        | No unmet dependency. Task 7 touches `ask-stream.ts` + `use-ask-stream.ts`; nothing else in this plan does. |
| 2    | **2**, **3**, **4**, **8** | Task 2 is the only migration — it lands alone through the orchestrator so `database.types.ts` never races. |
| 3    | **6**, **9**               |                                                                                                            |

Critical path: 1 → 2 (migration + types) and 7 → 8 → 9. Four steps, so wall-clock floor is Task 7's route plus the composer plus the promotion.

Worktrees: one per parallel task, cut off the shared `task/*` branch (`superpowers:using-git-worktrees`) — a shared folder loses work to lint-staged's stash. Implementers gate and commit by path; the **orchestrator** rebases, fast-forward merges, and runs `finish-task.sh` once at the end. Tasks 3 and 5 both touch `AutomationsDialog.tsx`, so they are in different waves on purpose.

A whole-branch review runs before the merge to `develop`: five green per-task reviews have still left cross-task defects on every session of this feature.

## How to test this (for the session note and the closing message)

1. Pull `develop`, run `pnpm dev`, open a board with a date column, a people column and a status column.
2. Open the dock → **Intelligence** → **Catch me up**. Wait for the brief.
3. On a card offering a write, click **Always do this**. The Automations dialog opens with the trigger and action already filled — check the sentence at the top reads the way the card did. Save it, then reopen **Automations** from the board header: the rule is listed and editable there.
4. For a reassign card, confirm the prefilled rule is "When an item is created … assign <person> in <people column>".
5. Create a new item on the board and confirm the people column fills with that person.
6. Back in **Intelligence**, type a question in the composer ("what slipped this week?"). The answer streams in under the suggestions.
7. Click **Open in Chat** on that answer. The dock switches to Chat on a new thread whose first two turns are your question and that same answer, word for word.
8. Reload the page, reopen Intelligence: the Q/A pairs are gone (they are never persisted) and the promoted thread is still in the ledger.
