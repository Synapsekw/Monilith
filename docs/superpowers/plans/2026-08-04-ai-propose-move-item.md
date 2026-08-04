# AI `propose_move_item` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the AI write path a fourth verb — move an existing item to another group on the same board — so "move QYSEA to Software" produces a confirm card instead of an apology.

**Architecture:** A new `move_item` variant threaded through the four existing layers of `src/lib/ai/write/` (schema → tool → resolver → executor), mirroring `set_item_fields` at every step. The executor delegates to the **already-shipped** `moveItem` Server Action, which owns the hard parts: it refuses subitems, refuses a group on a different board, appends to the end of the target group, and runs RLS-scoped. No migration, no new RLS, no UI — the confirm card renders `action.summary` generically.

**Tech Stack:** TypeScript (strict), Zod, Anthropic tool-use, Supabase, Vitest.

## Global Constraints

- **Within-board moves only.** Cross-board is out of scope: the boards have different columns, statuses and owners, so "move" would become "migrate and silently drop what doesn't fit." The resolver must refuse a group that is not on the item's board, with a message the model can relay.
- **The propose tools NEVER write.** They record a `ValidatedAction`; the user confirms; `executeAction` applies. This is the containment for prompt injection and it does not change.
- **Reuse `moveItem` from `src/lib/boards/actions/item.ts`** — do not write a second `items.group_id` update. It is the same action drag-and-drop and bulk-move call.
- **`ActionResult` / `fail` come from `src/lib/actions/result.ts`** — never re-declared.
- **Server Components by default; Server Actions for mutations.** This is Next.js 16 — confirm APIs against `node_modules/next/dist/docs/`.
- Commit subjects lowercase after `type(scope):`, descriptive body, staged explicitly by path (never `git add -A`).
- Gates before merge: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

---

## File Structure

**Modified — all four files are the existing layers, each gaining one variant:**

| File                              | Change                                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------ |
| `src/lib/ai/write/schema.ts`      | `move_item` in both `proposedActionSchema` and `validatedActionSchema`               |
| `src/lib/ai/write/resolve.ts`     | `resolveMoveItem` — validates board membership of item and group, builds the summary |
| `src/lib/ai/write/write-tools.ts` | `propose_move_item` tool definition, its args schema, and the executor branch        |
| `src/lib/ai/write/execute.ts`     | the `move_item` case, delegating to `moveItem`                                       |

**Test files** (all exist; each gains cases): `resolve.test.ts`, `write-tools.test.ts`, `execute.test.ts`.

No file is created. Nothing else in the repo needs to change — `proposal-actions.ts` dispatches to `executeAction` without a per-kind switch, and `WRITE_TOOLS` is shared by both `/api/ask` (the dock and `/ask`) and `propose.ts` (⌘K), so one tool definition reaches every surface.

---

## Task 1: Schema and resolver

**Files:**

- Modify: `src/lib/ai/write/schema.ts`
- Modify: `src/lib/ai/write/resolve.ts`
- Test: `src/lib/ai/write/resolve.test.ts`

**Interfaces:**

- Consumes: `BoardPayload` from `@/lib/boards/queries` — `payload.groups: Group[]` (`id`, `name`) and `payload.items: Item[]` (`id`, `name`, `group_id`, `parent_id`). Note `getBoardPayload` already scopes both to one board, so "is this group on this board?" is answered by whether it appears in `payload.groups` — the resolver never reads a `board_id` off a group.
- Produces, for Tasks 2 and 3:
  - The `move_item` variant: `{ kind: "move_item"; boardId: string; itemId: string; groupId: string }` in `proposedActionSchema`, and the same plus `summary: string; warnings: string[]` in `validatedActionSchema`.
  - `resolveMoveItem(payload: BoardPayload, action: Extract<ProposedAction, { kind: "move_item" }>): Resolved` exported from `resolve.ts`. Note it takes **no** `members` argument — unlike `resolveCreateItem`/`resolveSetItemFields`, a move touches no people column.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/ai/write/resolve.test.ts`. That file builds its fixture as an inline literal cast `as unknown as BoardPayload` (line 6) and its module-level `payload` const has `items: []` and only one group — so it cannot serve these cases. Add a **second** fixture in the same idiom rather than editing the shared one, which the existing `pickFieldColumns` and `resolveCreateItem` cases depend on. Add `resolveMoveItem` to the import on line 3.

```ts
// Two groups and one top-level item — the shape a move needs. Same idiom as
// the module-level `payload` above; kept separate so the existing cases that
// rely on `items: []` and a single group are untouched.
const movePayload = {
  board: { id: "b1", name: "Roadmap" },
  groups: [
    { id: "g-backlog", name: "Backlog" },
    { id: "g-software", name: "Software" },
  ],
  columns: [],
  items: [
    { id: "i-qysea", name: "QYSEA", group_id: "g-backlog", parent_id: null },
  ],
  cellValues: [],
} as unknown as BoardPayload;

