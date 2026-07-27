# E3 — Conversational Actions (F6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Load before UI tasks:** `pulse-ui` + `frontend-design` skills (Task 8 builds/styles UI).
> **Spec:** `docs/superpowers/specs/2026-07-12-e3-conversational-actions-design.md`

**Goal:** Turn a ⌘K natural-language command ("create task X due Friday for Dana in Backlog") into a **confirmed** structured write, via a shared headless write-action engine that the Ask-Monolith-full-page track will also consume.

**Architecture:** A surface-agnostic engine in `src/lib/ai/write/` (Zod proposal/validated schema → proposal-only write tools + F5 read tools → a tool-use `proposeLoop` that resolves names to ids → an `executeAction` mapper onto the canonical typed Server Actions `createItem`/`createGroup`/`upsertCell`). Two Server Actions (`proposeActions`, `executeActions`) bracket a **human Approve**. A lazy ⌘K "Run a command…" surface renders confirm cards. The model **never** mutates — every write is an RLS-enforced Server Action gated behind an explicit confirm.

**Tech Stack:** Next.js 16 App Router (RSC + Server Actions), React 19, Supabase (Postgres + RLS via cookie client), `@anthropic-ai/sdk` tool use, Zod, Zustand, Vitest + Testing Library, Tailwind v4 / shadcn (`pulse-ui`).

---

## File structure

| Path                                              | Responsibility                                                                                                         |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `src/lib/ai/write/schema.ts`                      | Zod `ProposedAction` union, `ProposedFields`, `ValidatedAction` (+`summary`/`warnings`), `ExecutionResult`             |
| `src/lib/ai/write/resolve.ts`                     | RLS-scoped id→label resolution + confirm-summary + ambiguity warnings over a board payload                             |
| `src/lib/ai/write/write-tools.ts`                 | Proposal-only Anthropic `Tool[]` + executors (record `ValidatedAction`, never mutate) + `list_board_members` read tool |
| `src/lib/ai/write/propose.ts`                     | Tool-use loop (F5 read tools + write tools) → `{ actions, clarification?, usage }`                                     |
| `src/lib/ai/write/execute.ts`                     | `executeAction(ValidatedAction)` → canonical `createItem`/`createGroup`/`upsertCell`; per-field `ExecutionResult`      |
| `src/lib/ai/write/actions.ts`                     | `proposeActions` / `executeActions` Server Actions (entitlement, re-validation)                                        |
| `src/components/ai/actions/QuickAction.tsx`       | Lazy ⌘K action composer (client state; propose→confirm→execute)                                                        |
| `src/components/ai/actions/ActionConfirmCard.tsx` | Reusable confirm card (summary + warnings + Approve/Cancel) — **exported for the full-page track**                     |
| `src/components/command-palette.tsx`              | Add "Actions" group + "Run a command…" entry that mounts `QuickAction`                                                 |
| `src/stores/ui.ts`                                | (if needed) an `actionModeOpen` flag for the palette body switch                                                       |

**No migration.** Writes go through existing tables via existing RPCs/actions; `ai_usage` records `feature = "conversational_action"` (free-text, no schema change).

## Execution DAG (working agreement #6)

- **Task 1 (`schema.ts`)** is the root — every other task imports its types. Unblocks everything.
- After Task 1, two chains run in parallel:
  - **Engine chain:** 2 (`resolve.ts`) → 3 (`write-tools.ts`) → 4 (`propose.ts`); and 5 (`execute.ts`) depends only on Task 1 (+ canonical actions) so runs alongside 2–4. Then 6 (`actions.ts`) depends on 4 + 5.
  - **UI chain:** 7 (`ActionConfirmCard`) depends only on Task 1's types → can start immediately; 8 (`QuickAction`) depends on 6 (the Server Actions) + 7.
- **Task 9 (⌘K wiring)** depends on 8 (the `QuickAction` component exists).
- **Task 10** = full gate + manual-test walkthrough.
- **Critical path:** 1 → 2 → 3 → 4 → 6 → 8 → 9 → 10.
- **Parallel batches:** Batch A = {1}. Batch B = {2, 5, 7}. Batch C = {3} (needs 2), then {4} (needs 3). Batch D = {6} (needs 4,5). Batch E = {8} (needs 6,7) → {9} → {10}.
- Only Task 9 touches `command-palette.tsx` / `src/stores/ui.ts` / `app-shell.tsx` — **serialize it** and reconcile against the Ask-full-page ⌘K repoint if that has merged (see spec "boundary" §3). Everything in `src/lib/ai/write/**` and `src/components/ai/actions/**` is net-new and collision-free.

---

## Task 1: Proposal + validated-action schema

**Files:**

- Create: `src/lib/ai/write/schema.ts`
- Test: `src/lib/ai/write/schema.test.ts`

**Interfaces:**

- Consumes: `zod`.
- Produces: `ProposedAction`, `ProposedFields`, `ValidatedAction`, `ExecutionResult`, `validatedActionSchema` (used by `executeActions` to re-validate the client array).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { proposedActionSchema, validatedActionSchema } from "./schema";

describe("proposedActionSchema", () => {
  it("accepts a create_item with fields", () => {
    const r = proposedActionSchema.safeParse({
      kind: "create_item",
      boardId: "b1",
      groupId: "g1",
      name: "Ship v2",
      fields: {
        ownerUserIds: ["u1"],
        dueDate: "2026-07-17",
        statusOptionId: "o1",
      },
    });
    expect(r.success).toBe(true);
  });

  it("rejects a non-ISO dueDate", () => {
    const r = proposedActionSchema.safeParse({
      kind: "create_item",
      boardId: "b1",
      groupId: "g1",
      name: "X",
      fields: { dueDate: "Friday" },
    });
    expect(r.success).toBe(false);
  });

  it("rejects an unknown kind", () => {
    expect(
      proposedActionSchema.safeParse({ kind: "delete_item", boardId: "b1" })
        .success,
    ).toBe(false);
  });
});

describe("validatedActionSchema", () => {
  it("requires a summary and warnings array", () => {
    const r = validatedActionSchema.safeParse({
      kind: "create_group",
      boardId: "b1",
      name: "Backlog",
      summary: "Create group 'Backlog'",
      warnings: [],
    });
    expect(r.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test src/lib/ai/write/schema.test`
Expected: FAIL ("Cannot find module './schema'").

- [ ] **Step 3: Implement**

```ts
import { z } from "zod";

// ISO calendar date (YYYY-MM-DD) — matches dateValueSchema's `date`.
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected an ISO date (YYYY-MM-DD).");

export const proposedFieldsSchema = z.object({
  ownerUserIds: z.array(z.string()).optional(),
  dueDate: isoDate.optional(),
  endDate: isoDate.optional(),
  statusOptionId: z.string().nullable().optional(),
});
export type ProposedFields = z.infer<typeof proposedFieldsSchema>;

export const proposedActionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("create_item"),
    boardId: z.string(),
    groupId: z.string(),
    name: z.string().min(1).max(255),
    fields: proposedFieldsSchema.optional(),
  }),
  z.object({
    kind: z.literal("set_item_fields"),
    boardId: z.string(),
    itemId: z.string(),
    fields: proposedFieldsSchema,
  }),
  z.object({
    kind: z.literal("create_group"),
    boardId: z.string(),
    name: z.string().min(1).max(255),
  }),
]);
export type ProposedAction = z.infer<typeof proposedActionSchema>;

const validatedExtras = { summary: z.string(), warnings: z.array(z.string()) };
export const validatedActionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("create_item"),
    boardId: z.string(),
    groupId: z.string(),
    name: z.string().min(1).max(255),
    fields: proposedFieldsSchema.optional(),
    ...validatedExtras,
  }),
  z.object({
    kind: z.literal("set_item_fields"),
    boardId: z.string(),
    itemId: z.string(),
    fields: proposedFieldsSchema,
    ...validatedExtras,
  }),
  z.object({
    kind: z.literal("create_group"),
    boardId: z.string(),
    name: z.string().min(1).max(255),
    ...validatedExtras,
  }),
]);
export type ValidatedAction = z.infer<typeof validatedActionSchema>;

export type ExecutionResult =
  | { ok: true; itemId?: string }
  | { ok: false; error: string };
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test src/lib/ai/write/schema.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/write/schema.ts src/lib/ai/write/schema.test.ts
git commit -m "feat(ai): conversational-action proposal + validated-action schema"
```

---

## Task 2: Name/id resolution + confirm-summary (`resolve.ts`)

**Files:**

- Create: `src/lib/ai/write/resolve.ts`
- Test: `src/lib/ai/write/resolve.test.ts`

**Interfaces:**

- Consumes: `ProposedAction`/`ProposedFields`/`ValidatedAction` (Task 1); `getBoardPayload` (`@/lib/boards/queries`); `buildBoardSnapshot` (`@/lib/ai/board-snapshot`) for column-kind lookup.
- Produces: `resolveCreateItem`, `resolveSetItemFields`, `resolveCreateGroup` → each returns a `ValidatedAction` (or a `{ error }`); plus `pickFieldColumns(payload)` mapping field → `columnId` with warnings for `>1` candidate.

Pure over an injected board payload (no network in tests). The Server-side write-tool executors (Task 3) fetch the payload and pass it in.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { pickFieldColumns, resolveCreateItem } from "./resolve";

// Minimal board payload shape the resolver reads (mirror getBoardPayload's return).
const payload = {
  board: { id: "b1", name: "Roadmap" },
  groups: [{ id: "g1", name: "Backlog" }],
  columns: [
    { id: "c-due", name: "Due", kind: "date" },
    {
      id: "c-status",
      name: "Status",
      kind: "status",
      settings: { options: [{ id: "o1", label: "In progress" }] },
    },
    { id: "c-owner", name: "Owner", kind: "people" },
  ],
  items: [],
  cellValues: [],
} as any;

const members = [{ userId: "u1", name: "Dana Ruiz" }];

describe("pickFieldColumns", () => {
  it("maps date/status/people kinds to their column ids", () => {
    const { dateColumnId, statusColumnId, peopleColumnId, warnings } =
      pickFieldColumns(payload);
    expect(dateColumnId).toBe("c-due");
    expect(statusColumnId).toBe("c-status");
    expect(peopleColumnId).toBe("c-owner");
    expect(warnings).toEqual([]);
  });
});

describe("resolveCreateItem", () => {
  it("builds a summary + resolves owner/status labels", () => {
    const v = resolveCreateItem(payload, members, {
      kind: "create_item",
      boardId: "b1",
      groupId: "g1",
      name: "Ship v2",
      fields: {
        ownerUserIds: ["u1"],
        dueDate: "2026-07-17",
        statusOptionId: "o1",
      },
    });
    expect(v.kind).toBe("ok");
    if (v.kind !== "ok") return;
    expect(v.action.summary).toContain("Ship v2");
    expect(v.action.summary).toContain("Backlog");
    expect(v.action.summary).toContain("Dana Ruiz");
    expect(v.action.warnings).toEqual([]);
  });

  it("errors when the group is not on the board", () => {
    const v = resolveCreateItem(payload, members, {
      kind: "create_item",
      boardId: "b1",
      groupId: "nope",
      name: "X",
    });
    expect(v.kind).toBe("error");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test src/lib/ai/write/resolve.test`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
import "server-only";
import type { ProposedAction, ProposedFields, ValidatedAction } from "./schema";

export type BoardPayload = Awaited<
  ReturnType<typeof import("@/lib/boards/queries").getBoardPayload>
>;
export type Member = { userId: string; name: string };
type Resolved =
  | { kind: "ok"; action: ValidatedAction }
  | { kind: "error"; error: string };

/** Pick the board's date/status/people columns by kind. >1 candidate → warn + prefer a name hint. */
export function pickFieldColumns(payload: NonNullable<BoardPayload>): {
  dateColumnId: string | null;
  statusColumnId: string | null;
  peopleColumnId: string | null;
  warnings: string[];
} {
  const warnings: string[] = [];
  const byKind = (kind: string, hints: string[]) => {
    const cols = payload.columns.filter((c) => c.kind === kind);
    if (cols.length <= 1) return cols[0]?.id ?? null;
    const hinted =
      cols.find((c) => hints.some((h) => c.name.toLowerCase().includes(h))) ??
      cols[0];
    warnings.push(
      `Board has ${cols.length} ${kind} columns — used "${hinted.name}".`,
    );
    return hinted.id;
  };
  return {
    dateColumnId: byKind("date", ["due", "deadline", "date"]),
    statusColumnId: byKind("status", ["status", "state"]),
    peopleColumnId: byKind("people", ["owner", "assignee", "people"]),
    warnings,
  };
}

function fieldSummary(
  payload: NonNullable<BoardPayload>,
  members: Member[],
  fields: ProposedFields | undefined,
): { parts: string[]; warnings: string[] } {
  const parts: string[] = [];
  const warnings: string[] = [];
  if (!fields) return { parts, warnings };
  if (fields.dueDate) parts.push(`due ${fields.dueDate}`);
  if (fields.ownerUserIds?.length) {
    const names = fields.ownerUserIds.map(
      (id) => members.find((m) => m.userId === id)?.name ?? "someone",
    );
    parts.push(`owner ${names.join(", ")}`);
  }
  if (fields.statusOptionId) {
    const opt = payload.columns
      .flatMap(
        (c) =>
          (c.settings as { options?: { id: string; label: string }[] } | null)
            ?.options ?? [],
      )
      .find((o) => o.id === fields.statusOptionId);
    parts.push(`status ${opt?.label ?? fields.statusOptionId}`);
  }
  return { parts, warnings };
}

export function resolveCreateItem(
  payload: NonNullable<BoardPayload>,
  members: Member[],
  action: Extract<ProposedAction, { kind: "create_item" }>,
): Resolved {
  const group = payload.groups.find((g) => g.id === action.groupId);
  if (!group)
    return { kind: "error", error: "That group isn't on this board." };
  const { parts, warnings } = fieldSummary(payload, members, action.fields);
  const suffix = parts.length ? ` · ${parts.join(" · ")}` : "";
  return {
    kind: "ok",
    action: {
      ...action,
      summary: `Create task "${action.name}" in ${group.name}${suffix}`,
      warnings,
    },
  };
}

export function resolveSetItemFields(
  payload: NonNullable<BoardPayload>,
  members: Member[],
  action: Extract<ProposedAction, { kind: "set_item_fields" }>,
): Resolved {
  const item = payload.items.find((i) => i.id === action.itemId);
  if (!item) return { kind: "error", error: "That item isn't on this board." };
  const { parts, warnings } = fieldSummary(payload, members, action.fields);
  return {
    kind: "ok",
    action: {
      ...action,
      summary: `Update "${item.name}"${parts.length ? ` · ${parts.join(" · ")}` : ""}`,
      warnings,
    },
  };
}