describe("resolveMoveItem", () => {
  it("summarises the move with both group names", () => {
    const r = resolveMoveItem(movePayload, {
      kind: "move_item",
      boardId: "b1",
      itemId: "i-qysea",
      groupId: "g-software",
    });
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    expect(r.action.summary).toBe('Move "QYSEA" from Backlog to Software');
    expect(r.action.warnings).toEqual([]);
  });

  it("refuses an item that is not on this board", () => {
    const r = resolveMoveItem(movePayload, {
      kind: "move_item",
      boardId: "b1",
      itemId: "i-elsewhere",
      groupId: "g-software",
    });
    expect(r).toEqual({
      kind: "error",
      error: "That item isn't on this board.",
    });
  });

  it("refuses a group that is not on this board — the cross-board guard", () => {
    const r = resolveMoveItem(movePayload, {
      kind: "move_item",
      boardId: "b1",
      itemId: "i-qysea",
      groupId: "g-on-another-board",
    });
    expect(r).toEqual({
      kind: "error",
      error:
        "That group isn't on this board. Moving an item between boards isn't supported.",
    });
  });

  it("refuses a subitem, matching what moveItem itself enforces", () => {
    const withSub = {
      ...movePayload,
      items: [
        {
          id: "i-sub",
          name: "Sub",
          group_id: "g-backlog",
          parent_id: "i-qysea",
        },
      ],
    } as unknown as BoardPayload;
    const r = resolveMoveItem(withSub, {
      kind: "move_item",
      boardId: "b1",
      itemId: "i-sub",
      groupId: "g-software",
    });
    expect(r).toEqual({
      kind: "error",
      error: "Subitems can't be moved between groups.",
    });
  });

  it("refuses a move to the group the item is already in", () => {
    const r = resolveMoveItem(movePayload, {
      kind: "move_item",
      boardId: "b1",
      itemId: "i-qysea",
      groupId: "g-backlog",
    });
    expect(r).toEqual({
      kind: "error",
      error: "QYSEA is already in Backlog.",
    });
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm vitest run src/lib/ai/write/resolve.test.ts`
Expected: FAIL — `resolveMoveItem` is not exported.

- [ ] **Step 3: Add the schema variant**

In `src/lib/ai/write/schema.ts`, add to `proposedActionSchema`'s union (after the `set_item_fields` member):

```ts
  z.object({
    kind: z.literal("move_item"),
    boardId: z.string(),
    itemId: z.string(),
    groupId: z.string(),
  }),
```

and the mirror in `validatedActionSchema`, with `...validatedExtras`:

```ts
  z.object({
    kind: z.literal("move_item"),
    boardId: z.string(),
    itemId: z.string(),
    groupId: z.string(),
    ...validatedExtras,
  }),
```

- [ ] **Step 4: Add the resolver**

In `src/lib/ai/write/resolve.ts`, after `resolveSetItemFields`:

```ts
/**
 * Validate a proposed move and describe it for the confirm card.
 *
 * Every refusal here is a message the model relays to the user, so each says
 * what is wrong rather than just that something is. The cross-board case is
 * called out by name: it is the one a user is most likely to attempt, and
 * "isn't on this board" alone reads like a bug rather than a boundary.
 *
 * These checks duplicate `moveItem`'s own guards deliberately. moveItem is the
 * enforcement (it runs after the user confirms, under RLS); this is the
 * PREVIEW — catching it here means the user never sees a confirm card for a
 * move that cannot happen.
 */
export function resolveMoveItem(
  payload: BoardPayload,
  action: Extract<ProposedAction, { kind: "move_item" }>,
): Resolved {
  const item = payload.items.find((i) => i.id === action.itemId);
  if (!item) return { kind: "error", error: "That item isn't on this board." };
  if (item.parent_id !== null)
    return { kind: "error", error: "Subitems can't be moved between groups." };

  const target = payload.groups.find((g) => g.id === action.groupId);
  if (!target)
    return {
      kind: "error",
      error:
        "That group isn't on this board. Moving an item between boards isn't supported.",
    };

  const from = payload.groups.find((g) => g.id === item.group_id);
  if (target.id === item.group_id)
    return {
      kind: "error",
      error: `${item.name} is already in ${from?.name ?? "that group"}.`,
    };

  return {
    kind: "ok",
    action: {
      ...action,
      summary: `Move "${item.name}" from ${from?.name ?? "its group"} to ${target.name}`,
      warnings: [],
    },
  };
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm vitest run src/lib/ai/write/resolve.test.ts`
Expected: PASS, including the pre-existing cases.

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: PASS. If `execute.ts` errors on a non-exhaustive switch over `ValidatedAction`, that is expected — Task 3 closes it. Note it and continue; do not patch `execute.ts` here.

- [ ] **Step 7: Commit**

```bash
git add src/lib/ai/write/schema.ts src/lib/ai/write/resolve.ts src/lib/ai/write/resolve.test.ts
git commit -m "feat(ai): move_item action shape and resolver"
```

---

## Task 2: The propose tool

**Files:**

- Modify: `src/lib/ai/write/write-tools.ts`
- Test: `src/lib/ai/write/write-tools.test.ts`

**Interfaces:**

- Consumes (Task 1): the `move_item` variant of `proposedActionSchema`, and `resolveMoveItem(payload, action)` — **two arguments, no `members`**.
- Produces: the `propose_move_item` entry in `WRITE_TOOLS`, and an executor branch that pushes the resolved action into `collected`.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/ai/write/write-tools.test.ts`, following that file's existing harness for building an executor and stubbing `getBoardPayload`.

```ts
describe("propose_move_item", () => {
  it("is offered to the model with board, item and group required", () => {
    const tool = WRITE_TOOLS.find((t) => t.name === "propose_move_item");
    expect(tool).toBeDefined();
    expect(tool!.input_schema.required).toEqual([
      "board_id",
      "item_id",
      "group_id",
    ]);
    // The description must say it does not write — the model relies on this to
    // explain the confirm step to the user.
    expect(tool!.description).toMatch(/does not write|user confirms/i);
  });

  it("records a proposal and returns the preview without mutating", async () => {
    const exec = createWriteToolExecutor({ orgId: "o1", workspaceId: "w1" });
    const res = await exec.execute("propose_move_item", {
      board_id: "b1",
      item_id: "i-qysea",
      group_id: "g-software",
    });
    expect(JSON.parse(res.content)).toEqual({
      preview: 'Move "QYSEA" from Backlog to Software',
      warnings: [],
    });
    expect(exec.collected()).toHaveLength(1);
    expect(exec.collected()[0]).toMatchObject({
      kind: "move_item",
      boardId: "b1",
      itemId: "i-qysea",
      groupId: "g-software",
    });
  });

  it("surfaces the resolver's refusal and records nothing", async () => {
    const exec = createWriteToolExecutor({ orgId: "o1", workspaceId: "w1" });
    const res = await exec.execute("propose_move_item", {
      board_id: "b1",
      item_id: "i-qysea",
      group_id: "g-on-another-board",
    });
    expect(JSON.parse(res.content).error).toMatch(/isn't on this board/);
    expect(exec.collected()).toHaveLength(0);
  });

  it("rejects malformed args", async () => {
    const exec = createWriteToolExecutor({ orgId: "o1", workspaceId: "w1" });
    const res = await exec.execute("propose_move_item", { board_id: "b1" });
    expect(JSON.parse(res.content)).toEqual({ error: "invalid tool input" });
    expect(exec.collected()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm vitest run src/lib/ai/write/write-tools.test.ts`
Expected: FAIL — no such tool, executor returns `{"error":"unknown tool"}`.

- [ ] **Step 3: Add the tool definition**

In `src/lib/ai/write/write-tools.ts`, append to `WRITE_TOOLS` (after `propose_set_item_fields`):

```ts
  {
    name: "propose_move_item",
    description:
      "Propose moving an existing item to a different group on the SAME board. Does NOT write — the user confirms first. Resolve item_id and group_id via get_board_overview before calling. Moving an item to another board is not supported.",
    input_schema: {
      type: "object",
      properties: {
        board_id: { type: "string" },
        item_id: { type: "string" },
        group_id: {
          type: "string",
          description: "UUID of the destination group, on the same board.",
        },
      },
      required: ["board_id", "item_id", "group_id"],
      additionalProperties: false,
    },
  },
```

- [ ] **Step 4: Add the args schema and the executor branch**

Beside the other `*Args` schemas:

```ts
const moveItemArgs = z.object({
  board_id: z.string(),
  item_id: z.string(),
  group_id: z.string(),
});
```

Import `resolveMoveItem` alongside the existing resolvers, then add this branch after the `propose_set_item_fields` branch:

```ts
if (name === "propose_move_item") {
  const a = moveItemArgs.safeParse(input);
  if (!a.success) return err("invalid tool input");
  const parsed = proposedActionSchema.safeParse({
    kind: "move_item",
    boardId: a.data.board_id,
    itemId: a.data.item_id,
    groupId: a.data.group_id,
  });
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "invalid");
  const payload = await getBoardPayload(a.data.board_id);
  if (!payload) return err("board not found");
  // No `members` argument — a move touches no people column.
  const r = resolveMoveItem(
    payload,
    parsed.data as Extract<typeof parsed.data, { kind: "move_item" }>,
  );
  if (r.kind === "error") return err(r.error);
  collected.push(r.action);
  return {
    content: JSON.stringify({
      preview: r.action.summary,
      warnings: r.action.warnings,
    }),
  };
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm vitest run src/lib/ai/write/write-tools.test.ts`
Expected: PASS, including the pre-existing cases.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ai/write/write-tools.ts src/lib/ai/write/write-tools.test.ts
git commit -m "feat(ai): propose_move_item tool and executor branch"
```

---

## Task 3: Applying the move

**Files:**

- Modify: `src/lib/ai/write/execute.ts`
- Test: `src/lib/ai/write/execute.test.ts`

**Interfaces:**

- Consumes (Task 1): the `move_item` variant of `validatedActionSchema` — `{ kind, boardId, itemId, groupId, summary, warnings }`.
- Consumes (shipped): `moveItem(input: { itemId: string; groupId: string; position?: number }): Promise<ActionResult>` from `@/lib/boards/actions/item`.
- Produces: nothing downstream — this is the leaf.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/ai/write/execute.test.ts`, following its existing mocking of `@/lib/boards/actions/item`.

```ts
describe("executeAction — move_item", () => {
  it("delegates to moveItem with no position, so the item appends to the target group", async () => {
    moveItemMock.mockResolvedValue({ ok: true, data: undefined });
    const res = await executeAction({
      kind: "move_item",
      boardId: "b1",
      itemId: "i-qysea",
      groupId: "g-software",
      summary: 'Move "QYSEA" from Backlog to Software',
      warnings: [],
    });
    expect(moveItemMock).toHaveBeenCalledWith({
      itemId: "i-qysea",
      groupId: "g-software",
    });
    expect(res).toEqual({ ok: true, itemId: "i-qysea" });
  });

  it("surfaces moveItem's refusal verbatim rather than a generic failure", async () => {
    // moveItem is the enforcement: it re-checks the board under RLS after the
    // user confirms, so its error is the one that matters and must not be
    // swallowed or reworded.
    moveItemMock.mockResolvedValue({
      ok: false,
      error: "Group belongs to a different board.",
    });
    const res = await executeAction({
      kind: "move_item",
      boardId: "b1",
      itemId: "i-qysea",
      groupId: "g-elsewhere",
      summary: "Move …",
      warnings: [],
    });
    expect(res).toEqual({
      ok: false,
      error: "Group belongs to a different board.",
    });
  });

  it("never touches the cell writer — a move changes no field values", async () => {
    moveItemMock.mockResolvedValue({ ok: true, data: undefined });
    await executeAction({
      kind: "move_item",
      boardId: "b1",
      itemId: "i-qysea",
      groupId: "g-software",
      summary: "Move …",
      warnings: [],
    });
    expect(upsertCellMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm vitest run src/lib/ai/write/execute.test.ts`
Expected: FAIL — `move_item` falls through to the `set_item_fields` tail and calls `applyFields`.

- [ ] **Step 3: Add the case**

In `src/lib/ai/write/execute.ts`, import `moveItem` alongside `createItem`, and add this branch **before** the `set_item_fields` tail comment (the function ends by assuming anything unhandled is `set_item_fields`, so a new kind must be handled above it or it will silently take that path):

```ts
if (action.kind === "move_item") {
  // moveItem owns the guards that matter after confirmation: it refuses
  // subitems, refuses a group on another board, and appends to the end of
  // the target group. Omitting `position` is what selects that append —
  // there is no drag-drop cursor here to honour.
  const r = await moveItem({
    itemId: action.itemId,
    groupId: action.groupId,
  });
  return r.ok
    ? { ok: true, itemId: action.itemId }
    : { ok: false, error: r.error };
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run src/lib/ai/write/execute.test.ts`
Expected: PASS.

- [ ] **Step 5: Run every gate**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: all green. `pnpm test` (not just the three files) is required here — this task closes the exhaustiveness of `executeAction`'s dispatch, and the surfaces that consume it (`proposal-actions.ts`, `/api/ask`) have their own suites elsewhere in the tree.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ai/write/execute.ts src/lib/ai/write/execute.test.ts
git commit -m "feat(ai): apply a proposed move through the canonical moveItem action"
```

---

## Execution DAG

**Dependency graph:** Task 1 → {Task 2, Task 3}. Tasks 2 and 3 touch disjoint files and share nothing but Task 1's types.

| Batch | Tasks              | Notes                                                               |
| ----- | ------------------ | ------------------------------------------------------------------- |
| 1     | **Task 1**         | Schema + resolver. The wall-clock floor; both others need its types |
| 2     | **Task 2, Task 3** | Two concurrent agents, disjoint files                               |
| 3     | Gates + merge      | Single serialising step                                             |

**Critical path:** 1 → 2 (or 3) → gates.

Because Task 1 leaves `execute.ts` non-exhaustive until Task 3 lands, **Task 2's implementer must not "fix" a typecheck error in `execute.ts`** — it belongs to Task 3. This is stated in Task 1 Step 6 and repeated here because it is the one way these two parallel tasks can collide.

---

## How to test (manual acceptance, post-merge)

1. Pull `develop`. Open a board that has at least two groups and one top-level item.
2. Open the agent dock (or `/ask`) and say: **"move &lt;item&gt; to &lt;other group&gt;"**.
3. Expect a **confirm card** reading `Move "&lt;item&gt;" from &lt;group&gt; to &lt;other group&gt;` — and confirm nothing has moved yet.
4. Approve, then **reload the board**. The item appears at the **bottom** of the target group; its updates, files and activity are intact.

   > The reload is required, and is not specific to moves: no action in
   > `src/lib/boards/actions/item.ts` calls `revalidatePath`, and the dock
   > deliberately suppresses `router.refresh()` so an approved turn does not
   > re-run the board's queries. All four write verbs behave this way. Making an
   > approved write visible in place is a real gap, but a systemic one — it needs
   > its own decision rather than a fix smuggled into this feature.

5. Ask to move it to the group it is already in. Expect a plain refusal, not a card.
6. Ask to move it to a group on a **different** board. Expect a refusal saying cross-board moves aren't supported — and no card.
7. Ask to move a **subitem**. Expect a refusal.
8. Reload mid-flow after step 3 without approving: the card survives and is still actionable.