export function resolveCreateGroup(
  payload: NonNullable<BoardPayload>,
  action: Extract<ProposedAction, { kind: "create_group" }>,
): Resolved {
  return {
    kind: "ok",
    action: {
      ...action,
      summary: `Create group "${action.name}" on ${payload.board.name}`,
      warnings: [],
    },
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test src/lib/ai/write/resolve.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/write/resolve.ts src/lib/ai/write/resolve.test.ts
git commit -m "feat(ai): resolve conversational actions to validated actions with confirm summaries"
```

---

## Task 3: Proposal-only write tools + `list_board_members` read tool

**Files:**

- Create: `src/lib/ai/write/write-tools.ts`
- Test: `src/lib/ai/write/write-tools.test.ts`

**Interfaces:**

- Consumes: Task 1 schema; Task 2 resolvers; `getBoardPayload` (`@/lib/boards/queries`); `listOrgMembersCached` (`@/lib/org/queries-cached`); `dateValueSchema` (`@/lib/validations/boards`).
- Produces: `WRITE_TOOLS: Anthropic.Tool[]`, `LIST_MEMBERS_TOOL`, `createWriteToolExecutor(ctx)` returning `{ execute(name, input), collected(): ValidatedAction[] }`. The executor **records** proposals (never mutates) and returns a preview.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/boards/queries", () => ({
  getBoardPayload: vi.fn(async () => ({
    board: { id: "b1", name: "Roadmap" },
    groups: [{ id: "g1", name: "Backlog" }],
    columns: [{ id: "c-due", name: "Due", kind: "date" }],
    items: [],
    cellValues: [],
  })),
}));
vi.mock("@/lib/org/queries-cached", () => ({
  listOrgMembersCached: vi.fn(async () => [
    { user_id: "u1", full_name: "Dana Ruiz" },
  ]),
}));

import { createWriteToolExecutor } from "./write-tools";

it("propose_create_item records a ValidatedAction and never mutates", async () => {
  const exec = createWriteToolExecutor({ orgId: "org1", workspaceId: "ws1" });
  const res = await exec.execute("propose_create_item", {
    board_id: "b1",
    group_id: "g1",
    name: "Ship v2",
    due_date: "2026-07-17",
  });
  expect(res.content).toContain("Ship v2");
  const collected = exec.collected();
  expect(collected).toHaveLength(1);
  expect(collected[0].kind).toBe("create_item");
  expect(collected[0].summary).toContain("Backlog");
});

it("returns an error preview when the board isn't found", async () => {
  const { getBoardPayload } = await import("@/lib/boards/queries");
  (getBoardPayload as any).mockResolvedValueOnce(null);
  const exec = createWriteToolExecutor({ orgId: "org1", workspaceId: "ws1" });
  const res = await exec.execute("propose_create_item", {
    board_id: "x",
    group_id: "g",
    name: "n",
  });
  expect(res.content).toContain("error");
  expect(exec.collected()).toHaveLength(0);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test src/lib/ai/write/write-tools.test`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { getBoardPayload } from "@/lib/boards/queries";
import { listOrgMembersCached } from "@/lib/org/queries-cached";
import { proposedActionSchema, type ValidatedAction } from "./schema";
import {
  resolveCreateItem,
  resolveSetItemFields,
  resolveCreateGroup,
  type Member,
} from "./resolve";

export const LIST_MEMBERS_TOOL: Anthropic.Tool = {
  name: "list_board_members",
  description:
    "List members who can be assigned as owners on a board. Returns userId and name. Use this to resolve a person's name to their userId before proposing an owner.",
  input_schema: {
    type: "object",
    properties: {
      board_id: { type: "string", description: "UUID of the board." },
    },
    required: ["board_id"],
    additionalProperties: false,
  },
};

export const WRITE_TOOLS: Anthropic.Tool[] = [
  {
    name: "propose_create_item",
    description:
      "Propose creating a task/item in a group. Does NOT create it — the user confirms first. Resolve board_id/group_id via list_boards + get_board_overview and owner userIds via list_board_members before calling.",
    input_schema: {
      type: "object",
      properties: {
        board_id: { type: "string" },
        group_id: { type: "string" },
        name: { type: "string" },
        owner_user_ids: { type: "array", items: { type: "string" } },
        due_date: { type: "string", description: "ISO date YYYY-MM-DD." },
        status_option_id: { type: "string" },
      },
      required: ["board_id", "group_id", "name"],
      additionalProperties: false,
    },
  },
  {
    name: "propose_set_item_fields",
    description:
      "Propose updating an existing item's owner/due date/status. Does NOT write — the user confirms first.",
    input_schema: {
      type: "object",
      properties: {
        board_id: { type: "string" },
        item_id: { type: "string" },
        owner_user_ids: { type: "array", items: { type: "string" } },
        due_date: { type: "string", description: "ISO date YYYY-MM-DD." },
        status_option_id: { type: "string" },
      },
      required: ["board_id", "item_id"],
      additionalProperties: false,
    },
  },
  {
    name: "propose_create_group",
    description:
      "Propose creating a new group (section) on a board. Does NOT write — the user confirms first.",
    input_schema: {
      type: "object",
      properties: { board_id: { type: "string" }, name: { type: "string" } },
      required: ["board_id", "name"],
      additionalProperties: false,
    },
  },
];

const err = (message: string) => ({
  content: JSON.stringify({ error: message }),
});

// Map the model's snake_case tool args into the ProposedAction shape, then Zod-parse.
const createItemArgs = z.object({
  board_id: z.string(),
  group_id: z.string(),
  name: z.string(),
  owner_user_ids: z.array(z.string()).optional(),
  due_date: z.string().optional(),
  status_option_id: z.string().optional(),
});
const setFieldsArgs = z.object({
  board_id: z.string(),
  item_id: z.string(),
  owner_user_ids: z.array(z.string()).optional(),
  due_date: z.string().optional(),
  status_option_id: z.string().optional(),
});
const createGroupArgs = z.object({ board_id: z.string(), name: z.string() });

async function membersFor(orgId: string): Promise<Member[]> {
  const rows = await listOrgMembersCached(orgId);
  return rows.map((r: { user_id: string; full_name: string | null }) => ({
    userId: r.user_id,
    name: r.full_name ?? "Unknown",
  }));
}

/** Build a per-request executor: records proposals, never mutates. Read tools handle name resolution. */
export function createWriteToolExecutor(ctx: {
  orgId: string;
  workspaceId: string;
}) {
  const collected: ValidatedAction[] = [];

  async function listMembers(input: unknown): Promise<{ content: string }> {
    const parsed = z.object({ board_id: z.string() }).safeParse(input);
    if (!parsed.success) return err("invalid tool input");
    const members = await membersFor(ctx.orgId);
    return { content: JSON.stringify(members) };
  }

  async function execute(
    name: string,
    input: unknown,
  ): Promise<{ content: string }> {
    try {
      if (name === "list_board_members") return await listMembers(input);

      if (name === "propose_create_item") {
        const a = createItemArgs.safeParse(input);
        if (!a.success) return err("invalid tool input");
        const parsed = proposedActionSchema.safeParse({
          kind: "create_item",
          boardId: a.data.board_id,
          groupId: a.data.group_id,
          name: a.data.name,
          fields: {
            ownerUserIds: a.data.owner_user_ids,
            dueDate: a.data.due_date,
            statusOptionId: a.data.status_option_id,
          },
        });
        if (!parsed.success)
          return err(parsed.error.issues[0]?.message ?? "invalid");
        const payload = await getBoardPayload(a.data.board_id);
        if (!payload) return err("board not found");
        const r = resolveCreateItem(
          payload,
          await membersFor(ctx.orgId),
          parsed.data as never,
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

      if (name === "propose_set_item_fields") {
        const a = setFieldsArgs.safeParse(input);
        if (!a.success) return err("invalid tool input");
        const parsed = proposedActionSchema.safeParse({
          kind: "set_item_fields",
          boardId: a.data.board_id,
          itemId: a.data.item_id,
          fields: {
            ownerUserIds: a.data.owner_user_ids,
            dueDate: a.data.due_date,
            statusOptionId: a.data.status_option_id,
          },
        });
        if (!parsed.success)
          return err(parsed.error.issues[0]?.message ?? "invalid");
        const payload = await getBoardPayload(a.data.board_id);
        if (!payload) return err("board not found");
        const r = resolveSetItemFields(
          payload,
          await membersFor(ctx.orgId),
          parsed.data as never,
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

      if (name === "propose_create_group") {
        const a = createGroupArgs.safeParse(input);
        if (!a.success) return err("invalid tool input");
        const payload = await getBoardPayload(a.data.board_id);
        if (!payload) return err("board not found");
        const r = resolveCreateGroup(payload, {
          kind: "create_group",
          boardId: a.data.board_id,
          name: a.data.name,
        });
        if (r.kind === "error") return err(r.error);
        collected.push(r.action);
        return {
          content: JSON.stringify({
            preview: r.action.summary,
            warnings: r.action.warnings,
          }),
        };
      }

      return err("unknown tool");
    } catch (e) {
      console.error("[write] tool failed:", name, e);
      return err("tool failed");
    }
  }

  return { execute, collected: () => collected };
}
```

> Note: confirm `listOrgMembersCached`'s row shape (`user_id` / `full_name`) against `src/lib/org/queries-cached.ts` when implementing; adjust the `membersFor` mapping if the columns differ.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test src/lib/ai/write/write-tools.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/write/write-tools.ts src/lib/ai/write/write-tools.test.ts
git commit -m "feat(ai): proposal-only write tools + list_board_members read tool"
```

---

## Task 4: Propose loop (`propose.ts`)

**Files:**

- Create: `src/lib/ai/write/propose.ts`
- Test: `src/lib/ai/write/propose.test.ts`

**Interfaces:**

- Consumes: `ASK_TOOLS` + `executeAskTool` (`@/lib/ai/ask/tools` — reused unchanged); `WRITE_TOOLS` + `LIST_MEMBERS_TOOL` + `createWriteToolExecutor` (Task 3); `MODEL` (`@/lib/ai/providers/anthropic`); `AiUsageTokens` (`@/lib/ai/pricing`).
- Produces: `proposeLoop({ apiKey, orgId, workspaceId, instruction, now?, timezone?, client? }) → { actions: ValidatedAction[]; clarification?: string; usage: AiUsageTokens }`.

Mirror `askPulseLoop`: same `MAX_ROUNDS = 6`, usage summed, DI'd client. Read tools (`ASK_TOOLS` + `LIST_MEMBERS_TOOL`) execute for real; write tools record proposals. When the model stops with no proposals, its final text is the `clarification`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/ask/tools", () => ({
  ASK_TOOLS: [
    { name: "list_boards", input_schema: { type: "object", properties: {} } },
  ],
  executeAskTool: vi.fn(async () => ({
    content: JSON.stringify([{ id: "b1", name: "Roadmap" }]),
  })),
}));
vi.mock("./write-tools", () => ({
  WRITE_TOOLS: [
    {
      name: "propose_create_item",
      input_schema: { type: "object", properties: {} },
    },
  ],
  LIST_MEMBERS_TOOL: {
    name: "list_board_members",
    input_schema: { type: "object", properties: {} },
  },
  createWriteToolExecutor: vi.fn(() => ({
    execute: vi.fn(async () => ({ content: "{}" })),
    collected: () => [
      {
        kind: "create_item",
        boardId: "b1",
        groupId: "g1",
        name: "Ship v2",
        summary: 'Create task "Ship v2" in Backlog',
        warnings: [],
      },
    ],
  })),
}));

import { proposeLoop } from "./propose";

// Fake Anthropic: round 1 → tool_use (list_boards then propose_create_item); round 2 → end_turn.
function fakeClient() {
  let round = 0;
  return {
    messages: {
      create: vi.fn(async () => {
        round++;
        if (round === 1) {
          return {
            stop_reason: "tool_use",
            content: [
              { type: "tool_use", id: "t1", name: "list_boards", input: {} },
              {
                type: "tool_use",
                id: "t2",
                name: "propose_create_item",
                input: { board_id: "b1", group_id: "g1", name: "Ship v2" },
              },
            ],
            usage: { input_tokens: 10, output_tokens: 5 },
          };
        }
        return {
          stop_reason: "end_turn",
          content: [{ type: "text", text: "Ready to create." }],
          usage: { input_tokens: 3, output_tokens: 2 },
        };
      }),
    },
  };
}

it("returns collected proposals and sums usage", async () => {
  const res = await proposeLoop({
    apiKey: "k",
    orgId: "org1",
    workspaceId: "ws1",
    instruction: "create task Ship v2 in Backlog",
    client: fakeClient() as never,
  });
  expect(res.actions).toHaveLength(1);
  expect(res.actions[0].name).toBe("Ship v2");
  expect(res.usage).toEqual({ inputTokens: 13, outputTokens: 7 });
});

it("returns a clarification when the model proposes nothing", async () => {
  const client = {
    messages: {
      create: vi.fn(async () => ({
        stop_reason: "end_turn",
        content: [{ type: "text", text: "Which board?" }],
        usage: { input_tokens: 1, output_tokens: 1 },
      })),
    },
  };
  const { createWriteToolExecutor } = await import("./write-tools");
  (createWriteToolExecutor as any).mockReturnValueOnce({
    execute: vi.fn(),
    collected: () => [],
  });
  const res = await proposeLoop({
    apiKey: "k",
    orgId: "o",
    workspaceId: "w",
    instruction: "do a thing",
    client: client as never,
  });
  expect(res.actions).toHaveLength(0);
  expect(res.clarification).toBe("Which board?");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test src/lib/ai/write/propose.test`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { MODEL } from "@/lib/ai/providers/anthropic";
import { ASK_TOOLS, executeAskTool } from "@/lib/ai/ask/tools";
import {
  WRITE_TOOLS,
  LIST_MEMBERS_TOOL,
  createWriteToolExecutor,
} from "./write-tools";
import type { ValidatedAction } from "./schema";
import type { AiUsageTokens } from "@/lib/ai/pricing";

const MAX_ROUNDS = 6;
const READ_TOOL_NAMES = new Set(
  ASK_TOOLS.map((t) => t.name).concat("list_board_members"),
);

function textOf(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

function systemPrompt(now: string, timezone: string): string {
  return [
    "You turn a user's natural-language command into PROPOSED board writes.",
    `Today is ${now} (timezone ${timezone}). Resolve relative dates like "Friday" to an ISO date (YYYY-MM-DD).`,
    "First use the read tools (list_boards, get_board_overview, list_board_members) to resolve the exact board, group, status option, and owner userIds. get_board_overview decodes status option labels.",
    "Then call a propose_* tool with the resolved ids. NEVER assume ids you haven't read.",
    "The propose_* tools do NOT write — the user confirms before anything happens.",
    "If the target board/group is ambiguous or you can't find it, DO NOT propose — reply with a short question instead.",
  ].join("\n");
}

export async function proposeLoop(args: {
  apiKey: string;
  orgId: string;
  workspaceId: string;
  instruction: string;
  now?: string;
  timezone?: string;
  client?: Anthropic;
}): Promise<{
  actions: ValidatedAction[];
  clarification?: string;
  usage: AiUsageTokens;
}> {
  const client = args.client ?? new Anthropic({ apiKey: args.apiKey });
  const writer = createWriteToolExecutor({
    orgId: args.orgId,
    workspaceId: args.workspaceId,
  });
  const tools = [...ASK_TOOLS, LIST_MEMBERS_TOOL, ...WRITE_TOOLS];
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: args.instruction },
  ];
  const usage: AiUsageTokens = { inputTokens: 0, outputTokens: 0 };
  const system = systemPrompt(
    args.now ?? new Date().toISOString().slice(0, 10),
    args.timezone ?? "UTC",
  );

  let finalText = "";
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system,
      tools,
      messages,
    });
    usage.inputTokens += res.usage.input_tokens;
    usage.outputTokens += res.usage.output_tokens;

    if (res.stop_reason !== "tool_use") {
      finalText = textOf(res.content);
      break;
    }

    messages.push({ role: "assistant", content: res.content });
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of res.content) {
      if (block.type !== "tool_use") continue;
      const result =
        READ_TOOL_NAMES.has(block.name) && block.name !== "list_board_members"
          ? await executeAskTool(block.name, block.input, {
              workspaceId: args.workspaceId,
            })
          : await writer.execute(block.name, block.input);
      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: result.content,
      });
    }
    if (toolResults.length === 0) break;
    messages.push({ role: "user", content: toolResults });
  }

  const actions = writer.collected();
  return {
    actions,
    clarification: actions.length === 0 ? finalText || undefined : undefined,
    usage,
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test src/lib/ai/write/propose.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/write/propose.ts src/lib/ai/write/propose.test.ts
git commit -m "feat(ai): conversational-action propose loop (read tools + proposal write tools)"
```

---

## Task 5: Execute mapper (`execute.ts`)

**Files:**

- Create: `src/lib/ai/write/execute.ts`
- Test: `src/lib/ai/write/execute.test.ts`

**Interfaces:**

- Consumes: `ValidatedAction`/`ExecutionResult` (Task 1); canonical actions `createItem`, `createGroup` (`@/lib/boards/actions/item`, `.../group`), `upsertCell` (`@/lib/boards/actions/cell`); `getBoardPayload` for column-id lookup (or accept resolved column ids — see note). `pickFieldColumns` (Task 2).
- Produces: `executeAction(action: ValidatedAction) → Promise<ExecutionResult>`.

Depends only on Task 1 + Task 2 + the canonical actions — runs in parallel with Tasks 3–4.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";

const createItem = vi.fn(async () => ({
  ok: true,
  data: { item: { id: "i9", board_id: "b1" } },
}));
const createGroup = vi.fn(async () => ({
  ok: true,
  data: { group: { id: "g9" } },
}));
const upsertCell = vi.fn(async () => ({ ok: true, data: undefined }));
vi.mock("@/lib/boards/actions/item", () => ({ createItem }));
vi.mock("@/lib/boards/actions/group", () => ({ createGroup }));
vi.mock("@/lib/boards/actions/cell", () => ({ upsertCell }));
vi.mock("@/lib/boards/queries", () => ({
  getBoardPayload: vi.fn(async () => ({
    board: { id: "b1", name: "Roadmap" },
    groups: [{ id: "g1", name: "Backlog" }],
    columns: [
      { id: "c-due", name: "Due", kind: "date" },
      { id: "c-owner", name: "Owner", kind: "people" },
    ],
    items: [],
    cellValues: [],
  })),
}));

import { executeAction } from "./execute";

beforeEach(() => {
  createItem.mockClear();
  upsertCell.mockClear();
});

it("create_item creates the item then upserts date + people cells", async () => {
  const res = await executeAction({
    kind: "create_item",
    boardId: "b1",
    groupId: "g1",
    name: "Ship v2",
    fields: { dueDate: "2026-07-17", ownerUserIds: ["u1"] },
    summary: "s",
    warnings: [],
  });
  expect(res).toEqual({ ok: true, itemId: "i9" });
  expect(createItem).toHaveBeenCalledWith({ groupId: "g1", name: "Ship v2" });
  expect(upsertCell).toHaveBeenCalledWith({
    itemId: "i9",
    columnId: "c-due",
    value: { date: "2026-07-17" },
  });
  expect(upsertCell).toHaveBeenCalledWith({
    itemId: "i9",
    columnId: "c-owner",
    value: { userIds: ["u1"] },
  });
});

it("reports failure when the item create fails", async () => {
  createItem.mockResolvedValueOnce({ ok: false, error: "nope" });
  const res = await executeAction({
    kind: "create_item",
    boardId: "b1",
    groupId: "g1",
    name: "X",
    summary: "s",
    warnings: [],
  });
  expect(res).toEqual({ ok: false, error: "nope" });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test src/lib/ai/write/execute.test`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
import "server-only";
import { getBoardPayload } from "@/lib/boards/queries";
import { createItem } from "@/lib/boards/actions/item";
import { createGroup } from "@/lib/boards/actions/group";
import { upsertCell } from "@/lib/boards/actions/cell";
import { pickFieldColumns } from "./resolve";
import type {
  ProposedFields,
  ValidatedAction,
  ExecutionResult,
} from "./schema";

async function applyFields(
  boardId: string,
  itemId: string,
  fields: ProposedFields | undefined,
): Promise<string[]> {
  if (!fields) return [];
  const payload = await getBoardPayload(boardId);
  if (!payload) return ["Board not found."];
  const { dateColumnId, statusColumnId, peopleColumnId } =
    pickFieldColumns(payload);
  const errors: string[] = [];
  const write = async (
    columnId: string | null,
    value: unknown,
    label: string,
  ) => {
    if (!columnId) return errors.push(`No ${label} column on this board.`);
    const r = await upsertCell({ itemId, columnId, value });
    if (!r.ok) errors.push(`${label}: ${r.error}`);
  };
  if (fields.dueDate)
    await write(
      dateColumnId,
      {
        date: fields.dueDate,
        ...(fields.endDate ? { end: fields.endDate } : {}),
      },
      "date",
    );
  if (fields.ownerUserIds?.length)
    await write(peopleColumnId, { userIds: fields.ownerUserIds }, "people");
  if (fields.statusOptionId !== undefined)
    await write(statusColumnId, { optionId: fields.statusOptionId }, "status");
  return errors;
}

export async function executeAction(
  action: ValidatedAction,
): Promise<ExecutionResult> {
  if (action.kind === "create_group") {
    const r = await createGroup({ boardId: action.boardId, name: action.name });
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  }
  if (action.kind === "create_item") {
    const created = await createItem({
      groupId: action.groupId,
      name: action.name,
    });
    if (!created.ok) return { ok: false, error: created.error };
    const itemId = created.data.item.id;
    const fieldErrors = await applyFields(
      action.boardId,
      itemId,
      action.fields,
    );
    return fieldErrors.length
      ? { ok: false, error: fieldErrors.join("; ") }
      : { ok: true, itemId };
  }
  // set_item_fields
  const fieldErrors = await applyFields(
    action.boardId,
    action.itemId,
    action.fields,
  );
  return fieldErrors.length
    ? { ok: false, error: fieldErrors.join("; ") }
    : { ok: true, itemId: action.itemId };
}
```

> Note: `set_item_fields` and a partially-failed `create_item` both surface field errors; the item may still exist (created before a field failed) — the UI copy must reflect "created, but couldn't set X" (Task 8).

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test src/lib/ai/write/execute.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/write/execute.ts src/lib/ai/write/execute.test.ts
git commit -m "feat(ai): execute validated conversational actions via canonical board actions"
```

---

## Task 6: Server Actions (`actions.ts`)

**Files:**

- Create: `src/lib/ai/write/actions.ts`
- Test: `src/lib/ai/write/actions.test.ts`

**Interfaces:**

- Consumes: `proposeLoop` (Task 4); `executeAction` + `validatedActionSchema` (Tasks 1/5); `runAi` (`@/lib/ai/gateway`); `requireAiEntitlement` + `getAiEntitlement` (`@/lib/ai/entitlement`); typed AI errors (`@/lib/ai/errors`); `requireUser`/`getUserOrgs` (`@/lib/auth/session`); `listWorkspacesCached`/`getActiveWorkspaceId` (`@/lib/workspaces/*`); `fail`/`ActionResult` (`@/lib/actions/result`); `MODEL` (`@/lib/ai/providers/anthropic`).
- Produces: `proposeActions({ instruction }) → ActionResult<{ actions: ValidatedAction[]; clarification?: string }>`; `executeActions({ actions }) → ActionResult<{ results: ExecutionResult[] }>`.

Mirror `src/lib/ai/ask/actions.ts` for the entitlement-gate + `runAi` + typed-error mapping shape.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth/session", () => ({
  requireUser: vi.fn(async () => ({ id: "u1" })),
  getUserOrgs: vi.fn(async () => [{ id: "org1" }]),
}));
vi.mock("@/lib/workspaces/queries-cached", () => ({
  listWorkspacesCached: vi.fn(async () => [{ id: "ws1" }]),
}));
vi.mock("@/lib/workspaces/active", () => ({
  getActiveWorkspaceId: vi.fn(async () => "ws1"),
}));
vi.mock("@/lib/ai/entitlement", () => ({
  requireAiEntitlement: vi.fn(async () => undefined),
  getAiEntitlement: vi.fn(async () => ({ mode: "managed" })),
}));
vi.mock("@/lib/ai/gateway", () => ({
  runAi: vi.fn(
    async (_a: unknown, fn: (r: unknown) => Promise<{ result: unknown }>) =>
      (await fn({ adapter: { supportsTools: true }, apiKey: "k" })).result,
  ),
}));
vi.mock("./propose", () => ({
  proposeLoop: vi.fn(async () => ({
    actions: [
      {
        kind: "create_group",
        boardId: "b1",
        name: "Backlog",
        summary: "s",
        warnings: [],
      },
    ],
    usage: { inputTokens: 1, outputTokens: 1 },
  })),
}));
const executeAction = vi.fn(async () => ({ ok: true }));
vi.mock("./execute", () => ({ executeAction }));

import { proposeActions, executeActions } from "./actions";

beforeEach(() => vi.clearAllMocks());

it("proposeActions gates entitlement then returns actions", async () => {
  const { requireAiEntitlement } = await import("@/lib/ai/entitlement");
  const res = await proposeActions({ instruction: "make a Backlog group" });
  expect(requireAiEntitlement).toHaveBeenCalledWith(
    "org1",
    "conversational_action",
  );
  expect(res).toEqual({
    ok: true,
    data: {
      actions: [expect.objectContaining({ kind: "create_group" })],
      clarification: undefined,
    },
  });
});

it("executeActions re-validates and rejects a tampered action", async () => {
  const res = await executeActions({ actions: [{ kind: "wipe_db" } as never] });
  expect(res.ok).toBe(false);
  expect(executeAction).not.toHaveBeenCalled();
});

it("executeActions runs each valid action", async () => {
  const res = await executeActions({
    actions: [
      {
        kind: "create_group",
        boardId: "b1",
        name: "Backlog",
        summary: "s",
        warnings: [],
      },
    ],
  });
  expect(res).toEqual({ ok: true, data: { results: [{ ok: true }] } });
  expect(executeAction).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test src/lib/ai/write/actions.test`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
"use server";
import { z } from "zod";
import { requireUser, getUserOrgs } from "@/lib/auth/session";
import { runAi } from "@/lib/ai/gateway";
import { requireAiEntitlement, getAiEntitlement } from "@/lib/ai/entitlement";
import { MODEL } from "@/lib/ai/providers/anthropic";
import { proposeLoop } from "./propose";
import { executeAction } from "./execute";
import {
  validatedActionSchema,
  type ValidatedAction,
  type ExecutionResult,
} from "./schema";
import {
  AiDisabledError,
  AiQuotaExceededError,
  ByoKeyMissingError,
  AiNotConfiguredError,
  ProviderNotCapableError,
} from "@/lib/ai/errors";
import { listWorkspacesCached } from "@/lib/workspaces/queries-cached";
import { getActiveWorkspaceId } from "@/lib/workspaces/active";
import { fail, type ActionResult } from "@/lib/actions/result";

const instructionSchema = z.object({
  instruction: z.string().trim().min(3).max(1000),
});

function mapAiError(e: unknown): string | null {
  if (e instanceof ProviderNotCapableError)
    return "Conversational actions need an Anthropic key.";
  if (e instanceof AiDisabledError)
    return "AI is turned off for your organization.";
  if (e instanceof AiQuotaExceededError)
    return "You've used this month's AI allowance.";
  if (e instanceof AiNotConfiguredError)
    return "Add an AI provider key in Settings to use this.";
  if (e instanceof ByoKeyMissingError)
    return "Your organization's AI key is missing — ask an admin to update Settings.";
  return null;
}

export async function proposeActions(input: {
  instruction: string;
}): Promise<
  ActionResult<{ actions: ValidatedAction[]; clarification?: string }>
> {
  const parsed = instructionSchema.safeParse(input);
  if (!parsed.success) return fail("Describe the action in 3–1000 characters.");

  try {
    const user = await requireUser();
    const org = (await getUserOrgs())[0];
    if (!org) return fail("No organization.");
    await requireAiEntitlement(org.id, "conversational_action");
    const workspaceId = await getActiveWorkspaceId(
      await listWorkspacesCached(org.id),
    );
    if (!workspaceId) return fail("No workspace.");

    const result = await runAi(
      { orgId: org.id, userId: user.id, feature: "conversational_action" },
      async ({ adapter, apiKey }) => {
        if (!adapter.supportsTools)
          throw new ProviderNotCapableError("conversational_action");
        const r = await proposeLoop({
          apiKey,
          orgId: org.id,
          workspaceId,
          instruction: parsed.data.instruction,
        });
        return { result: r, usage: r.usage, model: MODEL };
      },
    );
    return {
      ok: true,
      data: { actions: result.actions, clarification: result.clarification },
    };
  } catch (e) {
    const msg = mapAiError(e);
    if (msg) return fail(msg);
    return fail("Couldn't work out that action. Please try again.");
  }
}

export async function executeActions(input: {
  actions: unknown[];
}): Promise<ActionResult<{ results: ExecutionResult[] }>> {
  const parsed = z
    .array(validatedActionSchema)
    .min(1)
    .max(10)
    .safeParse(input.actions);
  if (!parsed.success) return fail("Nothing valid to apply.");

  try {
    const org = (await getUserOrgs())[0];
    if (!org) return fail("No organization.");
    // Re-check the org can still use AI (a disabled org shouldn't execute a stale proposal).
    const ent = await getAiEntitlement(org.id);
    if (ent.mode === "off")
      return fail("AI is turned off for your organization.");

    const results: ExecutionResult[] = [];
    for (const action of parsed.data) results.push(await executeAction(action));
    return { ok: true, data: { results } };
  } catch {
    return fail("Couldn't apply that action. Please try again.");
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test src/lib/ai/write/actions.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/write/actions.ts src/lib/ai/write/actions.test.ts
git commit -m "feat(ai): proposeActions + executeActions server actions (gated, re-validated)"
```

---

## Task 7: Confirm card component (`ActionConfirmCard.tsx`)

**Files:**

- Create: `src/components/ai/actions/ActionConfirmCard.tsx`
- Test: `src/components/ai/actions/ActionConfirmCard.test.tsx`

**Interfaces:**

- Consumes: `ValidatedAction` (Task 1); `pulse-ui` primitives (`Button`, `Card`, `Kicker`).
- Produces: `ActionConfirmCard({ action, onApprove, onCancel, state })` — **exported for the Ask-full-page track to render the identical card in its thread.**

**Load `pulse-ui` + `frontend-design` before styling.** Dark-first, periwinkle accent, radius-14. Render `action.summary`, each `action.warnings[]` as a muted note, and [Approve]/[Cancel]. `state` ∈ `"idle" | "running" | "done" | "error"` drives the buttons/labels.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ActionConfirmCard } from "./ActionConfirmCard";

const action = {
  kind: "create_item",
  boardId: "b1",
  groupId: "g1",
  name: "Ship v2",
  summary: 'Create task "Ship v2" in Backlog',
  warnings: ["'Dana' matched 2 members — used Dana Ruiz"],
} as const;

it("shows the summary + warnings and fires callbacks", async () => {
  const onApprove = vi.fn();
  const onCancel = vi.fn();
  render(
    <ActionConfirmCard
      action={action}
      onApprove={onApprove}
      onCancel={onCancel}
      state="idle"
    />,
  );
  expect(
    screen.getByText(/Create task "Ship v2" in Backlog/),
  ).toBeInTheDocument();
  expect(screen.getByText(/matched 2 members/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /approve/i }));
  expect(onApprove).toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
  expect(onCancel).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test src/components/ai/actions/ActionConfirmCard.test`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement** (style per `pulse-ui`; structure below)

```tsx
"use client";
import { Button } from "@/components/ui/button";
import type { ValidatedAction } from "@/lib/ai/write/schema";

export type ConfirmState = "idle" | "running" | "done" | "error";

export function ActionConfirmCard({
  action,
  onApprove,
  onCancel,
  state,
  resultNote,
}: {
  action: ValidatedAction;
  onApprove: () => void;
  onCancel: () => void;
  state: ConfirmState;
  resultNote?: string;
}) {
  return (
    <div
      className="rounded-[14px] border p-3 text-sm"
      role="group"
      aria-label="Proposed action"
    >
      <p className="font-medium">{action.summary}</p>
      {action.warnings.map((w) => (
        <p key={w} className="text-muted-foreground mt-1 text-xs">
          {w}
        </p>
      ))}
      {resultNote ? (
        <p className="mt-2 text-xs" aria-live="polite">
          {resultNote}
        </p>
      ) : null}
      {state === "idle" || state === "running" ? (
        <div className="mt-3 flex items-center justify-end gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={onCancel}
            disabled={state === "running"}
          >
            Cancel
          </Button>
          <Button size="sm" onClick={onApprove} disabled={state === "running"}>
            {state === "running" ? "Applying…" : "Approve"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test src/components/ai/actions/ActionConfirmCard.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/ai/actions/ActionConfirmCard.tsx src/components/ai/actions/ActionConfirmCard.test.tsx
git commit -m "feat(ai): reusable confirm-before-execute action card"
```

---

## Task 8: ⌘K action composer (`QuickAction.tsx`)

**Files:**

- Create: `src/components/ai/actions/QuickAction.tsx`
- Test: `src/components/ai/actions/QuickAction.test.tsx`

**Interfaces:**

- Consumes: `proposeActions`/`executeActions` (Task 6); `ActionConfirmCard` (Task 7); `ValidatedAction`/`ExecutionResult` (Task 1); `Textarea`/`Button` (`pulse-ui`).
- Produces: `QuickAction({ onClose })` — the composer body mounted inside the palette (Task 9).

**Load `pulse-ui` + `frontend-design`.** Flow: textarea → `proposeActions` (thinking) → confirm card(s) or `clarification` → Approve calls `executeActions` → success line deep-linking `/boards/<id>?item=<id>`. All client state — no RSC navigation. Empty/disabled/quota/error states first-class (`role="alert"`).

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const proposeActions = vi.fn();
const executeActions = vi.fn();
vi.mock("@/lib/ai/write/actions", () => ({ proposeActions, executeActions }));

import { QuickAction } from "./QuickAction";

beforeEach(() => {
  proposeActions.mockReset();
  executeActions.mockReset();
});

it("proposes, shows a confirm card, and executes on approve", async () => {
  proposeActions.mockResolvedValue({
    ok: true,
    data: {
      actions: [
        {
          kind: "create_item",
          boardId: "b1",
          groupId: "g1",
          name: "Ship v2",
          summary: 'Create task "Ship v2" in Backlog',
          warnings: [],
        },
      ],
    },
  });
  executeActions.mockResolvedValue({
    ok: true,
    data: { results: [{ ok: true, itemId: "i9" }] },
  });

  render(<QuickAction onClose={() => {}} />);
  await userEvent.type(
    screen.getByLabelText(/command/i),
    "create task Ship v2 in Backlog",
  );
  await userEvent.click(screen.getByRole("button", { name: /^run$/i }));
  expect(
    await screen.findByText(/Create task "Ship v2" in Backlog/),
  ).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: /approve/i }));
  expect(executeActions).toHaveBeenCalled();
  expect(await screen.findByText(/created/i)).toBeInTheDocument();
});

it("renders a clarification when no actions are proposed", async () => {
  proposeActions.mockResolvedValue({
    ok: true,
    data: { actions: [], clarification: "Which board?" },
  });
  render(<QuickAction onClose={() => {}} />);
  await userEvent.type(screen.getByLabelText(/command/i), "do something");
  await userEvent.click(screen.getByRole("button", { name: /^run$/i }));
  expect(await screen.findByText(/Which board\?/)).toBeInTheDocument();
});

it("surfaces a failed proposal as an alert", async () => {
  proposeActions.mockResolvedValue({
    ok: false,
    error: "You've used this month's AI allowance.",
  });
  render(<QuickAction onClose={() => {}} />);
  await userEvent.type(screen.getByLabelText(/command/i), "create task X");
  await userEvent.click(screen.getByRole("button", { name: /^run$/i }));
  expect(await screen.findByRole("alert")).toHaveTextContent(/allowance/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test src/components/ai/actions/QuickAction.test`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement** (style per `pulse-ui`; structure below)

```tsx
"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { proposeActions, executeActions } from "@/lib/ai/write/actions";
import { ActionConfirmCard, type ConfirmState } from "./ActionConfirmCard";
import type { ValidatedAction } from "@/lib/ai/write/schema";

const MIN = 3;

export function QuickAction({ onClose }: { onClose: () => void }) {
  const [instruction, setInstruction] = useState("");
  const [actions, setActions] = useState<ValidatedAction[]>([]);
  const [clarification, setClarification] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<ConfirmState>("idle");
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function run() {
    const text = instruction.trim();
    if (text.length < MIN || pending) return;
    setActions([]);
    setClarification(null);
    setError(null);
    setNote(null);
    setState("idle");
    start(async () => {
      const res = await proposeActions({ instruction: text });
      if (!res.ok) return setError(res.error);
      if (res.data.actions.length === 0)
        return setClarification(
          res.data.clarification ?? "I couldn't work that out.",
        );
      setActions(res.data.actions);
    });
  }

  function approve() {
    setState("running");
    start(async () => {
      const res = await executeActions({ actions });
      if (!res.ok) {
        setState("error");
        setError(res.error);
        return;
      }
      const created = res.data.results.find((r) => r.ok && r.itemId);
      setState("done");
      setNote(
        created && created.ok && created.itemId
          ? "Created — open it from the board."
          : "Done.",
      );
    });
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
        className="flex flex-col gap-2"
      >
        <Textarea
          autoFocus
          rows={2}
          value={instruction}
          disabled={pending}
          aria-label="Command"
          placeholder="e.g. create task Ship v2 due Friday for Dana in Backlog"
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              run();
            }
          }}
        />
        <div className="flex items-center justify-end gap-2">
          <span className="text-muted-foreground text-xs">⌘↵ to run</span>
          <Button
            type="submit"
            size="sm"
            disabled={instruction.trim().length < MIN || pending}
          >
            {pending && actions.length === 0 ? "Working…" : "Run"}
          </Button>
        </div>
      </form>

      {actions.map((a, i) => (
        <ActionConfirmCard
          key={i}
          action={a}
          state={state}
          resultNote={note ?? undefined}
          onApprove={approve}
          onCancel={onClose}
        />
      ))}
      {clarification ? (
        <p className="text-muted-foreground text-sm" aria-live="polite">
          {clarification}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test src/components/ai/actions/QuickAction.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/ai/actions/QuickAction.tsx src/components/ai/actions/QuickAction.test.tsx
git commit -m "feat(ai): ⌘K quick-action composer (propose → confirm → execute)"
```

---

## Task 9: Wire the composer into ⌘K

**Files:**

- Modify: `src/components/command-palette.tsx`
- Test: `src/components/command-palette.test.tsx` (add a case; if none exists, create it)

**Interfaces:**

- Consumes: `QuickAction` (Task 8, lazy).
- Produces: a "Run a command…" entry in ⌘K that switches the palette body into `QuickAction`.

**Coordination:** if the Ask-full-page ⌘K repoint has merged, `command-palette.tsx` may already have changed the "Ask Monolith…" entry to navigate to `/ask`. Reconcile: keep that entry, ADD a separate "Actions" group. If it has **not** merged, leave the existing "Ask Monolith…" entry untouched. Do not delete anything you didn't add.

- [ ] **Step 1: Add lazy import + local mode state** near the top of `CommandPalette`

```tsx
import dynamic from "next/dynamic";
const QuickAction = dynamic(
  () =>
    import("@/components/ai/actions/QuickAction").then((m) => m.QuickAction),
  { ssr: false },
);
// inside the component:
const [actionMode, setActionMode] = useState(false);
```

- [ ] **Step 2: Render the composer instead of the list when in action mode**

Wrap the existing `<CommandList>…</CommandList>` so that when `actionMode` is true, the dialog body renders `<QuickAction onClose={() => { setActionMode(false); handleOpenChange(false); }} />` instead; reset `actionMode` to false in `resetSearch()` and `handleOpenChange(false)`.

```tsx
{
  actionMode ? (
    <QuickAction
      onClose={() => {
        setActionMode(false);
        handleOpenChange(false);
      }}
    />
  ) : (
    <CommandList>
      {/* …existing groups… */}
      <CommandGroup heading={<Kicker>Actions</Kicker>}>
        <CommandItem onSelect={() => setActionMode(true)}>
          <Wand2 className="size-4" /> Run a command…
        </CommandItem>
      </CommandGroup>
      {/* …rest… */}
    </CommandList>
  );
}
```

(Add `Wand2` to the `lucide-react` import.)

- [ ] **Step 3: Add/extend the test**

```tsx
it("opens the quick-action composer from the Actions group", async () => {
  // render CommandPalette with the store open (mirror the existing test's setup),
  // click "Run a command…", assert the command textarea appears.
  expect(await screen.findByLabelText(/command/i)).toBeInTheDocument();
});
```

- [ ] **Step 4: Run the gates for the touched files**

Run: `pnpm test command-palette && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/command-palette.tsx src/components/command-palette.test.tsx
git commit -m "feat(ai): add ⌘K \"Run a command…\" quick-action entry"
```

---

## Task 10: Full gate + manual-test walkthrough

**Files:** none (verification only).

- [ ] **Step 1: Run the full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all PASS. Fix anything red before proceeding.

- [ ] **Step 2: Confirm no real API calls in tests** — grep for un-mocked `new Anthropic(` in the new test files; every test must inject/mocked the client or the action.

- [ ] **Step 3: Write the "How to test this" walkthrough** (for the closing message + `/wrapup` note):

1. Pull `develop`; ensure your org's AI is **managed** or **BYO (Anthropic)** with credit remaining (Settings → AI).
2. Open any workspace with at least one board that has a "Status", a date, and a people column, and a group named "Backlog".
3. Press ⌘K → "Run a command…".
4. Type: `create task Ship v2 due Friday for Dana in Backlog` → Run.
5. Expect a **confirm card**: _Create task "Ship v2" in Backlog · due <ISO Fri> · owner <Dana's full name>_ (with a warning if "Dana" is ambiguous).
6. Click **Approve** → expect a success line; open the board and confirm the item exists in Backlog with the due date + owner set.
7. Click **Cancel** on a fresh proposal → confirm **nothing** was created.
8. Negative: with AI turned **off** (Settings → AI), the composer shows "AI is turned off for your organization."

- [ ] **Step 4: Finish the task**

Run `scripts/finish-task.sh` from inside the worktree (rebases onto `develop`, runs the gates, merges, cleans up). If it stops on a `command-palette.tsx` rebase conflict against the Ask-full-page ⌘K repoint, resolve by keeping BOTH ⌘K entries (see Task 9 coordination note) and re-run.

---

## Self-review notes (for the executor)

- **Spec coverage:** engine (`schema`/`resolve`/`write-tools`/`propose`/`execute`/`actions`) = Tasks 1–6; write-tool safety model = Tasks 3 (proposal-only) + 6 (re-validate + disabled re-check) + 5 (canonical RLS actions); ⌘K surface = Tasks 7–9; perf budget (lazy, one action per submit, 0 RSC nav) = Tasks 8–9; boundary/reuse = `ActionConfirmCard` exported (Task 7) + engine surface-agnostic (Tasks 1–6).
- **Verify on implement:** `listOrgMembersCached`'s row shape (Task 3 note) and `getBoardPayload`'s exact return type for `payload.columns[].settings`/`.kind` (Tasks 2/5) — adjust field access to the real types; do not introduce `any` (cast through the generated `Tables<>`/snapshot types).
- **No migration, no new env** — `feature = "conversational_action"` is free-text in `ai_usage`.
