# MCP write surface — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose ~45 existing board, structure and planning-layer operations to both tool transports as twelve grouped-dispatch tools, so an agent can build a board from nothing instead of only filling one a human already built.

**Architecture:** Each operation's body moves down one layer into a `*Core` function taking an RLS-scoped `SupabaseClient` as its first argument; the existing Server Action becomes `createClient()` → core → `revalidate`, and a new MCP `ToolDescriptor` becomes `ctx.getClient()` → core → `toToolResult`. One implementation, two callers. The twelve new tools each take an `action` discriminant, so `ToolDescriptor.capability` and `.scope` widen from scalars to scalar-or-per-action-map, resolved through two new functions that every consumer must route through.

**Tech Stack:** Next.js 16 (App Router, RSC), TypeScript strict, Zod, Supabase (Postgres + RLS), `@modelcontextprotocol/sdk`, AI SDK (`ai`), Vitest.

**Spec:** `docs/superpowers/specs/2026-09-07-mcp-write-surface-design.md`. Read it before Task 1; it carries the reasoning this plan only executes.

## Global Constraints

- **Server Components by default; Server Actions for all mutations.** This is Next.js 16 — confirm APIs against `node_modules/next/dist/docs/`.
- **RLS is the security boundary.** Every core function runs on a caller-supplied RLS-scoped client. Never `createServiceClient()` on any path in this plan.
- **`ActionResult` / `fail` come from `src/lib/actions/result.ts`.** Never re-declare either shape locally.
- **Migrations are minted only via `scripts/new-migration.sh <slug>`** — never hand-write a version stamp. Apply to DEV via the `supabase-dev` MCP with the **same version + name** as the committed file, then verify with `pnpm db:ledger-check`.
- **Both new capabilities ship INERT.** Do not backfill `org_ai_settings.agent_capability_ceiling`, do not change its column `DEFAULT`, and do not add either capability to `DEFAULT_ORG_AI_SETTINGS.agentCapabilityCeiling` in `src/lib/ai/org-settings.ts`. Spec §3.
- **Capability strings, verbatim:** `"board.structure"`, `"board.destroy"`.
- **Refusal copy, verbatim:** `"This agent is scoped to specific boards, so it cannot create new ones. Ask its owner to widen its scope."`
- **No hard delete or purge on any agent-reachable path**, either transport. Spec §5.
- **Batch cap is 50** entries on every batched create.
- **Commit identity is pinned** to `Danijel Jovanovic <info@synapse-solutions.ai>`; `scripts/start-task.sh` asserts it.
- **Commit subjects must be lowercase** — commitlint rejects sentence-case subjects.
- **Stage explicitly by path.** Never `git add -A` / `git add .` / `git commit -a`.
- **Gates:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` must all pass before `scripts/finish-task.sh`.

## Execution DAG (working agreement #6)

**Dependency graph**

```
Task 1 (capabilities + migration)
  └─> Task 2 (per-action descriptor resolution)
        └─> Task 3 (toToolResult + getBoardAccessCore + parseAction)
              ├─> Task 4  (describe_schema)
              ├─> Task 5  Unit A — board + group
              ├─> Task 6  Unit B — column
              ├─> Task 7  Unit C — item
              ├─> Task 8  Unit D — view + automation
              └─> Task 9  Unit E — dashboard/widget/report/goal/portfolio
                    └─> Task 10 (proposal summaries)
                          └─> Task 11 (proposal targets + consent table + counts)
                                └─> Task 12 (capability UI copy)
                                      └─> Task 13 (end-to-end board build)
```

**Parallel batches**

| Wave | Tasks             | Concurrency                                                                                                                  |
| ---- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1    | 1 → 2 → 3         | Sequential. One agent, one worktree. Everything else blocks on it.                                                           |
| 2    | 4, 5, 6, 7, 8, 9  | **Six concurrent agents, one git worktree each.** No shared state; disjoint files but for one appended line in `catalog.ts`. |
| 3    | 10 → 11 → 12 → 13 | Sequential. One agent. Needs every Wave 2 descriptor to exist.                                                               |

**Critical path:** Task 1 → 2 → 3 → (longest Wave 2 unit, expected Task 9) → 10 → 11 → 12 → 13. Wave 2 is the wall-clock floor; Task 9 touches four modules and should be dispatched first.

**Merge discipline.** Every Wave 2 unit appends one line to `src/lib/mcp/tools/catalog.ts`. That is a trivial conflict, but six worktrees hitting it at once is not — **the orchestrator merges Wave 2 one worktree at a time**, per the standing rule for parallel batches. Do not run six `finish-task.sh` invocations concurrently.

**`proposal-summary.ts` is deliberately NOT in Wave 2.** All ~50 branches land in Task 10, once. Splitting them across six parallel worktrees would mean a six-way conflict in a single `switch` — far worse than the one-line `catalog.ts` conflict.

**Serialization note:** `task/agents-page` is in flight and touches `AgentEditor`. Task 12 adds the two capability checkboxes in that area. Land `task/agents-page` before starting Task 12, or accept a rebase there.

## Performance & data-fetching budget (working agreement #5)

Stated in full in spec §12. The three rules every task must hold:

1. **Batch creates resolve the board ONCE, before the loop.** The `org_id` is read once and reused for every insert. A per-entry board read is an N-query hot path and is the single most likely performance defect in this plan.
2. **Every scope resolver is one indexed `select <fk> … eq("id", …) maybeSingle()`** on a primary key. Never a scan.
3. **`describe_schema` reads nothing.** No client, no query — that is what lets it be capability-free.

---

## Task 1: Capability vocabulary + migration

**Files:**

- Modify: `src/lib/agents/capabilities.ts`
- Modify: `src/lib/agents/capability-copy.ts`
- Create: `supabase/migrations/<minted>_agent_structure_capabilities.sql`
- Modify: `src/types/database.types.ts` (regenerated)
- Test: `src/lib/agents/capabilities.test.ts` (create), `src/lib/ai/org-settings.test.ts` (existing — must still pass untouched)

**Interfaces:**

- Consumes: nothing.
- Produces: `AgentCapability` union widened to eight members, including the string literals `"board.structure"` and `"board.destroy"`; `CAPABILITY_COPY` entries for both. Every later task depends on these two literals existing.

- [ ] **Step 1: Write the failing test**

Create `src/lib/agents/capabilities.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { AGENT_CAPABILITIES } from "./capabilities";
import { CAPABILITY_COPY } from "./capability-copy";
import { DEFAULT_ORG_AI_SETTINGS } from "@/lib/ai/org-settings";

describe("AGENT_CAPABILITIES", () => {
  it("includes the two structure capabilities", () => {
    expect(AGENT_CAPABILITIES).toContain("board.structure");
    expect(AGENT_CAPABILITIES).toContain("board.destroy");
  });

  it("gives every capability plain-language copy", () => {
    for (const c of AGENT_CAPABILITIES) {
      expect(CAPABILITY_COPY[c]?.label, c).toBeTruthy();
      expect(CAPABILITY_COPY[c]?.consequence, c).toBeTruthy();
    }
  });

  // The whole point of the inert ship: a brand-new org, and an org with no
  // settings row at all, must NOT receive either capability automatically.
  // Deriving this default from AGENT_CAPABILITIES would silently grant them.
  it("keeps both new capabilities OUT of the row-less org default ceiling", () => {
    expect(DEFAULT_ORG_AI_SETTINGS.agentCapabilityCeiling).not.toContain(
      "board.structure",
    );
    expect(DEFAULT_ORG_AI_SETTINGS.agentCapabilityCeiling).not.toContain(
      "board.destroy",
    );
    expect(DEFAULT_ORG_AI_SETTINGS.agentCapabilityCeiling).toHaveLength(5);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run src/lib/agents/capabilities.test.ts`
Expected: FAIL — `AGENT_CAPABILITIES` does not contain `"board.structure"`.

- [ ] **Step 3: Widen the vocabulary**

In `src/lib/agents/capabilities.ts`, append two members to the array:

```ts
export const AGENT_CAPABILITIES = [
  "board.write",
  "files.write",
  "automation.create",
  "time.log",
  "memory.write",
  "agent.delegate",
  "board.structure",
  "board.destroy",
] as const;
```

- [ ] **Step 4: Add the copy**

In `src/lib/agents/capability-copy.ts`, add two entries to `CAPABILITY_COPY`, in the established voice (second person, one consequence sentence):

```ts
  "board.structure": {
    label: "Build and change board structure",
    consequence:
      "This agent can create boards, and add or reconfigure their groups, " +
      "columns, views, dashboards and reports.",
  },
  "board.destroy": {
    label: "Remove things",
    consequence:
      "This agent can move boards, groups and items to Trash, and delete " +
      "columns, views, widgets and reports outright. Anything in Trash can " +
      "be restored by you.",
  },
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `pnpm vitest run src/lib/agents/capabilities.test.ts src/lib/ai/org-settings.test.ts`
Expected: PASS, both files. If `org-settings.test.ts` fails, you changed `DEFAULT_ORG_AI_SETTINGS` — revert that; it must stay a frozen five-string literal.

- [ ] **Step 6: Mint the migration**

Run: `scripts/new-migration.sh agent_structure_capabilities`

Do NOT invent the version stamp. The script mints a real UTC stamp and the filename must match the remote ledger row.

- [ ] **Step 7: Write the migration**

Into the minted file. This is **DDL only** — it reads and writes no user data. The header is not decoration: it records the backfill that was deliberately not run, so the decision is reviewable in the diff.

```sql
-- What this migration does:
--   'board.structure' and 'board.destroy' join the closed capability
--   vocabulary — both the per-agent CHECK on user_agents.capabilities and the
--   admin clamp org_ai_settings.agent_capability_ceiling.
--
-- DDL ONLY. NOT ONE ROW OF USER DATA IS READ OR WRITTEN BY THIS MIGRATION.
--
-- ===========================================================================
-- THE CEILING BACKFILL IS DELIBERATELY ABSENT.
-- ===========================================================================
-- Same ruling as 'memory.write' (20260827095748_agent_memory.sql) and
-- 'agent.delegate' (20260905045106_agent_delegate_and_usage_run_id.sql): the
-- DEV database holds real, live, user-facing data (decision-32), and a
-- data-modifying statement against it is production surgery that is reviewed
-- and run on its own, never as a side effect of shipping a feature branch.
--
-- The exact statements, recorded here so they are reviewable in the diff and
-- runnable verbatim later. THEY HAVE NOT BEEN EXECUTED:
--
--     update public.org_ai_settings
--        set agent_capability_ceiling =
--            agent_capability_ceiling || 'board.structure'
--      where not ('board.structure' = any (agent_capability_ceiling));
--
--     update public.org_ai_settings
--        set agent_capability_ceiling =
--            agent_capability_ceiling || 'board.destroy'
--      where not ('board.destroy' = any (agent_capability_ceiling));
--
-- WHAT THAT MEANS FOR THIS SHIP: every org with an org_ai_settings row carries
-- an array that predates these two strings, so the ceiling check in
-- grant-gate.ts refuses them before the grant check runs and records NO
-- proposal. The structure surface therefore ships INSTALLABLE BUT INERT, and
-- AN ADMIN MUST OPEN THE ORG CEILING before any agent can build anything.
--
-- The `alter column … set default` is deliberately NOT restated below. The
-- DEFAULT decides what a brand-new org gets, and handing structure writes to
-- every future org automatically is the same silent grant the backfill was
-- refused for. It must also stay byte-identical to
-- DEFAULT_ORG_AI_SETTINGS.agentCapabilityCeiling (src/lib/ai/org-settings.ts),
-- which src/lib/ai/org-settings.test.ts pins at five strings.

alter table public.user_agents
  drop constraint if exists user_agents_capabilities_known;
alter table public.user_agents
  add constraint user_agents_capabilities_known
  check (capabilities <@ array['board.write','files.write','automation.create',
                              'time.log','memory.write','agent.delegate',
                              'board.structure','board.destroy']::text[]);

alter table public.org_ai_settings
  drop constraint if exists org_ai_settings_ceiling_known;
alter table public.org_ai_settings
  add constraint org_ai_settings_ceiling_known
  check (agent_capability_ceiling <@ array['board.write','files.write',
                                          'automation.create','time.log',
                                          'memory.write','agent.delegate',
                                          'board.structure',
                                          'board.destroy']::text[]);
```

- [ ] **Step 8: Apply to DEV and verify the ledger**

Apply via the `supabase-dev` MCP `apply_migration`, using the **same version and name** as the committed filename. Then:

Run: `pnpm db:ledger-check`
Expected: no diff in either direction. A ledger row with no committed file blocks `finish-task.sh` (gotcha-57).

- [ ] **Step 9: Regenerate types**

In a task worktree `pnpm db:types` throws `LegacyProjectNotLinkedError`. Use the `supabase-dev` MCP `generate_typescript_types`, write the result to `src/types/database.types.ts`, then `pnpm prettier --write src/types/database.types.ts`.

- [ ] **Step 10: Run the gates**

Run: `pnpm typecheck && pnpm lint && pnpm vitest run src/lib/agents src/lib/ai/org-settings.test.ts`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add src/lib/agents/capabilities.ts src/lib/agents/capability-copy.ts \
        src/lib/agents/capabilities.test.ts \
        supabase/migrations/*_agent_structure_capabilities.sql \
        src/types/database.types.ts
git commit -m "feat(agents): add board.structure and board.destroy capabilities"
```

---

## Task 2: Per-action capability and scope resolution

**Files:**

- Modify: `src/lib/mcp/tools/descriptor.ts`
- Modify: `src/lib/agents/grant-gate.ts:73-90`
- Modify: `src/lib/agents/board-scope-guard.ts:39-66`
- Modify: `src/lib/agents/tools.ts:76-108`
- Test: `src/lib/mcp/tools/descriptor.test.ts` (extend), `src/lib/agents/grant-gate.test.ts` (extend), `src/lib/agents/board-scope-guard.test.ts` (extend)

**Interfaces:**

- Consumes: `AgentCapability` from Task 1.
- Produces:
  - `capabilityFor(d: ToolDescriptor, input: Record<string, unknown>): AgentCapability | null`
  - `scopeFor(d: ToolDescriptor, input: Record<string, unknown>): ToolScope`
  - `TOOL_SCOPES` widened to `["none","boardId","itemId","groupId","columnId","viewId","automationId"]`
  - `ToolDescriptor.capability: AgentCapability | null | Record<string, AgentCapability | null>`
  - `ToolDescriptor.scope: ToolScope | Record<string, ToolScope>`
  - `ToolDescriptor.unscopedCreateActions?: readonly string[]`
  - `OUT_OF_SCOPE_CREATE_ERROR` exported from `src/lib/agents/tools.ts`

  Every Wave 2 task writes descriptors against these shapes.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/mcp/tools/descriptor.test.ts`:

```ts
import { capabilityFor, scopeFor, type ToolDescriptor } from "./descriptor";

const mapped: ToolDescriptor = {
  name: "fake_manage",
  title: "Fake",
  description: "Fake",
  inputSchema: {},
  capability: { create: "board.structure", archive: "board.destroy" },
  scope: { create: "none", archive: "boardId" },
  invoke: async () => ({ content: [{ type: "text", text: "" }] }),
};

describe("capabilityFor", () => {
  it("reads the action's capability from a map", () => {
    expect(capabilityFor(mapped, { action: "create" })).toBe("board.structure");
    expect(capabilityFor(mapped, { action: "archive" })).toBe("board.destroy");
  });

  it("passes a scalar capability through unchanged", () => {
    const scalar = { ...mapped, capability: "board.write" } as ToolDescriptor;
    expect(capabilityFor(scalar, { action: "whatever" })).toBe("board.write");
  });

  // THE safety property. Returning null for an unknown action would classify
  // it as a capability-free READ and let it execute ungated.
  it("fails closed on an action absent from the map", () => {
    expect(capabilityFor(mapped, { action: "nonsense" })).toBe("board.destroy");
    expect(capabilityFor(mapped, {})).toBe("board.destroy");
  });
});

describe("scopeFor", () => {
  it("reads the action's scope from a map", () => {
    expect(scopeFor(mapped, { action: "archive" })).toBe("boardId");
  });

  it("passes a scalar scope through unchanged", () => {
    const scalar = { ...mapped, scope: "itemId" } as ToolDescriptor;
    expect(scopeFor(scalar, { action: "archive" })).toBe("itemId");
  });

  // "none" is the only safe default: it means board scope has nothing to say,
  // and RLS remains the boundary. Guessing "boardId" would read a field that
  // is not there and resolve to null anyway.
  it("falls back to none on an unknown action", () => {
    expect(scopeFor(mapped, { action: "nonsense" })).toBe("none");
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm vitest run src/lib/mcp/tools/descriptor.test.ts`
Expected: FAIL — `capabilityFor` is not exported.

- [ ] **Step 3: Widen the descriptor type and add the resolvers**

In `src/lib/mcp/tools/descriptor.ts`, widen `TOOL_SCOPES`:

```ts
export const TOOL_SCOPES = [
  "none",
  "boardId",
  "itemId",
  "groupId",
  "columnId",
  "viewId",
  "automationId",
] as const;
```

Widen the three descriptor fields:

```ts
export type ToolDescriptor = {
  // …unchanged fields…
  /** A scalar for a single-purpose tool; a per-action map for a
   *  grouped-dispatch tool, keyed by the `action` input value. */
  capability: AgentCapability | null | Record<string, AgentCapability | null>;
  scope: ToolScope | Record<string, ToolScope>;
  /** Actions that create a new top-level object, addressing no existing board.
   *  Refused when the agent's board_scope is narrowed — see `buildAgentTools`. */
  unscopedCreateActions?: readonly string[];
  // …unchanged fields…
};
```

Add the two resolvers below the type:

```ts
/** The most restrictive capability in a map — the fail-closed answer for an
 *  action the map does not name. `board.destroy` outranks `board.structure`
 *  outranks everything else; a map with no non-null value yields the tool's
 *  most restrictive stated grant, never `null`. */
function mostRestrictive(
  map: Record<string, AgentCapability | null>,
): AgentCapability | null {
  const values = Object.values(map).filter(
    (v): v is AgentCapability => v !== null,
  );
  if (values.length === 0) return null;
  if (values.includes("board.destroy")) return "board.destroy";
  if (values.includes("board.structure")) return "board.structure";
  return values[0]!;
}

/**
 * The capability ONE call costs.
 *
 * Every consumer must route through this rather than reading `d.capability`:
 * a grouped-dispatch tool's cost depends on its `action`, and a consumer that
 * reads the field directly sees a `Record` where it expected a string.
 *
 * FAILS CLOSED. An action absent from the map cannot occur — the discriminated
 * union in the handler rejects it first — but this must not depend on that.
 * Returning `null` for an unknown action would classify it as a
 * capability-free read and let it execute ungated, which is exactly the
 * shadowing bug `descriptorsFor` exists to prevent, arriving by another route.
 */
export function capabilityFor(
  d: ToolDescriptor,
  input: Record<string, unknown>,
): AgentCapability | null {
  if (d.capability === null || typeof d.capability === "string")
    return d.capability;
  const action = input.action;
  if (typeof action === "string" && action in d.capability)
    return d.capability[action]!;
  return mostRestrictive(d.capability);
}

/**
 * Which id names the board this call addresses.
 *
 * `"none"` is the fallback rather than a guess: it means board scope has
 * nothing to say about the call, leaving RLS as the boundary — which is the
 * honest answer for an action nobody declared, and is what `resolveTargetBoardId`
 * already does for genuinely board-less tools.
 */
export function scopeFor(
  d: ToolDescriptor,
  input: Record<string, unknown>,
): ToolScope {
  if (typeof d.scope === "string") return d.scope;
  const action = input.action;
  if (typeof action === "string" && action in d.scope) return d.scope[action]!;
  return "none";
}
```

- [ ] **Step 4: Run and confirm the resolver tests pass**

Run: `pnpm vitest run src/lib/mcp/tools/descriptor.test.ts`
Expected: PASS.

- [ ] **Step 5: Route the grant gate through `capabilityFor`**

In `src/lib/agents/grant-gate.ts`, inside the returned closure, replace the three direct reads of `d.capability`. The gate already receives `toolCall.input`:

```ts
return async ({ toolCall }) => {
  const d = byName.get(toolCall.toolName);
  if (!d) return { type: "denied" as const, reason: "Unknown tool." };

  const input = (toolCall.input ?? {}) as Record<string, unknown>;
  const capability = capabilityFor(d, input);
  if (capability === null) return undefined;

  if (!ceiling.has(capability)) {
    return {
      type: "denied" as const,
      reason: `${capability} is disabled for this organization.`,
    };
  }
  if (granted.has(capability)) return undefined;

  args.onPropose({
    toolCallId: toolCall.toolCallId,
    toolName: toolCall.toolName,
    capability,
    input,
  });
  return { type: "denied" as const, reason: UNGRANTED_REASON };
};
```

- [ ] **Step 6: Route the scope guard through `scopeFor` and add three resolvers**

In `src/lib/agents/board-scope-guard.ts`, change `resolveTargetBoardId` to switch on `scopeFor(descriptor, input)` instead of `descriptor.scope`, and add the three new branches:

```ts
export async function resolveTargetBoardId(
  client: SupabaseClient<Database>,
  descriptor: ToolDescriptor,
  input: Record<string, unknown>,
): Promise<string | null> {
  switch (scopeFor(descriptor, input)) {
    case "none":
      return null;
    case "boardId":
      return typeof input.boardId === "string" ? input.boardId : null;
    case "itemId": {
      if (typeof input.itemId !== "string") return null;
      const scope = await resolveItemScope(client, input.itemId);
      return scope?.boardId ?? null;
    }
    case "groupId": {
      if (typeof input.groupId !== "string") return null;
      const { data } = await client
        .from("groups")
        .select("board_id")
        .eq("id", input.groupId)
        .maybeSingle();
      return data?.board_id ?? null;
    }
    // Each of the three below is ONE indexed probe on a primary key, the same
    // shape as the groupId branch. Never a scan.
    case "columnId": {
      if (typeof input.columnId !== "string") return null;
      const { data } = await client
        .from("columns")
        .select("board_id")
        .eq("id", input.columnId)
        .maybeSingle();
      return data?.board_id ?? null;
    }
    case "viewId": {
      if (typeof input.viewId !== "string") return null;
      const { data } = await client
        .from("board_views")
        .select("board_id")
        .eq("id", input.viewId)
        .maybeSingle();
      return data?.board_id ?? null;
    }
    case "automationId": {
      if (typeof input.automationId !== "string") return null;
      const { data } = await client
        .from("automations")
        .select("board_id")
        .eq("id", input.automationId)
        .maybeSingle();
      return data?.board_id ?? null;
    }
  }
}
```

Both table names are verified against `src/types/database.types.ts` (`board_views:1188`, `automations:786`) — they are correct as written.

- [ ] **Step 7: Write the failing test for the create refusal**

Append to `src/lib/agents/board-scope-guard.test.ts`:

```ts
import { refusesUnscopedCreate } from "./board-scope-guard";

describe("refusesUnscopedCreate", () => {
  const d = {
    unscopedCreateActions: ["create"],
  } as unknown as ToolDescriptor;

  it("refuses a create when the agent is scoped to a board list", () => {
    expect(
      refusesUnscopedCreate(
        d,
        { mode: "list", boardIds: ["b1"] },
        {
          action: "create",
        },
      ),
    ).toBe(true);
  });

  it("allows a create when the agent is scoped to all boards", () => {
    expect(
      refusesUnscopedCreate(d, { mode: "all" }, { action: "create" }),
    ).toBe(false);
  });

  it("allows a non-create action under a narrowed scope", () => {
    expect(
      refusesUnscopedCreate(
        d,
        { mode: "list", boardIds: ["b1"] },
        {
          action: "rename",
        },
      ),
    ).toBe(false);
  });

  it("allows everything for a tool that declares no unscoped creates", () => {
    expect(
      refusesUnscopedCreate(
        {} as ToolDescriptor,
        {
          mode: "list",
          boardIds: ["b1"],
        },
        { action: "create" },
      ),
    ).toBe(false);
  });
});
```

- [ ] **Step 8: Run and watch it fail**

Run: `pnpm vitest run src/lib/agents/board-scope-guard.test.ts`
Expected: FAIL — `refusesUnscopedCreate` is not exported.

- [ ] **Step 9: Implement the refusal predicate**

Append to `src/lib/agents/board-scope-guard.ts`:

```ts
/**
 * Whether this call is a create that a NARROWED agent may not make.
 *
 * `board_scope` narrows board-ADDRESSED calls. A create addresses no existing
 * board, so ordinary scope resolution has nothing to catch it on: an agent
 * scoped to boards A and B could create board C and then be unable to touch
 * it. This closes that, and closes it by REFUSING rather than by widening the
 * agent's scope — an agent that edits its own permission config is an
 * escalation primitive a prompt injection can drive one board at a time.
 */
export function refusesUnscopedCreate(
  descriptor: ToolDescriptor,
  scope: BoardScope,
  input: Record<string, unknown>,
): boolean {
  if (scope.mode === "all") return false;
  const actions = descriptor.unscopedCreateActions;
  if (!actions || actions.length === 0) return false;
  return typeof input.action === "string" && actions.includes(input.action);
}
```

- [ ] **Step 10: Enforce it in the tool wrapper**

In `src/lib/agents/tools.ts`, export the copy and check it before the board-scope check — a create has no board to resolve, so it must be caught first:

```ts
/** The refusal a NARROWED agent gets for a create. It names the fix, so the
 *  model reports it to the owner instead of retrying the call. */
export const OUT_OF_SCOPE_CREATE_ERROR =
  "This agent is scoped to specific boards, so it cannot create new ones. " +
  "Ask its owner to widen its scope.";
```

and inside `execute`:

```ts
        execute: async (input: Record<string, unknown>) => {
          if (refusesUnscopedCreate(d, args.scope, input)) {
            return toolFailure(OUT_OF_SCOPE_CREATE_ERROR);
          }
          const boardId = await resolveTargetBoardId(args.client, d, input);
          if (!isBoardInScope(args.scope, boardId)) {
            return toolFailure(OUT_OF_SCOPE_ERROR);
          }
          // …unchanged…
        },
```

- [ ] **Step 11: Run the full agent + MCP suites**

Run: `pnpm vitest run src/lib/agents src/lib/mcp`
Expected: PASS. All 24 existing descriptors keep their scalar fields and are untouched, so nothing existing should move.

- [ ] **Step 12: Typecheck and commit**

```bash
pnpm typecheck && pnpm lint
git add src/lib/mcp/tools/descriptor.ts src/lib/mcp/tools/descriptor.test.ts \
        src/lib/agents/grant-gate.ts src/lib/agents/board-scope-guard.ts \
        src/lib/agents/board-scope-guard.test.ts src/lib/agents/tools.ts
git commit -m "feat(agents): resolve capability and scope per action for dispatch tools"
```

---

## Task 3: Shared plumbing — `toToolResult`, `parseAction`, `getBoardAccessCore`

**Files:**

- Modify: `src/lib/mcp/tools/shared.ts`
- Modify: `src/lib/boards/queries.ts:114-140`
- Test: `src/lib/mcp/tools/shared.test.ts` (create or extend), `src/lib/boards/queries.test.ts` (extend)

**Interfaces:**

- Consumes: `ToolResult` (existing, `shared.ts`), `ActionResult` (existing, `src/lib/actions/result.ts`).
- Produces:
  - `toToolResult<T>(r: ActionResult<T>): ToolResult`
  - `parseAction<T>(schema: z.ZodType<T>, input: Record<string, unknown>): { ok: true; value: T } | { ok: false; result: ToolResult }`
  - `getBoardAccessCore(supabase, userId, boardId): Promise<"owner" | "editor" | "viewer" | null>`
  - `BatchResult<T>` in `src/lib/boards/core/batch.ts`

  Every Wave 2 descriptor uses all four. `BatchResult` lives in Wave 1
  deliberately: Tasks 5, 6 and 7 all return it, and defining it in any one of
  their worktrees would make the other two depend on a branch that has not
  merged — the one thing this wave's independence rests on.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/mcp/tools/shared.test.ts` (or append if it exists):

```ts
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { toToolResult, parseAction } from "./shared";

describe("toToolResult", () => {
  it("serializes a success payload as JSON with no error flag", () => {
    const r = toToolResult({ ok: true, data: { boardId: "b1" } });
    expect(r.isError).toBeUndefined();
    expect(JSON.parse(r.content[0]!.text)).toEqual({ boardId: "b1" });
  });

  // A void action returns `data: undefined`. JSON.stringify(undefined) is
  // undefined, not a string — writing that into `text` yields the string
  // "undefined" and a model reading it cannot tell success from a bug.
  it("renders a void success as an explicit ok marker", () => {
    const r = toToolResult({ ok: true, data: undefined });
    expect(r.isError).toBeUndefined();
    expect(JSON.parse(r.content[0]!.text)).toEqual({ ok: true });
  });

  it("surfaces a failure as the error message with isError set", () => {
    const r = toToolResult({ ok: false, error: "Board not found." });
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toBe("Board not found.");
  });
});

describe("parseAction", () => {
  const schema = z.discriminatedUnion("action", [
    z.object({ action: z.literal("rename"), name: z.string().min(1) }),
    z.object({ action: z.literal("archive") }),
  ]);

  it("returns the narrowed value on a valid input", () => {
    const r = parseAction(schema, { action: "rename", name: "Q3" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ action: "rename", name: "Q3" });
  });

  it("returns a tool failure naming the problem on invalid input", () => {
    const r = parseAction(schema, { action: "rename" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.result.isError).toBe(true);
      expect(r.result.content[0]!.text.length).toBeGreaterThan(0);
    }
  });

  it("rejects an unknown action rather than falling through", () => {
    const r = parseAction(schema, { action: "purge" });
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm vitest run src/lib/mcp/tools/shared.test.ts`
Expected: FAIL — `toToolResult` is not exported.

- [ ] **Step 3: Implement both helpers**

Append to `src/lib/mcp/tools/shared.ts`:

```ts
import type { ActionResult } from "@/lib/actions/result";

/**
 * The one place an `ActionResult` becomes an MCP `ToolResult`.
 *
 * Every core function in this surface returns `ActionResult` — the repo's
 * canonical shape — and every descriptor needs the `{content, isError}`
 * envelope. Hand-rolling that per descriptor is how the two drift: a handler
 * that forgets `isError` reports a refusal to the model as an ordinary success
 * string, and the model then tells the owner the work is done.
 */
export function toToolResult<T>(r: ActionResult<T>): ToolResult {
  if (!r.ok) {
    return { content: [{ type: "text", text: r.error }], isError: true };
  }
  // `data: undefined` is the mutation-only shape. JSON.stringify(undefined)
  // returns undefined, not a string, so an explicit marker goes in instead.
  const text = r.data === undefined ? '{"ok":true}' : JSON.stringify(r.data);
  return { content: [{ type: "text", text }] };
}

/**
 * Validates a grouped-dispatch tool's input against its discriminated union.
 *
 * WHY THIS EXISTS RATHER THAN THE SDK DOING IT: `ToolDescriptor.inputSchema` is
 * a `z.ZodRawShape` because that is what `McpServer.registerTool` takes, and a
 * discriminated union is not a raw shape. So a dispatch tool declares a raw
 * shape whose `action` is a `z.enum` — enough for the SDK and the AI SDK to
 * reject a missing or misspelled action — and applies the real union HERE, as
 * the first statement of `invoke`.
 *
 * The failure is returned as an ordinary tool result, not thrown: the model
 * gets a message it can act on and the run continues.
 */
export function parseAction<T>(
  schema: z.ZodType<T>,
  input: Record<string, unknown>,
): { ok: true; value: T } | { ok: false; result: ToolResult } {
  const parsed = schema.safeParse(input);
  if (parsed.success) return { ok: true, value: parsed.data };
  const issue = parsed.error.issues[0];
  const where = issue?.path.length ? ` at ${issue.path.join(".")}` : "";
  return {
    ok: false,
    result: {
      content: [
        {
          type: "text",
          text: `Invalid input${where}: ${issue?.message ?? "unrecognised action"}`,
        },
      ],
      isError: true,
    },
  };
}
```

- [ ] **Step 4: Run and confirm they pass**

Run: `pnpm vitest run src/lib/mcp/tools/shared.test.ts`
Expected: PASS.

- [ ] **Step 5: Declare the batch result shape**

Create `src/lib/boards/core/batch.ts`:

```ts
/**
 * What a batched create returns.
 *
 * Partial success is a SUCCESS with a report attached: an entry that fails is
 * recorded by `index` and the rest proceed. The caller is a model that can read
 * `errors` and retry precisely, and failing a whole batch for one bad name
 * would throw away work that already landed.
 *
 * It lives here, in the shared layer, rather than in whichever core file
 * happened to need it first — `core/group.ts`, `core/column.ts` and the
 * `create_item` handler all return it, and they are built in three separate
 * worktrees that must not import from one another.
 */
export type BatchResult<T> = {
  created: T[];
  errors: { index: number; error: string }[];
};
```

- [ ] **Step 6: Write the failing test for `getBoardAccessCore`**

Append to `src/lib/boards/queries.test.ts`:

```ts
import { getBoardAccessCore } from "./queries";

describe("getBoardAccessCore", () => {
  it("reports owner when the caller created the board", async () => {
    const client = fakeBoardAccessClient({ created_by: "u1", grant: null });
    await expect(getBoardAccessCore(client, "u1", "b1")).resolves.toBe("owner");
  });

  it("reports the board_members role for a non-creator", async () => {
    const client = fakeBoardAccessClient({
      created_by: "u2",
      grant: { role: "editor" },
    });
    await expect(getBoardAccessCore(client, "u1", "b1")).resolves.toBe(
      "editor",
    );
  });

  it("reports null for a board the caller cannot see", async () => {
    const client = fakeBoardAccessClient({ created_by: null, grant: null });
    await expect(getBoardAccessCore(client, "u1", "b1")).resolves.toBeNull();
  });
});
```

Write `fakeBoardAccessClient` in the same file, following the argument-aware style of `src/test/mcp-fake-client.ts`: it returns `{ from: (t) => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => … }), maybeSingle: async () => … }) }) }) }`, returning the board row for `"boards"` and the grant row for `"board_members"`. Read the real body at `src/lib/boards/queries.ts:114-140` first and match the exact call chain it makes.

- [ ] **Step 7: Run and watch it fail**

Run: `pnpm vitest run src/lib/boards/queries.test.ts`
Expected: FAIL — `getBoardAccessCore` is not exported.

- [ ] **Step 8: Split `getBoardAccess`**

In `src/lib/boards/queries.ts`, move the body of `getBoardAccess` (lines 114-140) into a client-and-user-injected core, and leave the existing export as a two-line wrapper so its ~dozen existing callers are untouched:

```ts
/**
 * The owner/editor/viewer answer for one board, on a caller-supplied client.
 *
 * SPLIT OUT OF `getBoardAccess` because that function reads BOTH `getUser()`
 * and `createClient()` — two cookie dependencies an MCP request does not have.
 * Ported naively, the MCP path would silently lose this guard, and the guard is
 * not cosmetic: an RLS-filtered UPDATE that matches zero rows returns no error,
 * so a non-owner's archive would report success while changing nothing. That is
 * the "lying success" the explicit check exists to prevent (spec F4 / decision
 * D5).
 */
export async function getBoardAccessCore(
  supabase: SupabaseClient<Database>,
  userId: string,
  boardId: string,
): Promise<"owner" | "editor" | "viewer" | null> {
  // …the existing body from line 120 onward, with `user.id` replaced by
  // `userId` and the local `createClient()` call removed…
}

export async function getBoardAccess(
  boardId: string,
): Promise<"owner" | "editor" | "viewer" | null> {
  const user = await getUser();
  if (!user) return null;
  return getBoardAccessCore(await createClient(), user.id, boardId);
}
```

- [ ] **Step 9: Run the board suites**

Run: `pnpm vitest run src/lib/boards`
Expected: PASS, including every existing test that calls `getBoardAccess`.

- [ ] **Step 10: Typecheck and commit**

```bash
pnpm typecheck && pnpm lint
git add src/lib/mcp/tools/shared.ts src/lib/mcp/tools/shared.test.ts \
        src/lib/boards/core/batch.ts \
        src/lib/boards/queries.ts src/lib/boards/queries.test.ts
git commit -m "feat(mcp): add toToolResult, parseAction and getBoardAccessCore"
```

---

# WAVE 2 — six concurrent agents, one git worktree each

Tasks 4 through 9 have no dependency on each other. Dispatch them together with `superpowers:dispatching-parallel-agents`, each in its own worktree via `scripts/start-task.sh <name>`. They all consume Task 2's and Task 3's interfaces and nothing else from one another.

**The one shared file:** each appends a single import + a single array entry to `src/lib/mcp/tools/catalog.ts`. Merge the six worktrees **one at a time**.

**None of these tasks touches `src/lib/agents/proposal-summary.ts`.** That is Task 10, deliberately.

---

## Task 4: `describe_schema`

**Files:**

- Create: `src/lib/mcp/tools/describe-schema.ts`
- Create: `src/lib/mcp/tools/describe-schema.test.ts`
- Modify: `src/lib/mcp/tools/catalog.ts`

**Interfaces:**

- Consumes: `ToolDescriptor` (Task 2), `parseAction` (Task 3), `ColumnKind` from `@/lib/validations/boards`.
- Produces: `describeSchemaDescriptor: ToolDescriptor`, tool name `describe_schema`.

- [ ] **Step 1: Write the failing anti-drift test**

Create `src/lib/mcp/tools/describe-schema.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { columnKindSchema } from "@/lib/validations/boards";
import { widgetKindSchema } from "@/lib/validations/dashboards";
import {
  describeSchemaDescriptor,
  SCHEMA_TOPICS,
  COLUMN_KIND_SCHEMA,
  WIDGET_KIND_SCHEMA,
  REPORT_SHAPE_SCHEMA,
} from "./describe-schema";

const invoke = (input: Record<string, unknown>) =>
  describeSchemaDescriptor.invoke(
    {
      getClient: async () => {
        throw new Error("must not touch the DB");
      },
      actorId: "u1",
    },
    input,
  );

describe("describe_schema", () => {
  // The whole reason it can be capability-free: it costs nothing.
  it("reads no database", async () => {
    await expect(invoke({ topic: "column_kinds" })).resolves.toBeDefined();
  });

  it("is a capability-free, board-less read", () => {
    expect(describeSchemaDescriptor.capability).toBeNull();
    expect(describeSchemaDescriptor.scope).toBe("none");
  });

  // Enumerated from the Zod declarations themselves, never a hand-copied
  // list — that is the whole anti-drift property. A kind added later without a
  // description fails the build instead of shipping a vocabulary gap the model
  // silently works around.
  it("describes every column kind", () => {
    for (const kind of columnKindSchema.options) {
      expect(COLUMN_KIND_SCHEMA[kind], kind).toBeDefined();
      expect(COLUMN_KIND_SCHEMA[kind]!.settings, kind).toBeTruthy();
    }
  });

  it("describes every widget kind", () => {
    for (const kind of widgetKindSchema.options) {
      expect(WIDGET_KIND_SCHEMA[kind], kind).toBeDefined();
      expect(WIDGET_KIND_SCHEMA[kind]!.settings, kind).toBeTruthy();
    }
  });

  it("describes every report scope", () => {
    for (const scope of ["board", "boards", "portfolio", "template"]) {
      expect(REPORT_SHAPE_SCHEMA[scope], scope).toBeDefined();
    }
  });

  it("returns every topic when asked for all", async () => {
    const r = await invoke({});
    const payload = JSON.parse(r.content[0]!.text);
    for (const topic of SCHEMA_TOPICS) {
      if (topic === "all") continue;
      expect(payload[topic], topic).toBeDefined();
    }
  });

  it("returns only the requested topic", async () => {
    const r = await invoke({ topic: "column_kinds" });
    const payload = JSON.parse(r.content[0]!.text);
    expect(Object.keys(payload)).toEqual(["column_kinds"]);
  });
});
```

Both enums are verified: `columnKindSchema` at `src/lib/validations/boards.ts:7` and `widgetKindSchema` at `src/lib/validations/dashboards.ts:7`. `ReportScope` at `src/lib/reports/queries.ts:15` is the four strings listed.

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm vitest run src/lib/mcp/tools/describe-schema.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the vocabularies**

Create `src/lib/mcp/tools/describe-schema.ts`. Fill `COLUMN_KIND_SCHEMA` by reading `columnSettingsSchema(kind)` in `src/lib/validations/boards.ts` and `defaultColumn` in `src/lib/boards/column-defaults.ts` — every entry must describe what those actually accept, not what seems reasonable.

```ts
import { z } from "zod";
import type { ColumnKind } from "@/lib/validations/boards";
import type { ToolDescriptor } from "./descriptor";
import { parseAction } from "./shared";

/**
 * What an agent must know before it can WRITE structure.
 *
 * `column-meta.ts` already tells an agent the value shape each column kind
 * accepts in a CELL. This is its sibling for the column itself, the view, the
 * widget and the report: the `settings` JSON a create takes. A model cannot
 * guess that a status column's options carry ids it chooses, or that a relation
 * column needs `target_board_id`, and a tool description carrying all of it
 * would be paid for on every request by every client. So it is fetched once, on
 * demand, by a tool that costs nothing to call.
 *
 * STATIC BY CONSTRUCTION — no client, no query. That is what lets it be
 * capability-free.
 */
export const SCHEMA_TOPICS = [
  "all",
  "column_kinds",
  "view_types",
  "widget_kinds",
  "report_shapes",
] as const;
export type SchemaTopic = (typeof SCHEMA_TOPICS)[number];

export type SchemaEntry = {
  /** The shape of the `settings` object this kind accepts. */
  settings: string;
  /** A minimal object that really works, so the model has a starting point. */
  example?: Record<string, unknown>;
  /** A constraint the shape alone cannot express. */
  note?: string;
};

/** One entry per `columnKindSchema` option. Derive each from
 *  `columnSettingsSchema(kind)` in `src/lib/validations/boards.ts` and
 *  `defaultColumn` in `src/lib/boards/column-defaults.ts`. The test above
 *  fails until every kind is present, so this list cannot ship partial. */
export const COLUMN_KIND_SCHEMA: Record<ColumnKind, SchemaEntry> = {
  status: {
    settings: "{ options: [{ id: string, label: string, color: string }] }",
    example: {
      options: [
        { id: "todo", label: "To Do", color: "gray" },
        { id: "doing", label: "In Progress", color: "blue" },
        { id: "done", label: "Done", color: "green" },
      ],
    },
    note: "Option ids are yours to choose; a cell stores one optionId.",
  },
  numbers: {
    settings: "{ unit?: string, precision?: number }",
    example: { unit: "$", precision: 2 },
  },
  relation: {
    settings: "{ target_board_id: string }",
    note: "The target board must be one you can read. Link rows with the item tools, not with a cell value.",
  },
  // …one entry per remaining ColumnKind…
};

export const VIEW_TYPE_SCHEMA: Record<string, SchemaEntry> = {
  table: { settings: "{}", note: "The default view; config may be empty." },
  kanban: {
    settings: "{ groupByColumnId: string }",
    note: "Must name a status column on the same board.",
  },
  calendar: { settings: "{ dateColumnId: string }" },
  timeline: { settings: "{ startColumnId: string, endColumnId: string }" },
};

/** Six kinds: number, chart, battery, list, completion, health. Derive each
 *  entry from `configSchemaForKind(kind)` in
 *  `src/lib/validations/dashboards.ts:145` — describe what that schema really
 *  accepts, not what seems reasonable. The test fails until all six are here. */
export const WIDGET_KIND_SCHEMA: Record<string, SchemaEntry> = {
  number: {
    settings: '{ agg: "count" | "sum" | "avg", valueColumnId?: string }',
    example: { agg: "count" },
    note: "valueColumnId is required for sum and avg, and must be a numbers column.",
  },
  // …chart, battery, list, completion, health…
};

/** The four values of `ReportScope` (`src/lib/reports/queries.ts:15`) and the
 *  id each one requires alongside it. */
export const REPORT_SHAPE_SCHEMA: Record<string, SchemaEntry> = {
  board: {
    settings: '{ scope: "board", boardId: string }',
    example: { scope: "board", boardId: "<a board id>" },
  },
  boards: {
    settings: '{ scope: "boards", boardIds: string[] }',
    note: "Every board must be one you can read.",
  },
  portfolio: {
    settings: '{ scope: "portfolio", portfolioId: string }',
  },
  template: {
    settings: '{ scope: "template" }',
    note: "A saved shape with no bound data; bind it when you create from it.",
  },
};

const TOPIC_DATA: Record<Exclude<SchemaTopic, "all">, unknown> = {
  column_kinds: COLUMN_KIND_SCHEMA,
  view_types: VIEW_TYPE_SCHEMA,
  widget_kinds: WIDGET_KIND_SCHEMA,
  report_shapes: REPORT_SHAPE_SCHEMA,
};

const describeSchemaInput = {
  topic: z.enum(SCHEMA_TOPICS).optional(),
};

const describeSchemaArgs = z.object({
  topic: z.enum(SCHEMA_TOPICS).optional(),
});

export const describeSchemaDescriptor: ToolDescriptor = {
  name: "describe_schema",
  title: "Describe schema",
  description:
    "Look up the settings shape and a working example for each column kind, " +
    "view type, widget kind and report shape. Call this before creating " +
    "columns, views, widgets or reports — the settings each one accepts " +
    "cannot be guessed. Reads no data and costs nothing.",
  inputSchema: describeSchemaInput,
  capability: null,
  scope: "none",
  invoke: async (_ctx, input) => {
    const parsed = parseAction(describeSchemaArgs, input);
    if (!parsed.ok) return parsed.result;
    const topic = parsed.value.topic ?? "all";
    const payload =
      topic === "all"
        ? TOPIC_DATA
        : { [topic]: TOPIC_DATA[topic as Exclude<SchemaTopic, "all">] };
    return { content: [{ type: "text", text: JSON.stringify(payload) }] };
  },
};
```

- [ ] **Step 4: Register it**

In `src/lib/mcp/tools/catalog.ts`, add the import and append `describeSchemaDescriptor` to `ALL_TOOL_DESCRIPTORS`.

- [ ] **Step 5: Run the tests**

Run: `pnpm vitest run src/lib/mcp/tools/describe-schema.test.ts`
Expected: PASS. `src/lib/mcp/tools/descriptor.test.ts` will FAIL on its hardcoded count of 24 — that is expected and is fixed once, in Task 11. Do not edit it here; six worktrees editing the same assertion is the conflict this plan exists to avoid.

- [ ] **Step 6: Gate and finish**

```bash
pnpm typecheck && pnpm lint && pnpm build
git add src/lib/mcp/tools/describe-schema.ts \
        src/lib/mcp/tools/describe-schema.test.ts \
        src/lib/mcp/tools/catalog.ts
git commit -m "feat(mcp): add describe_schema vocabulary tool"
```

Then `scripts/finish-task.sh` from inside the worktree.

---

## Task 5 (Unit A): `manage_board` + `manage_group`

**Files:**

- Create: `src/lib/boards/core/board.ts`, `src/lib/boards/core/group.ts`
- Create: `src/lib/mcp/tools/manage-board.ts`, `src/lib/mcp/tools/manage-group.ts`
- Modify: `src/lib/boards/actions/board.ts` (lines 58, 77, 185, 216, 240 — `createBoard`, `renameBoard`, `duplicateBoard`, `archiveBoard`, `restoreBoard`)
- Modify: `src/lib/boards/actions/group.ts` (lines 30, 50, 91, 111, 152, 167 — `renameGroup`, `createGroup`, `reorderGroup`, `updateGroupColor`, `archiveGroup`, `restoreGroup`)
- Modify: `src/lib/mcp/tools/catalog.ts`
- Test: `src/lib/boards/core/board.test.ts`, `src/lib/boards/core/group.test.ts`, `src/lib/mcp/tools/manage-board.test.ts`, `src/lib/mcp/tools/manage-group.test.ts`, `src/lib/mcp/tools/manage-board.rls.integration.test.ts`

**Interfaces:**

- Consumes: `toToolResult`, `parseAction`, `getBoardAccessCore`, `BatchResult` (Task 3); `capabilityFor`, `scopeFor`, `unscopedCreateActions` (Task 2); `midpoint` from `@/lib/boards/position`.
- Produces:
  - `createBoardCore(supabase, input: {workspaceId, name}): Promise<ActionResult<{boardId: string}>>`
  - `renameBoardCore(supabase, input: {boardId, name}): Promise<ActionResult>`
  - `duplicateBoardCore(supabase, userId, input: {boardId}): Promise<ActionResult<{boardId: string}>>`
  - `archiveBoardCore(supabase, userId, input: {boardId}): Promise<ActionResult>`
  - `restoreBoardCore(supabase, userId, input: {boardId}): Promise<ActionResult>`
  - `createGroupsCore(supabase, input: {boardId, groups: {name: string}[]}): Promise<ActionResult<{created: Tables<"groups">[]; errors: {index: number; error: string}[]}>>`
  - `renameGroupCore`, `reorderGroupCore`, `recolorGroupCore`, `archiveGroupCore`, `restoreGroupCore` — each `(supabase, input) => Promise<ActionResult>`
  - `manageBoardDescriptor`, `manageGroupDescriptor`

- [ ] **Step 1: Write the failing core test for the batched group create**

Create `src/lib/boards/core/group.test.ts`. The batch behaviour is the part with real logic; the single-target cores are moved bodies whose existing tests already cover them.

```ts
import { describe, expect, it, vi } from "vitest";
import { createGroupsCore } from "./group";

/** Records every `.from(table)` and every insert payload, so the test can
 *  assert the board was read ONCE for the whole batch. */
function fakeClient(opts: { orgId: string | null; failAt?: number }) {
  const reads: string[] = [];
  let inserted = 0;
  const client = {
    from(table: string) {
      reads.push(table);
      return {
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: () => ({
                maybeSingle: async () => ({
                  data: { position: 1 },
                  error: null,
                }),
              }),
            }),
            maybeSingle: async () =>
              opts.orgId
                ? { data: { org_id: opts.orgId }, error: null }
                : { data: null, error: null },
          }),
        }),
        insert: () => ({
          select: () => ({
            single: async () => {
              const i = inserted++;
              return i === opts.failAt
                ? { data: null, error: { message: "duplicate name" } }
                : { data: { id: `g${i}`, name: `G${i}` }, error: null };
            },
          }),
        }),
      };
    },
  };
  return { client: client as never, reads: () => reads };
}

describe("createGroupsCore", () => {
  it("creates every group and reports no errors", async () => {
    const { client } = fakeClient({ orgId: "o1" });
    const r = await createGroupsCore(client, {
      boardId: "b1",
      groups: [{ name: "A" }, { name: "B" }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.created).toHaveLength(2);
      expect(r.data.errors).toEqual([]);
    }
  });

  // Working agreement #5: a per-entry board read is an N-query hot path.
  it("reads the board exactly once for the whole batch", async () => {
    const { client, reads } = fakeClient({ orgId: "o1" });
    await createGroupsCore(client, {
      boardId: "b1",
      groups: [{ name: "A" }, { name: "B" }, { name: "C" }],
    });
    expect(reads().filter((t) => t === "boards")).toHaveLength(1);
  });

  it("reports a per-entry failure by index and keeps the rest", async () => {
    const { client } = fakeClient({ orgId: "o1", failAt: 1 });
    const r = await createGroupsCore(client, {
      boardId: "b1",
      groups: [{ name: "A" }, { name: "B" }, { name: "C" }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.created).toHaveLength(2);
      expect(r.data.errors).toEqual([{ index: 1, error: "duplicate name" }]);
    }
  });

  it("fails outright when the board is unreadable", async () => {
    const { client } = fakeClient({ orgId: null });
    const r = await createGroupsCore(client, {
      boardId: "b1",
      groups: [{ name: "A" }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("Board not found.");
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm vitest run src/lib/boards/core/group.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/lib/boards/core/group.ts`**

Move the bodies of `renameGroup` (group.ts:30-49), `reorderGroup` (91-110), `updateGroupColor` (111-130), `archiveGroup` (152-166) and `restoreGroup` (167-186) verbatim into cores, replacing each `const supabase = await createClient();` with the injected `supabase` parameter and keeping every guard and message byte-identical. Then write the batched create, which is `createGroup`'s body (50-89) with the board read hoisted out of the loop:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/types/database.types";
import { midpoint } from "@/lib/boards/position";
import { fail, type ActionResult } from "@/lib/actions/result";
import type { BatchResult } from "./batch";

/**
 * Create one or more groups on a board.
 *
 * The board is read ONCE, before the loop, and its `org_id` reused for every
 * insert — a read per entry would be an N-query hot path over a growing table
 * (working agreement #5), and it is the single most likely performance defect
 * in the batched creates.
 *
 * Partial success is a SUCCESS with a report attached. An entry that fails is
 * recorded by index and the rest proceed: the caller is a model that can read
 * `errors` and retry precisely, and failing the whole batch for one bad name
 * would throw away work that already landed.
 */
export async function createGroupsCore(
  supabase: SupabaseClient<Database>,
  input: { boardId: string; groups: { name: string }[] },
): Promise<ActionResult<BatchResult<Tables<"groups">>>> {
  const { data: board, error: boardErr } = await supabase
    .from("boards")
    .select("org_id")
    .eq("id", input.boardId)
    .maybeSingle();
  if (boardErr || !board) return fail("Board not found.");

  const { data: last } = await supabase
    .from("groups")
    .select("position")
    .eq("board_id", input.boardId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  let position = last?.position ?? null;
  const created: Tables<"groups">[] = [];
  const errors: { index: number; error: string }[] = [];

  for (const [index, g] of input.groups.entries()) {
    position = midpoint(position, null);
    const { data, error } = await supabase
      .from("groups")
      .insert({
        org_id: board.org_id,
        board_id: input.boardId,
        name: g.name,
        position,
      })
      .select("*")
      .single();
    if (error || !data) {
      errors.push({
        index,
        error: error?.message ?? "Could not create group.",
      });
      continue;
    }
    created.push(data);
  }

  return { ok: true, data: { created, errors } };
}
```

- [ ] **Step 4: Run and confirm the core tests pass**

Run: `pnpm vitest run src/lib/boards/core/group.test.ts`
Expected: PASS, all four.

- [ ] **Step 5: Write `src/lib/boards/core/board.ts`**

Move the bodies of `createBoard` (board.ts:58-75), `renameBoard` (77-115), `duplicateBoard` (185-214), `archiveBoard` (216-238) and `restoreBoard` (240-262) into cores.

Three rules, all load-bearing:

- **`archiveBoardCore`, `restoreBoardCore` and `duplicateBoardCore` take `userId`** and call `getBoardAccessCore(supabase, userId, boardId)` — not `getBoardAccess(boardId)`, which reads cookies and would throw on the MCP path. The owner-only guard and its exact message (`"Only the board owner can delete this board."`, and `"Only the board owner can restore this board."` for restore) must survive the move verbatim.
- **`invalidateMyBoards()` does NOT move into the core.** It is a Next.js cache concern. It stays in the Server Action, after the core call.
- **`deleteBoard` and `purgeBoard` are not touched at all.** They stay Server-Action-only. No core, no tool. Spec §5.

- [ ] **Step 6: Rewrite the five board Server Actions as thin wrappers**

Each keeps its Zod parse and its `revalidate`/`invalidateMyBoards` call and delegates the body. `createBoard` becomes:

```ts
export async function createBoard(input: {
  workspaceId: string;
  name: string;
}): Promise<ActionResult<{ boardId: string }>> {
  const parsed = createBoardSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const result = await createBoardCore(await createClient(), parsed.data);
  if (result.ok) await invalidateMyBoards();
  return result;
}
```

Do the same for `renameBoard`, `duplicateBoard`, `archiveBoard` and `restoreBoard`; the three that guard on ownership pass `(await getUser())?.id`, returning `fail("Board not found.")` when there is no user.

- [ ] **Step 7: Run the existing board and group action suites**

Run: `pnpm vitest run src/lib/boards/actions`
Expected: PASS with no test edits. If a test fails, the move changed behaviour — fix the core, not the test.

- [ ] **Step 8: Write the failing descriptor test**

Create `src/lib/mcp/tools/manage-board.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { manageBoardDescriptor } from "./manage-board";
import { capabilityFor, scopeFor } from "./descriptor";

describe("manage_board classification", () => {
  it("charges structure for builds and destroy for archive", () => {
    expect(capabilityFor(manageBoardDescriptor, { action: "create" })).toBe(
      "board.structure",
    );
    expect(capabilityFor(manageBoardDescriptor, { action: "rename" })).toBe(
      "board.structure",
    );
    expect(capabilityFor(manageBoardDescriptor, { action: "restore" })).toBe(
      "board.structure",
    );
    expect(capabilityFor(manageBoardDescriptor, { action: "archive" })).toBe(
      "board.destroy",
    );
  });

  it("addresses no board on create and the board itself otherwise", () => {
    expect(scopeFor(manageBoardDescriptor, { action: "create" })).toBe("none");
    expect(scopeFor(manageBoardDescriptor, { action: "archive" })).toBe(
      "boardId",
    );
  });

  it("declares create as an unscoped create", () => {
    expect(manageBoardDescriptor.unscopedCreateActions).toEqual(["create"]);
  });

  it("exposes no delete or purge action", async () => {
    const r = await manageBoardDescriptor.invoke(
      {
        getClient: async () => {
          throw new Error("unreachable");
        },
        actorId: "u1",
      },
      { action: "delete", boardId: "00000000-0000-0000-0000-000000000001" },
    );
    expect(r.isError).toBe(true);
  });
});
```

- [ ] **Step 9: Run and watch it fail**

Run: `pnpm vitest run src/lib/mcp/tools/manage-board.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 10: Write `src/lib/mcp/tools/manage-board.ts`**

```ts
import { z } from "zod";
import type { ToolDescriptor } from "./descriptor";
import { parseAction, toToolResult } from "./shared";
import {
  archiveBoardCore,
  createBoardCore,
  duplicateBoardCore,
  renameBoardCore,
  restoreBoardCore,
} from "@/lib/boards/core/board";

const uuid = z.string().uuid();
const boardName = z.string().trim().min(1).max(120);

/** The real validation. Applied inside `invoke` because `inputSchema` must be
 *  a raw shape for `registerTool`, and a discriminated union is not one. */
const manageBoardArgs = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), workspaceId: uuid, name: boardName }),
  z.object({ action: z.literal("rename"), boardId: uuid, name: boardName }),
  z.object({ action: z.literal("archive"), boardId: uuid }),
  z.object({ action: z.literal("restore"), boardId: uuid }),
  z.object({ action: z.literal("duplicate"), boardId: uuid }),
]);

/** What the SDK sees. `action` is an enum so a misspelling is rejected before
 *  the handler; the per-action fields are optional here and required by the
 *  union above. */
const manageBoardInput = {
  action: z.enum(["create", "rename", "archive", "restore", "duplicate"]),
  boardId: uuid.optional(),
  workspaceId: uuid.optional(),
  name: boardName.optional(),
};

export const manageBoardDescriptor: ToolDescriptor = {
  name: "manage_board",
  title: "Manage board",
  description:
    "Create, rename, duplicate, archive or restore a board. Archiving moves a " +
    "board to Trash and is reversible with restore; there is no permanent " +
    "delete — ask a person to empty the Trash.",
  inputSchema: manageBoardInput,
  capability: {
    create: "board.structure",
    rename: "board.structure",
    duplicate: "board.structure",
    restore: "board.structure",
    archive: "board.destroy",
  },
  scope: {
    create: "none",
    rename: "boardId",
    duplicate: "boardId",
    restore: "boardId",
    archive: "boardId",
  },
  unscopedCreateActions: ["create"],
  invoke: async (ctx, input) => {
    const parsed = parseAction(manageBoardArgs, input);
    if (!parsed.ok) return parsed.result;
    const args = parsed.value;
    const supabase = await ctx.getClient();

    switch (args.action) {
      case "create":
        return toToolResult(await createBoardCore(supabase, args));
      case "rename":
        return toToolResult(await renameBoardCore(supabase, args));
      case "duplicate":
        return toToolResult(
          await duplicateBoardCore(supabase, ctx.actorId, args),
        );
      case "archive":
        return toToolResult(
          await archiveBoardCore(supabase, ctx.actorId, args),
        );
      case "restore":
        return toToolResult(
          await restoreBoardCore(supabase, ctx.actorId, args),
        );
    }
  },
};
```

Call `ctx.getClient()` **exactly once** per invocation — each call charges the MCP rate limit and rotates the OAuth bridge secret (`src/lib/mcp/tools/shared.ts` documents this).

- [ ] **Step 11: Write `src/lib/mcp/tools/manage-group.ts`**

Same structure. Actions and their classification:

| Action    | Input                                | Capability        | Scope     |
| --------- | ------------------------------------ | ----------------- | --------- |
| `create`  | `boardId`, `groups: {name}[]` (1-50) | `board.structure` | `boardId` |
| `rename`  | `groupId`, `name`                    | `board.structure` | `groupId` |
| `reorder` | `groupId`, `position: number`        | `board.structure` | `groupId` |
| `recolor` | `groupId`, `color: string`           | `board.structure` | `groupId` |
| `archive` | `groupId`                            | `board.destroy`   | `groupId` |
| `restore` | `groupId`                            | `board.structure` | `groupId` |

`unscopedCreateActions` is **omitted** — `create` takes a `boardId` and is caught by ordinary scope resolution. Cap the batch with `.max(50)` on the `groups` array. There is no `delete` action.

- [ ] **Step 12: Write the RLS integration test**

Create `src/lib/mcp/tools/manage-board.rls.integration.test.ts`, following the pattern in `src/lib/mcp/tools/list-items.rls.integration.test.ts` (skips unless `PULSE_TEST_DB` is set). It must assert:

1. A second org's user cannot archive a board in the first org.
2. **A non-owner org MEMBER cannot archive a board they can otherwise read** — the owner-only guard, and the reason `getBoardAccessCore` exists. Expect the message `"Only the board owner can delete this board."`, not a silent success.

- [ ] **Step 13: Register both and run everything**

Add both descriptors to `src/lib/mcp/tools/catalog.ts`.

Run: `pnpm vitest run src/lib/boards src/lib/mcp`
Expected: PASS except `descriptor.test.ts`'s hardcoded count of 24 — expected, fixed in Task 11.

- [ ] **Step 14: Gate and finish**

```bash
pnpm typecheck && pnpm lint && pnpm build
git add src/lib/boards/core/board.ts src/lib/boards/core/group.ts \
        src/lib/boards/core/board.test.ts src/lib/boards/core/group.test.ts \
        src/lib/boards/actions/board.ts src/lib/boards/actions/group.ts \
        src/lib/mcp/tools/manage-board.ts src/lib/mcp/tools/manage-group.ts \
        src/lib/mcp/tools/manage-board.test.ts \
        src/lib/mcp/tools/manage-group.test.ts \
        src/lib/mcp/tools/manage-board.rls.integration.test.ts \
        src/lib/mcp/tools/catalog.ts
git commit -m "feat(mcp): add manage_board and manage_group tools"
```

Then `scripts/finish-task.sh`.

---

## Task 6 (Unit B): `manage_column`

**Files:**

- Create: `src/lib/boards/core/column.ts`, `src/lib/mcp/tools/manage-column.ts`
- Modify: `src/lib/boards/actions/column.ts` (all eight exports, lines 21-244)
- Modify: `src/lib/mcp/tools/catalog.ts`
- Test: `src/lib/boards/core/column.test.ts`, `src/lib/mcp/tools/manage-column.test.ts`, `src/lib/mcp/tools/manage-column.rls.integration.test.ts`

**Interfaces:**

- Consumes: `toToolResult`, `parseAction`, `BatchResult` (Task 3); `capabilityFor`, `scopeFor`, `TOOL_SCOPES` including `"columnId"` (Task 2); `defaultColumn` from `@/lib/boards/column-defaults`; `columnSettingsSchema` from `@/lib/validations/boards`; `midpoint` from `@/lib/boards/position`.
- Produces:
  - `createColumnsCore(supabase, input: {boardId, columns: {kind: ColumnKind; name?: string; settings?: Record<string, unknown>}[]}): Promise<ActionResult<BatchResult<Tables<"columns">>>>`
  - `renameColumnCore`, `resizeColumnCore`, `reorderColumnCore`, `updateColumnSettingsCore`, `deleteColumnCore` — each `(supabase, input) => Promise<ActionResult>`
  - `removeColumnOptionCore(supabase, input: {columnId, optionId}): Promise<ActionResult<{clearedCells: number}>>`
  - `manageColumnDescriptor`

- [ ] **Step 1: Write the failing core test**

Create `src/lib/boards/core/column.test.ts`. The batch create carries the real logic — per-entry settings validation against the kind's own schema, which is the guard that must not be lost in the move:

```ts
import { describe, expect, it } from "vitest";
import { createColumnsCore } from "./column";

function fakeClient(orgId: string | null) {
  const reads: string[] = [];
  let n = 0;
  return {
    reads: () => reads,
    client: {
      from(table: string) {
        reads.push(table);
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => ({
                    data: { position: 1 },
                    error: null,
                  }),
                }),
              }),
              maybeSingle: async () =>
                orgId
                  ? { data: { org_id: orgId }, error: null }
                  : { data: null, error: null },
            }),
          }),
          insert: () => ({
            select: () => ({
              single: async () => ({
                data: { id: `c${n++}`, kind: "text" },
                error: null,
              }),
            }),
          }),
        };
      },
    } as never,
  };
}

describe("createColumnsCore", () => {
  it("creates each column and applies the kind's default settings", async () => {
    const { client } = fakeClient("o1");
    const r = await createColumnsCore(client, {
      boardId: "b1",
      columns: [{ kind: "text" }, { kind: "status" }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.created).toHaveLength(2);
  });

  it("reads the board exactly once for the whole batch", async () => {
    const { client, reads } = fakeClient("o1");
    await createColumnsCore(client, {
      boardId: "b1",
      columns: [{ kind: "text" }, { kind: "text" }, { kind: "text" }],
    });
    expect(reads().filter((t) => t === "boards")).toHaveLength(1);
  });

  // The guard that MUST survive the move: settings are validated against the
  // kind's own schema, so a relation column without target_board_id is
  // rejected rather than written and later exploding on read.
  it("rejects settings that do not match the kind, by index", async () => {
    const { client } = fakeClient("o1");
    const r = await createColumnsCore(client, {
      boardId: "b1",
      columns: [
        { kind: "text" },
        { kind: "relation", settings: { nonsense: true } },
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.created).toHaveLength(1);
      expect(r.data.errors[0]!.index).toBe(1);
    }
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm vitest run src/lib/boards/core/column.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/lib/boards/core/column.ts`**

Move `renameColumn` (column.ts:92-109), `resizeColumn` (110-128), `reorderColumn` (129-153), `updateColumnSettings` (175-205), `removeColumnOption` (206-223) and `deleteColumn` (224-244) into cores, injecting `supabase` and keeping every message verbatim. Move the private `columnBoardId` helper alongside them.

The batch create is `createColumn`'s body (21-75) with the board read hoisted and the per-kind settings validation applied per entry:

```ts
export async function createColumnsCore(
  supabase: SupabaseClient<Database>,
  input: {
    boardId: string;
    columns: {
      kind: ColumnKind;
      name?: string;
      settings?: Record<string, unknown>;
    }[];
  },
): Promise<ActionResult<BatchResult<Tables<"columns">>>> {
  const { data: board, error: boardErr } = await supabase
    .from("boards")
    .select("org_id")
    .eq("id", input.boardId)
    .maybeSingle();
  if (boardErr || !board) return fail("Board not found.");

  const { data: last } = await supabase
    .from("columns")
    .select("position")
    .eq("board_id", input.boardId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  let position = last?.position ?? null;
  const created: Tables<"columns">[] = [];
  const errors: { index: number; error: string }[] = [];

  for (const [index, c] of input.columns.entries()) {
    // Per-kind validation, kept from createColumn: a relation column must
    // carry target_board_id, a status column's options must parse. Writing an
    // unvalidated blob here surfaces as a crash on the board page later.
    let initialSettings: Record<string, unknown> | null = null;
    if (c.settings) {
      const settingsParsed = columnSettingsSchema(c.kind).safeParse(c.settings);
      if (!settingsParsed.success) {
        errors.push({
          index,
          error: settingsParsed.error.issues[0]?.message ?? "Invalid settings",
        });
        continue;
      }
      initialSettings = settingsParsed.data as Record<string, unknown>;
    }

    const { name, settings } = defaultColumn(c.kind, c.name);
    position = midpoint(position, null);
    const { data, error } = await supabase
      .from("columns")
      .insert({
        org_id: board.org_id,
        board_id: input.boardId,
        kind: c.kind,
        name,
        settings: (initialSettings ??
          settings) as Tables<"columns">["settings"],
        position,
      })
      .select("*")
      .single();
    if (error || !data) {
      errors.push({
        index,
        error: error?.message ?? "Could not create column.",
      });
      continue;
    }
    created.push(data);
  }

  return { ok: true, data: { created, errors } };
}
```

- [ ] **Step 4: Run and confirm the core tests pass**

Run: `pnpm vitest run src/lib/boards/core/column.test.ts`
Expected: PASS.

- [ ] **Step 5: Rewrite the eight column Server Actions as wrappers**

Each keeps its Zod parse and delegates. `createColumn` keeps its **single-column** signature and public contract exactly — the board UI calls it with one column — and delegates to the batch core with a one-element array, unwrapping the result:

```ts
export async function createColumn(input: {
  boardId: string;
  kind: ColumnKind;
  name?: string;
  settings?: Record<string, unknown>;
}): Promise<ActionResult<{ column: Tables<"columns"> }>> {
  const parsed = createColumnSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const { boardId, ...column } = parsed.data;
  const r = await createColumnsCore(await createClient(), {
    boardId,
    columns: [column],
  });
  if (!r.ok) return r;
  const first = r.data.created[0];
  if (!first)
    return fail(r.data.errors[0]?.error ?? "Could not create column.");
  return { ok: true, data: { column: first } };
}
```

`resizeNameColumn` writes to `boards`, not `columns`, and is board-scoped UI chrome. Leave it as-is; it gets no core and no tool action.

- [ ] **Step 6: Run the existing column suites**

Run: `pnpm vitest run src/lib/boards/actions/column.test.ts src/lib/boards/column-options.test.ts`
Expected: PASS with no test edits.

- [ ] **Step 7: Write `src/lib/mcp/tools/manage-column.ts`**

Actions and classification:

| Action          | Input                                                   | Capability        | Scope      |
| --------------- | ------------------------------------------------------- | ----------------- | ---------- |
| `create`        | `boardId`, `columns: {kind, name?, settings?}[]` (1-50) | `board.structure` | `boardId`  |
| `rename`        | `columnId`, `name`                                      | `board.structure` | `columnId` |
| `configure`     | `columnId`, `settings`                                  | `board.structure` | `columnId` |
| `reorder`       | `columnId`, `position: number`                          | `board.structure` | `columnId` |
| `resize`        | `columnId`, `width: number`                             | `board.structure` | `columnId` |
| `delete`        | `columnId`                                              | `board.destroy`   | `columnId` |
| `remove_option` | `columnId`, `optionId`                                  | `board.destroy`   | `columnId` |

Structure exactly as `manage_board` in Task 5 Step 10: a `z.discriminatedUnion("action", …)` applied via `parseAction` as the first statement of `invoke`, a raw `inputSchema` whose `action` is a `z.enum`, one `ctx.getClient()` call, and a `switch` returning `toToolResult(await …Core(...))`. No `unscopedCreateActions` — `create` takes a `boardId`.

The description must point at `describe_schema`, because a model cannot guess `settings`:

```ts
  description:
    "Create, rename, reconfigure, reorder, resize or delete board columns. " +
    "Call describe_schema first to learn the settings each column kind " +
    "accepts — status and dropdown options, relation targets and number " +
    "formats cannot be guessed. Deleting a column also deletes its cell " +
    "values and cannot be undone.",
```

- [ ] **Step 8: Write the descriptor test**

Create `src/lib/mcp/tools/manage-column.test.ts`, asserting: `capabilityFor` returns `board.destroy` for `delete` and `remove_option` and `board.structure` for the other five; `scopeFor` returns `"boardId"` for `create` and `"columnId"` for the rest; a batch of 51 columns is rejected by `parseAction`; and a `relation` column with no `target_board_id` comes back in `errors` rather than being written.

- [ ] **Step 9: Write the RLS integration test**

Create `src/lib/mcp/tools/manage-column.rls.integration.test.ts` on the `list-items.rls.integration.test.ts` pattern: a second org's user cannot create a column on, or delete a column from, the first org's board.

- [ ] **Step 10: Register, run, gate, finish**

Add `manageColumnDescriptor` to `src/lib/mcp/tools/catalog.ts`.

```bash
pnpm vitest run src/lib/boards src/lib/mcp
pnpm typecheck && pnpm lint && pnpm build
git add src/lib/boards/core/column.ts src/lib/boards/core/column.test.ts \
        src/lib/boards/actions/column.ts \
        src/lib/mcp/tools/manage-column.ts \
        src/lib/mcp/tools/manage-column.test.ts \
        src/lib/mcp/tools/manage-column.rls.integration.test.ts \
        src/lib/mcp/tools/catalog.ts
git commit -m "feat(mcp): add manage_column tool"
```

`descriptor.test.ts`'s count of 24 fails; expected, fixed in Task 11. Then `scripts/finish-task.sh`.

---

## Task 7 (Unit C): `manage_item` + `create_item` batch form

**Files:**

- Create: `src/lib/boards/core/item.ts`, `src/lib/mcp/tools/manage-item.ts`
- Modify: `src/lib/boards/actions/item.ts` (lines 62, 154, 169, 222, 253 — `addSubitem`, `archiveItem`, `restoreItem`, `reorderItem`, `moveItem`)
- Modify: `src/lib/mcp/tools/create-item.ts`
- Modify: `src/lib/mcp/tools/catalog.ts`
- Test: `src/lib/boards/core/item.test.ts`, `src/lib/mcp/tools/manage-item.test.ts`, `src/lib/mcp/tools/create-item.test.ts` (extend), `src/lib/mcp/tools/manage-item.rls.integration.test.ts`

**Interfaces:**

- Consumes: `toToolResult`, `parseAction` (Task 3); `capabilityFor`, `scopeFor` (Task 2); `writeCellValue`, `fieldInput`, `FieldInput` from `src/lib/mcp/tools/shared.ts`.
- Produces:
  - `addSubitemCore(supabase, input: {parentId, name}): Promise<ActionResult<{item: Tables<"items">}>>`
  - `archiveItemCore`, `restoreItemCore`, `reorderItemCore` — each `(supabase, input) => Promise<ActionResult>`
  - `moveItemCore(supabase, input: {itemId, groupId, position?}): Promise<ActionResult<{item: Tables<"items">; subitemIds: string[]}>>`
  - `manageItemDescriptor`
  - `create_item` accepting `{groupId, items: {name, fields?}[]}` **in addition to** its existing `{groupId, name, fields?}`

- [ ] **Step 1: Write the failing test for the additive batch form**

Append to `src/lib/mcp/tools/create-item.test.ts`. The back-compatibility assertion matters most: shipped MCP clients and stored agent instructions use the single form, and breaking it is a silent outage in someone else's tool.

```ts
describe("create_item batch form", () => {
  it("still accepts the original single-item input unchanged", async () => {
    const { getClient } = fakeCreateItemClient();
    const r = await createItemHandler(
      getClient,
      { groupId: "g1", name: "One" },
      "u1",
    );
    expect(r.isError).toBeUndefined();
    expect(JSON.parse(r.content[0]!.text).item.name).toBe("One");
  });

  it("creates every item in a batch and reports per-entry errors", async () => {
    const { getClient } = fakeCreateItemClient({ failAt: 1 });
    const r = await createItemHandler(
      getClient,
      { groupId: "g1", items: [{ name: "A" }, { name: "B" }, { name: "C" }] },
      "u1",
    );
    const payload = JSON.parse(r.content[0]!.text);
    expect(payload.created).toHaveLength(2);
    expect(payload.errors).toEqual([{ index: 1, error: expect.any(String) }]);
  });

  // Matches create_item's existing fieldErrors rule exactly: a partial
  // success is a success. Only a total failure sets isError.
  it("sets isError only when every entry fails", async () => {
    const { getClient } = fakeCreateItemClient({ failAll: true });
    const r = await createItemHandler(
      getClient,
      { groupId: "g1", items: [{ name: "A" }, { name: "B" }] },
      "u1",
    );
    expect(r.isError).toBe(true);
  });

  it("rejects a batch over the cap of 50", async () => {
    const { getClient } = fakeCreateItemClient();
    const items = Array.from({ length: 51 }, (_, i) => ({ name: `I${i}` }));
    const r = await createItemHandler(
      getClient,
      { groupId: "g1", items },
      "u1",
    );
    expect(r.isError).toBe(true);
  });

  it("rejects a call that supplies neither name nor items", async () => {
    const { getClient } = fakeCreateItemClient();
    const r = await createItemHandler(getClient, { groupId: "g1" }, "u1");
    expect(r.isError).toBe(true);
  });
});
```

Extend the existing fake in that file (or `src/test/mcp-fake-client.ts`) with `failAt` / `failAll` options rather than writing a second fake.

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm vitest run src/lib/mcp/tools/create-item.test.ts`
Expected: FAIL — the batch input is rejected.

- [ ] **Step 3: Widen `create_item`**

In `src/lib/mcp/tools/create-item.ts`, keep `name`/`fields` and add `items`, then require exactly one of the two forms. The `create_item` RPC is called once per entry; `writeCellValue` still runs per field, and `getClient()` is still called exactly once for the whole call:

```ts
const itemEntry = z.object({
  name: z.string().trim().min(1).max(255),
  fields: z.array(fieldInput).max(50).optional(),
});

const createItemInput = {
  groupId: z.string().uuid(),
  /** The original single-item form. Unchanged — shipped clients use it. */
  name: z.string().trim().min(1).max(255).optional(),
  fields: z.array(fieldInput).max(50).optional(),
  /** The batch form. Supply this OR name, never both. */
  items: z.array(itemEntry).min(1).max(50).optional(),
};

const createItemArgs = z
  .object({
    groupId: z.string().uuid(),
    name: z.string().trim().min(1).max(255).optional(),
    fields: z.array(fieldInput).max(50).optional(),
    items: z.array(itemEntry).min(1).max(50).optional(),
  })
  .refine((v) => (v.name === undefined) !== (v.items === undefined), {
    message: "Supply either name (one item) or items (a batch), not both.",
  });
```

In the handler, normalize to a single list before the loop — one code path, so the single form cannot drift from the batch form:

```ts
const entries = args.items ?? [{ name: args.name!, fields: args.fields }];
```

Then loop, collecting `created`, `errors` and each entry's `fieldErrors`. Return the original single-item payload shape (`{ item, fieldErrors }`) when the caller used the single form, and `{ created, errors }` when they used the batch form — a client that sends the old input must get the old output.

Set `isError: true` only when every entry failed.

- [ ] **Step 4: Run and confirm**

Run: `pnpm vitest run src/lib/mcp/tools/create-item.test.ts`
Expected: PASS, including the pre-existing single-form tests, unedited.

- [ ] **Step 5: Write `src/lib/boards/core/item.ts`**

Move `addSubitem` (item.ts:62-112), `archiveItem` (154-168), `restoreItem` (169-188), `reorderItem` (222-252) and `moveItem` (253-329) into cores, injecting `supabase` and keeping every message and RPC call verbatim.

**`deleteItem` (113-153) and `purgeItem` (189-221) are not touched.** No core, no tool action. Spec §5.

- [ ] **Step 6: Rewrite those five Server Actions as wrappers and run the suite**

Each keeps its Zod parse and any `revalidate`, delegating the body.

Run: `pnpm vitest run src/lib/boards/actions/item.test.ts src/lib/boards/item-tree.test.ts`
Expected: PASS with no test edits.

- [ ] **Step 7: Write `src/lib/mcp/tools/manage-item.ts`**

| Action        | Input                            | Capability        | Scope    |
| ------------- | -------------------------------- | ----------------- | -------- |
| `archive`     | `itemId`                         | `board.destroy`   | `itemId` |
| `restore`     | `itemId`                         | `board.structure` | `itemId` |
| `move`        | `itemId`, `groupId`, `position?` | `board.structure` | `itemId` |
| `reorder`     | `itemId`, `position`             | `board.structure` | `itemId` |
| `add_subitem` | `itemId` (the parent), `name`    | `board.structure` | `itemId` |

Structure exactly as `manage_board` in Task 5 Step 10. No `unscopedCreateActions`. No `delete` action.

`add_subitem` takes `itemId` rather than `parentId` **because the descriptor's scope contract is that the input field is named after the scope value** — `scope: "itemId"` means `input.itemId`, and `proposal-targets.ts` and `board-scope-guard.ts` both rely on that. Map it to the core's `parentId` inside the switch.

Description, which must say what `move` does to subitems:

```ts
  description:
    "Archive, restore, move, reorder an item, or add a subitem under it. " +
    "Archiving moves an item to Trash and is reversible with restore; there " +
    "is no permanent delete. Moving an item carries its subitems with it.",
```

- [ ] **Step 8: Write the descriptor and RLS tests**

`src/lib/mcp/tools/manage-item.test.ts` asserts the capability and scope maps above, and that `{action: "delete", itemId}` returns `isError`.

`src/lib/mcp/tools/manage-item.rls.integration.test.ts`, on the `list-items.rls.integration.test.ts` pattern: a second org's user cannot archive or move an item on the first org's board.

- [ ] **Step 9: Register, run, gate, finish**

Add `manageItemDescriptor` to `src/lib/mcp/tools/catalog.ts`.

```bash
pnpm vitest run src/lib/boards src/lib/mcp
pnpm typecheck && pnpm lint && pnpm build
git add src/lib/boards/core/item.ts src/lib/boards/core/item.test.ts \
        src/lib/boards/actions/item.ts \
        src/lib/mcp/tools/create-item.ts src/lib/mcp/tools/create-item.test.ts \
        src/lib/mcp/tools/manage-item.ts src/lib/mcp/tools/manage-item.test.ts \
        src/lib/mcp/tools/manage-item.rls.integration.test.ts \
        src/lib/mcp/tools/catalog.ts
git commit -m "feat(mcp): add manage_item tool and create_item batch form"
```

`descriptor.test.ts`'s count of 24 fails; expected, fixed in Task 11. Then `scripts/finish-task.sh`.

---

## Task 8 (Unit D): `manage_view` + `manage_automation`

**Files:**

- Create: `src/lib/boards/core/view.ts`, `src/lib/mcp/tools/manage-view.ts`
- Create: `src/lib/agents/manage-automation-tool.ts`
- Delete: `src/lib/agents/create-automation-tool.ts`
- Modify: `src/lib/boards/view-actions.ts` (lines 20, 41, 84)
- Modify: `src/lib/boards/automation-actions.ts` (lines 104, 160 — `updateAutomation`, `deleteAutomation`)
- Modify: `src/lib/agents/agent-only-tools.ts`
- Modify: `src/lib/mcp/tools/catalog.ts`
- Test: `src/lib/boards/core/view.test.ts`, `src/lib/mcp/tools/manage-view.test.ts`, `src/lib/agents/manage-automation-tool.test.ts`, `src/lib/mcp/tools/manage-view.rls.integration.test.ts`

**Interfaces:**

- Consumes: `toToolResult`, `parseAction` (Task 3); `capabilityFor`, `scopeFor`, `TOOL_SCOPES` including `"viewId"` and `"automationId"` (Task 2); the existing `createAutomationCore(supabase, input, userId)` in `src/lib/boards/automation-core.ts`.
- Produces:
  - `createBoardViewCore(supabase, input: {boardId, kind, name?}): Promise<ActionResult<{viewId: string}>>`
  - `updateBoardViewCore(supabase, input: {viewId, name?, config?}): Promise<ActionResult>`
  - `deleteBoardViewCore(supabase, input: {viewId}): Promise<ActionResult>`
  - `updateAutomationCore(supabase, input): Promise<ActionResult>`
  - `deleteAutomationCore(supabase, input: {id}): Promise<ActionResult>`
  - `manageViewDescriptor` (catalog), `manageAutomationDescriptor` (agent-only)

- [ ] **Step 1: Write the failing core test**

Create `src/lib/boards/core/view.test.ts` asserting that `updateBoardViewCore` validates `config` against the view's own `kind` — the guard at `view-actions.ts:55-80` that must survive the move — and that a `viewId` naming no view returns a failure rather than a silent success.

```ts
import { describe, expect, it } from "vitest";
import { updateBoardViewCore } from "./view";

function fakeClient(view: { kind: string; board_id: string } | null) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: view, error: null }) }),
      }),
      update: () => ({ eq: async () => ({ error: null }) }),
    }),
  } as never;
}

describe("updateBoardViewCore", () => {
  it("rejects a config that does not match the view kind", async () => {
    const r = await updateBoardViewCore(
      fakeClient({ kind: "kanban", board_id: "b1" }),
      { viewId: "v1", config: { nonsense: true } },
    );
    expect(r.ok).toBe(false);
  });

  it("reports a missing view rather than succeeding silently", async () => {
    const r = await updateBoardViewCore(fakeClient(null), {
      viewId: "v1",
      name: "Board",
    });
    expect(r.ok).toBe(false);
  });

  // Preserved from updateBoardView: nothing to change is not an error.
  it("is a no-op success when neither name nor config is supplied", async () => {
    const r = await updateBoardViewCore(
      fakeClient({ kind: "table", board_id: "b1" }),
      { viewId: "v1" },
    );
    expect(r.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm vitest run src/lib/boards/core/view.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/lib/boards/core/view.ts` and rewrite the three view actions**

Move the bodies of `createBoardView` (view-actions.ts:20-39), `updateBoardView` (41-82) and `deleteBoardView` (84-104) into cores, injecting `supabase`. Keep `DEFAULT_NAME[kind]` and the per-kind config validation exactly as they are. The Server Actions keep their Zod parse and their `revalidatePath`.

Run: `pnpm vitest run src/lib/boards/core/view.test.ts src/lib/boards/view-actions.test.ts`
Expected: PASS.

- [ ] **Step 4: Extract the two automation cores**

Move the bodies of `updateAutomation` (automation-actions.ts:104-159) and `deleteAutomation` (160-177) into `src/lib/boards/automation-core.ts` beside the existing `createAutomationCore`, injecting `supabase`. Keep the `actionsContainWebhook` check in `updateAutomationCore` — an agent editing an automation to add a webhook is exactly the case that check exists for.

Run: `pnpm vitest run src/lib/boards/automation-core.test.ts src/lib/boards/automation-actions.test.ts`
Expected: PASS.

- [ ] **Step 5: Write `src/lib/mcp/tools/manage-view.ts`**

| Action   | Input                                                                 | Capability        | Scope     |
| -------- | --------------------------------------------------------------------- | ----------------- | --------- |
| `create` | `boardId`, `kind: "table"\|"kanban"\|"calendar"\|"timeline"`, `name?` | `board.structure` | `boardId` |
| `update` | `viewId`, `name?`, `config?`                                          | `board.structure` | `viewId`  |
| `delete` | `viewId`                                                              | `board.destroy`   | `viewId`  |

Structure exactly as `manage_board` in Task 5 Step 10. No `unscopedCreateActions`. Point the description at `describe_schema` for the per-kind `config` shape.

- [ ] **Step 6: Replace the agent-only automation tool**

Create `src/lib/agents/manage-automation-tool.ts` exporting `manageAutomationDescriptor`, replacing `createAutomationDescriptor`. All three actions carry the **existing** `automation.create` capability — no new capability, so no migration and no ceiling change.

```ts
export const manageAutomationDescriptor: ToolDescriptor = {
  name: "manage_automation",
  title: "Manage automation",
  description:
    "Create, update or delete a board automation — a rule that runs on its " +
    "own after you have gone. Call describe_schema for the trigger and " +
    "action vocabulary.",
  inputSchema: manageAutomationInput,
  capability: {
    create: "automation.create",
    update: "automation.create",
    delete: "automation.create",
  },
  scope: { create: "boardId", update: "automationId", delete: "automationId" },
  invoke: async (ctx, input) => {
    /* parseAction → switch → toToolResult */
  },
};
```

In `src/lib/agents/agent-only-tools.ts`, swap `createAutomationDescriptor` for `manageAutomationDescriptor` and update the module comment: the reasoning is unchanged — an automation is a standing, org-visible side effect that belongs behind a capability grant rather than a generic bearer token — but the tool it names has grown two actions. Delete `src/lib/agents/create-automation-tool.ts`.

**`manageAutomationDescriptor` must NOT be added to `src/lib/mcp/tools/catalog.ts`.** Spec §9. A catalog entry would serve it to every connected MCP client and silently overturn that decision.

- [ ] **Step 7: Write the tests**

`src/lib/agents/manage-automation-tool.test.ts` asserts all three actions charge `automation.create`, that the scope map is `boardId`/`automationId`/`automationId`, and — the load-bearing one:

```ts
it("is never served over MCP", async () => {
  const { ALL_TOOL_DESCRIPTORS } = await import("@/lib/mcp/tools/catalog");
  expect(ALL_TOOL_DESCRIPTORS.map((d) => d.name)).not.toContain(
    "manage_automation",
  );
});
```

`src/lib/mcp/tools/manage-view.test.ts` asserts the view capability and scope maps. `src/lib/mcp/tools/manage-view.rls.integration.test.ts` asserts a second org's user cannot create or delete a view on the first org's board.

- [ ] **Step 8: Register, run, gate, finish**

Add **only** `manageViewDescriptor` to `src/lib/mcp/tools/catalog.ts`.

```bash
pnpm vitest run src/lib/boards src/lib/mcp src/lib/agents
pnpm typecheck && pnpm lint && pnpm build
git add src/lib/boards/core/view.ts src/lib/boards/core/view.test.ts \
        src/lib/boards/view-actions.ts src/lib/boards/automation-core.ts \
        src/lib/boards/automation-actions.ts \
        src/lib/agents/manage-automation-tool.ts \
        src/lib/agents/manage-automation-tool.test.ts \
        src/lib/agents/agent-only-tools.ts \
        src/lib/mcp/tools/manage-view.ts src/lib/mcp/tools/manage-view.test.ts \
        src/lib/mcp/tools/manage-view.rls.integration.test.ts \
        src/lib/mcp/tools/catalog.ts
git rm src/lib/agents/create-automation-tool.ts
git commit -m "feat(agents): add manage_view and widen automations to manage_automation"
```

Then `scripts/finish-task.sh`.

---

## Task 9 (Unit E): the planning layer — dashboard, widget, report, goal, portfolio

Largest unit; dispatch it **first** in Wave 2. It touches four modules and is the critical path.

**Files:**

- Create: `src/lib/dashboards/core.ts`, `src/lib/goals/core.ts`, `src/lib/portfolios/core.ts`, `src/lib/reports/core.ts`
- Create: `src/lib/mcp/tools/manage-dashboard.ts`, `src/lib/mcp/tools/manage-widget.ts`, `src/lib/mcp/tools/manage-goal.ts`, `src/lib/mcp/tools/manage-portfolio.ts`, `src/lib/mcp/tools/manage-report.ts`
- Modify: `src/lib/dashboards/actions.ts` (49, 72, 97, 123, 152, 192, 242, 264), `src/lib/goals/actions.ts` (18, 48, 88, 106), `src/lib/portfolios/actions.ts` (21, 39, 62, 81), `src/lib/reports/actions.ts` (185, 240, 270, 326)
- Modify: `src/lib/mcp/tools/catalog.ts`
- Test: one `*.test.ts` per new tool file, plus `src/lib/mcp/tools/manage-dashboard.rls.integration.test.ts`

**Interfaces:**

- Consumes: `toToolResult`, `parseAction` (Task 3); `capabilityFor`, `scopeFor` (Task 2); `resolveToolOrg` and `listToolOrgs` from `src/lib/mcp/org-scope.ts`; `configSchemaForKind` from the dashboards validation module; `typedRpc` from `src/lib/supabase/typed-rpc.ts`.
- Produces: `createDashboardCore`, `renameDashboardCore`, `duplicateDashboardCore`, `deleteDashboardCore`, `saveLayoutCore`, `createWidgetCore`, `updateWidgetConfigCore`, `deleteWidgetCore`, `createGoalCore`, `updateGoalCore`, `deleteGoalCore`, `setGoalLinksCore`, `createPortfolioCore`, `addBoardToPortfolioCore`, `removePortfolioBoardCore`, `updatePortfolioPlacementCore`, `createReportCore`, `saveReportCore`, `setReportScopeCore`, `deleteReportCore` — each taking `(supabase, …)` and returning `ActionResult`; and the five descriptors.

- [ ] **Step 1: Write the failing org-resolution test**

This is the distinctive problem in this unit and nowhere else: `createGoal`, `createPortfolio` and `createReport` call `getActiveOrgId()`, which reads a **cookie**. MCP has no active-org cookie. Create `src/lib/mcp/tools/manage-goal.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { manageGoalDescriptor } from "./manage-goal";

const ctx = (orgs: { id: string; name: string }[]) => ({
  actorId: "u1",
  getClient: async () =>
    ({
      from: () => ({
        select: () => ({ order: async () => ({ data: orgs, error: null }) }),
      }),
      rpc: async () => ({ data: { id: "g1" }, error: null }),
    }) as never,
});

describe("manage_goal org resolution", () => {
  // The MCP analogue of the active-org cookie, already established by
  // resolveToolOrg: default to the caller's only org.
  it("defaults to the caller's single org when none is named", async () => {
    const r = await manageGoalDescriptor.invoke(
      ctx([{ id: "o1", name: "A" }]),
      {
        action: "create",
        name: "Ship it",
      },
    );
    expect(r.isError).toBeUndefined();
  });

  // resolveToolOrg's deliberate difference from pickActiveOrg: a requested id
  // that is not a membership is REFUSED, never silently swapped for another
  // tenant's org.
  it("refuses an orgId the caller is not a member of", async () => {
    const r = await manageGoalDescriptor.invoke(
      ctx([{ id: "o1", name: "A" }]),
      {
        action: "create",
        name: "Ship it",
        orgId: "o2",
      },
    );
    expect(r.isError).toBe(true);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm vitest run src/lib/mcp/tools/manage-goal.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the four core modules**

Move each listed action's body into a core taking `(supabase, …)`. Three rules:

- **Cookie dependencies become parameters.** `getActiveOrgId()` becomes an `orgId: string` parameter; `requireUser()` becomes a `userId: string` parameter. The Server Action supplies them from cookies; the descriptor supplies `resolveToolOrg(await listToolOrgs(supabase), args.orgId)?.id` and `ctx.actorId`.
- **`revalidatePath` never moves into a core.** It stays in the Server Action.
- **Every existing guard survives verbatim** — `bindingDenialReason` in `createReport`, `configSchemaForKind` in `createWidget`. Losing one is how an agent writes a widget config that crashes the dashboard page on render.

`exportReportPdf`, `saveReportAsTemplate`, `createReportFromTemplate`, `getWidget*` and both `getStatusColumnsForBoard` are **not** touched.

- [ ] **Step 4: Rewrite the sixteen Server Actions as wrappers and run their suites**

Run: `pnpm vitest run src/lib/dashboards src/lib/goals src/lib/portfolios src/lib/reports`
Expected: PASS with no test edits.

- [ ] **Step 5: Write the five descriptors**

All five are `scope: "none"` for every action — dashboards, widgets, goals, portfolios and reports span many boards, so "in scope" has no single answer and RLS is the sole boundary. This is the same reasoning already written into `descriptor.ts` for `get_dashboard` and `get_report`; do not invent a resolver for them.

| Tool               | Action             | Input                                                            | Capability        | Unscoped create |
| ------------------ | ------------------ | ---------------------------------------------------------------- | ----------------- | --------------- |
| `manage_dashboard` | `create`           | `name`, `orgId?`                                                 | `board.structure` | ✓               |
|                    | `rename`           | `dashboardId`, `name`                                            | `board.structure` |                 |
|                    | `duplicate`        | `dashboardId`                                                    | `board.structure` |                 |
|                    | `delete`           | `dashboardId`                                                    | `board.destroy`   |                 |
|                    | `save_layout`      | `dashboardId`, `layout`                                          | `board.structure` |                 |
| `manage_widget`    | `create`           | `dashboardId`, `kind`, `sourceBoardId`, `title`, `config`        | `board.structure` |                 |
|                    | `update_config`    | `widgetId`, `title?`, `config?`                                  | `board.structure` |                 |
|                    | `delete`           | `widgetId`                                                       | `board.destroy`   |                 |
| `manage_goal`      | `create`           | `name`, `orgId?`, …                                              | `board.structure` | ✓               |
|                    | `update`           | `goalId`, …                                                      | `board.structure` |                 |
|                    | `set_links`        | `goalId`, `links`                                                | `board.structure` |                 |
|                    | `delete`           | `goalId`                                                         | `board.destroy`   |                 |
| `manage_portfolio` | `create`           | `name`, `orgId?`                                                 | `board.structure` | ✓               |
|                    | `add_board`        | `portfolioId`, `boardId`                                         | `board.structure` |                 |
|                    | `remove_board`     | `portfolioId`, `boardId`                                         | `board.destroy`   |                 |
|                    | `update_placement` | `portfolioId`, `boardId`, …                                      | `board.structure` |                 |
| `manage_report`    | `create`           | `name`, `scope`, `boardId?`/`boardIds?`/`portfolioId?`, `orgId?` | `board.structure` | ✓               |
|                    | `save`             | `reportId`, …                                                    | `board.structure` |                 |
|                    | `set_scope`        | `reportId`, `scope`, …                                           | `board.structure` |                 |
|                    | `delete`           | `reportId`                                                       | `board.destroy`   |                 |

Structure each exactly as `manage_board` in Task 5 Step 10. `manage_widget` declares **no** `unscopedCreateActions` — a widget hangs off a dashboard the caller must already name.

`manage_widget` and `manage_report` descriptions must point at `describe_schema` for `config` and `scope` shapes.

- [ ] **Step 6: Write the remaining four descriptor tests**

One `*.test.ts` per tool, each asserting its capability map (every `delete`/`remove_board` is `board.destroy`, everything else `board.structure`), that every action is `scope: "none"`, and that `unscopedCreateActions` matches the ✓ column above.

- [ ] **Step 7: Write the RLS integration test**

`src/lib/mcp/tools/manage-dashboard.rls.integration.test.ts`: a second org's user cannot rename or delete the first org's dashboard, and cannot create a widget on it.

- [ ] **Step 8: Register, run, gate, finish**

Add all five descriptors to `src/lib/mcp/tools/catalog.ts`.

```bash
pnpm vitest run src/lib/dashboards src/lib/goals src/lib/portfolios \
                src/lib/reports src/lib/mcp
pnpm typecheck && pnpm lint && pnpm build
git add src/lib/dashboards/core.ts src/lib/dashboards/actions.ts \
        src/lib/goals/core.ts src/lib/goals/actions.ts \
        src/lib/portfolios/core.ts src/lib/portfolios/actions.ts \
        src/lib/reports/core.ts src/lib/reports/actions.ts \
        src/lib/mcp/tools/manage-dashboard.ts \
        src/lib/mcp/tools/manage-widget.ts \
        src/lib/mcp/tools/manage-goal.ts \
        src/lib/mcp/tools/manage-portfolio.ts \
        src/lib/mcp/tools/manage-report.ts \
        src/lib/mcp/tools/manage-dashboard.test.ts \
        src/lib/mcp/tools/manage-widget.test.ts \
        src/lib/mcp/tools/manage-goal.test.ts \
        src/lib/mcp/tools/manage-portfolio.test.ts \
        src/lib/mcp/tools/manage-report.test.ts \
        src/lib/mcp/tools/manage-dashboard.rls.integration.test.ts \
        src/lib/mcp/tools/catalog.ts
git commit -m "feat(mcp): add dashboard, widget, goal, portfolio and report tools"
```

Then `scripts/finish-task.sh`.

---

# WAVE 3 — sequential, one agent, one worktree

Tasks 10 through 13 run **after all six Wave 2 worktrees are merged into `develop`**. Each needs every new descriptor to exist. Run them in order in a single worktree; they are separated for review, not for parallelism.

---

## Task 10: Proposal summaries for every action

The largest and least interesting block in the plan, and the one most likely to be under-done. It is not optional: a denied write becomes an approval card, and `proposal-summary.ts`'s stated property is that the sentence describes the call that will really run. Its fallback is `Run <tool>.` — which for a grouped-dispatch tool renders _"Run manage_board."_ for an archive. An owner cannot consent to that.

**Files:**

- Modify: `src/lib/agents/proposal-summary.ts` (the `sentenceFor` switch, from line 264)
- Test: `src/lib/agents/proposal-summary.test.ts`

**Interfaces:**

- Consumes: every descriptor from Tasks 4-9, and `descriptorsFor` from `src/lib/agents/tool-descriptors.ts`.
- Produces: a `sentenceFor` branch for all ~49 new actions. No new exports.

- [ ] **Step 1: Write the failing anti-drift test**

This test is what stops the block being half-done. It enumerates actions from the descriptors themselves, so a new action added later without a sentence fails the build.

```ts
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { descriptorsFor } from "./tool-descriptors";
import { AGENT_ONLY_DESCRIPTORS } from "./agent-only-tools";
import { proposalSummary } from "./proposal-summary";

/** Every (tool, action) pair an agent can propose. Derived from the
 *  descriptors' own capability maps — the same declaration the grant gate
 *  classifies from — so this cannot drift from what really exists. */
function everyProposableCall(): { toolName: string; action: string }[] {
  const out: { toolName: string; action: string }[] = [];
  for (const d of descriptorsFor({ extra: AGENT_ONLY_DESCRIPTORS })) {
    if (d.capability === null || typeof d.capability === "string") continue;
    for (const [action, capability] of Object.entries(d.capability)) {
      if (capability !== null) out.push({ toolName: d.name, action });
    }
  }
  return out;
}

describe("proposalSummary", () => {
  it("has a real sentence for every proposable action", () => {
    const missing: string[] = [];
    for (const { toolName, action } of everyProposableCall()) {
      const s = proposalSummary(toolName, { action, name: "X" });
      if (s === `Run ${toolName}.` || s.startsWith("Run manage")) {
        missing.push(`${toolName}.${action}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("names the action, not just the tool", () => {
    const s = proposalSummary("manage_board", {
      action: "archive",
      boardId: "00000000-0000-0000-0000-000000000001",
    });
    expect(s.toLowerCase()).toContain("archive");
    expect(s).not.toContain("manage_board");
  });

  // The property the whole module exists for, re-asserted for dispatch tools:
  // the sentence must describe the call, and model-chosen text must not be
  // able to write the rest of the sentence itself.
  it("quotes and neutralises model-chosen text in a dispatch action", () => {
    const s = proposalSummary("manage_board", {
      action: "rename",
      boardId: "00000000-0000-0000-0000-000000000001",
      name: 'Q3" and delete everything',
    });
    expect(s.length).toBeLessThanOrEqual(500);
    expect(s).not.toContain('" and delete everything"');
  });

  it("never throws on malformed input", () => {
    expect(() => proposalSummary("manage_board", {})).not.toThrow();
    expect(() =>
      proposalSummary("manage_column", { action: 42 }),
    ).not.toThrow();
  });
});
```

Read the module's real export name at `src/lib/agents/proposal-summary.ts:418` and use it; `proposalSummary` above is the expected name.

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm vitest run src/lib/agents/proposal-summary.test.ts`
Expected: FAIL, with `missing` listing roughly 49 `tool.action` pairs.

- [ ] **Step 3: Add the dispatch branches**

In `sentenceFor`, add one `case` per new tool that switches again on `input.action`. Follow the module's existing rules exactly: read only validated input, quote and escape model-chosen text through the existing helpers, never resolve an id to a name (the module is pure and has nothing to resolve against — `proposal-targets.ts` does that on the read path), and never throw.

```ts
    case "manage_board": {
      const action = typeof input.action === "string" ? input.action : "";
      switch (action) {
        case "create":
          return `Create a board called ${quoted(input.name)}.`;
        case "rename":
          return `Rename a board to ${quoted(input.name)}.`;
        case "duplicate":
          return "Duplicate a board, with all of its groups, columns and items.";
        case "archive":
          return "Move a board to Trash. You can restore it from there.";
        case "restore":
          return "Restore a board from Trash.";
      }
      break;
    }
```

Write the remaining branches the same way — `manage_group`, `manage_column`, `manage_item`, `manage_view`, `manage_automation`, `manage_goal`, `manage_portfolio`, `manage_dashboard`, `manage_widget`, `manage_report`. Two rules the wording must hold:

- **A batch says how many.** `Add 8 columns to a board.` — the count is the single most decision-relevant fact and it is in the validated input.
- **A destroy says what survives.** Archive sentences say the object goes to Trash and can be restored; `manage_column`'s delete says its cell values go with it and cannot be undone.

Move the existing `create_automation` branch (line 347) into the new `manage_automation` case, keeping its wording for the `create` action.

- [ ] **Step 4: Run until the list is empty**

Run: `pnpm vitest run src/lib/agents/proposal-summary.test.ts`
Expected: PASS. Read the `missing` array on each failure and work it down; do not weaken the assertion.

- [ ] **Step 5: Commit**

```bash
pnpm typecheck && pnpm lint
git add src/lib/agents/proposal-summary.ts src/lib/agents/proposal-summary.test.ts
git commit -m "feat(agents): describe every dispatch action in proposal summaries"
```

---

## Task 11: Proposal targets, consent table, and the descriptor counts

**Files:**

- Modify: `src/lib/agents/proposal-targets.ts`, `src/lib/agents/proposals-db.ts` (the `ProposalTargetKind` union)
- Modify: `src/components/settings/mcp/mcp-tools-table.tsx:66`
- Modify: `src/lib/mcp/tools/descriptor.test.ts:11,26-32`
- Test: `src/lib/agents/proposal-targets.test.ts`, `src/components/settings/mcp/mcp-tools-table.test.tsx`

**Interfaces:**

- Consumes: `scopeFor` (Task 2); every descriptor from Tasks 4-9.
- Produces: `ProposalTargetKind` widened with `"column" | "view" | "automation"`; `MCP_TOOLS_TABLE_ROWS` classifying map-capability tools as writes.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/agents/proposal-targets.test.ts`:

```ts
it("names the column a manage_column proposal targets", async () => {
  const targets = await resolveProposalTargets(client, [
    { toolName: "manage_column", input: { action: "rename", columnId: "c1" } },
  ]);
  expect(targets.get("c1")).toEqual({ kind: "column", name: "Status" });
});

// Working agreement #5: one bounded read per KIND for a whole page of
// proposals, never one per card.
it("issues one read per kind for a page of proposals", async () => {
  const { client, reads } = countingClient();
  await resolveProposalTargets(client, [
    { toolName: "manage_column", input: { action: "rename", columnId: "c1" } },
    { toolName: "manage_column", input: { action: "delete", columnId: "c2" } },
    { toolName: "manage_column", input: { action: "resize", columnId: "c3" } },
  ]);
  expect(reads().filter((t) => t === "columns")).toHaveLength(1);
});

// The scope of a dispatch tool depends on its action: create takes a boardId,
// rename takes a columnId. Reading descriptor.scope directly would see a
// Record and resolve nothing.
it("resolves the target from the action, not the tool", async () => {
  const targets = await resolveProposalTargets(client, [
    { toolName: "manage_column", input: { action: "create", boardId: "b1" } },
  ]);
  expect(targets.get("b1")?.kind).toBe("board");
});
```

Append to `src/components/settings/mcp/mcp-tools-table.test.tsx`:

```ts
it("classifies every dispatch tool as a write", () => {
  const row = MCP_TOOLS_TABLE_ROWS.find((r) => r.name === "manage_board");
  expect(row?.access).toBe("write");
});

it("still classifies describe_schema as a read", () => {
  const row = MCP_TOOLS_TABLE_ROWS.find((r) => r.name === "describe_schema");
  expect(row?.access).toBe("read");
});
```

Match the real signatures in each file — read them before writing; the names above are the expected shape, not a guess to paste blindly.

- [ ] **Step 2: Run and watch them fail**

Run: `pnpm vitest run src/lib/agents/proposal-targets.test.ts src/components/settings/mcp/mcp-tools-table.test.tsx`
Expected: FAIL on all five.

- [ ] **Step 3: Widen the target kinds**

In `src/lib/agents/proposals-db.ts`, add `"column" | "view" | "automation"` to `ProposalTargetKind`. In `src/lib/agents/proposal-targets.ts`, extend both maps and switch the per-proposal scope lookup to `scopeFor(d, row.input)`:

```ts
const KIND_BY_SCOPE: Partial<Record<ToolScope, ProposalTargetKind>> = {
  itemId: "item",
  boardId: "board",
  groupId: "group",
  columnId: "column",
  viewId: "view",
  automationId: "automation",
};

const TABLE_BY_KIND: Record<ProposalTargetKind, string> = {
  item: "items",
  board: "boards",
  group: "groups",
  column: "columns",
  view: "board_views",
  automation: "automations",
};
```

Keep the grouping-by-kind that produces one `id IN (…)` read per kind. Three more kinds means three more bounded reads for a whole page, never one per card.

- [ ] **Step 4: Make the consent table map-aware**

In `src/components/settings/mcp/mcp-tools-table.tsx:66`, a tool is a read only when it costs no capability under **any** action:

```ts
export const MCP_TOOLS_TABLE_ROWS = ALL_TOOL_DESCRIPTORS.map((d) => ({
  name: d.name,
  // A dispatch tool's `capability` is a Record. `=== null` would be false for
  // it and the ternary would read "write" by luck rather than by rule — and
  // would read "read" by luck if the field were ever `{}`. Be explicit.
  access:
    d.capability === null ||
    (typeof d.capability === "object" &&
      Object.values(d.capability).every((c) => c === null))
      ? ("read" as const)
      : ("write" as const),
}));
```

- [ ] **Step 5: Update the descriptor counts**

In `src/lib/mcp/tools/descriptor.test.ts`, change the count from `24` to `35`, and replace the "exactly the five write tools" assertion with the full write list — `attach_file`, `create_attachment_upload`, `create_item`, `log_time_allocation`, `update_item`, and the ten new `manage_*` tools, sorted. `describe_schema` is **not** in it.

Also widen the "legal capability and scope" assertion to accept maps, checking every value in a `Record` against `AGENT_CAPABILITIES` and `TOOL_SCOPES`.

- [ ] **Step 6: Run everything**

Run: `pnpm vitest run`
Expected: PASS, whole suite.

- [ ] **Step 7: Commit**

```bash
pnpm typecheck && pnpm lint && pnpm build
git add src/lib/agents/proposal-targets.ts src/lib/agents/proposals-db.ts \
        src/lib/agents/proposal-targets.test.ts \
        src/components/settings/mcp/mcp-tools-table.tsx \
        src/components/settings/mcp/mcp-tools-table.test.tsx \
        src/lib/mcp/tools/descriptor.test.ts
git commit -m "feat(agents): resolve proposal targets and tool access per action"
```

---

## Task 12: Capability UI

**Land `task/agents-page` before starting this task**, or accept a rebase — its plan touches `AgentEditor`, which is where these checkboxes render.

**Files:**

- Modify: `src/components/agents/CapabilityToggles.tsx` (only if it does not already map `AGENT_CAPABILITIES`)
- Modify: `src/components/settings/OrgAgentCeiling.tsx` (same)
- Test: `src/components/agents/CapabilityToggles.test.tsx`, `src/components/agents/AgentEditor.test.tsx`

**Interfaces:**

- Consumes: `AGENT_CAPABILITIES` and `CAPABILITY_COPY` from Task 1.
- Produces: no new exports. Both surfaces render eight capabilities.

- [ ] **Step 1: Write the failing test**

Append to `src/components/agents/CapabilityToggles.test.tsx`:

```ts
it("offers the two structure capabilities with their copy", () => {
  render(<CapabilityToggles granted={[]} ceiling={[...AGENT_CAPABILITIES]}
                            onChange={() => {}} />);
  expect(screen.getByText("Build and change board structure")).toBeVisible();
  expect(screen.getByText("Remove things")).toBeVisible();
});

// The org clamp is what makes this ship inert. A capability the org has not
// opened must not be tickable, or the owner grants something that can only
// ever be denied.
it("cannot grant a capability the org ceiling excludes", () => {
  render(<CapabilityToggles granted={[]} ceiling={["board.write"]}
                            onChange={() => {}} />);
  const toggle = screen.getByRole("switch", {
    name: /build and change board structure/i,
  });
  expect(toggle).toBeDisabled();
});
```

Match the component's real props by reading it first.

- [ ] **Step 2: Run**

Run: `pnpm vitest run src/components/agents/CapabilityToggles.test.tsx`

Both components already map `AGENT_CAPABILITIES` and read `CAPABILITY_COPY`, so the first test may pass with **no source change** — Task 1 did the work. If so, that is the correct outcome; keep the test as the guard. If the ceiling test fails, add the `disabled` binding.

- [ ] **Step 3: Check the board-scope help text**

Find the `board_scope` help text in `src/components/agents/AgentEditor.tsx`. Spec §4 requires it not to overpromise: a narrowed agent **cannot create boards, dashboards, portfolios, goals or reports at all**. Add one sentence saying so. If no help text exists yet, add one:

> Limiting an agent to specific boards also stops it creating new boards, dashboards, portfolios, goals or reports.

- [ ] **Step 4: Run the component suites and commit**

```bash
pnpm vitest run src/components/agents src/components/settings
pnpm typecheck && pnpm lint
git add src/components/agents/CapabilityToggles.test.tsx \
        src/components/agents/AgentEditor.tsx
git commit -m "feat(agents): surface structure capabilities and scope limits in the editor"
```

---

## Task 13: End-to-end board build

The acceptance test for the whole plan: everything above is unit-tested in isolation, and this is the only test that proves the surface composes into the outcome the spec promises.

**Files:**

- Create: `src/lib/mcp/tools/board-build.rls.integration.test.ts`

**Interfaces:**

- Consumes: every descriptor from Tasks 4-9.
- Produces: nothing.

- [ ] **Step 1: Write the test**

Follow `src/lib/mcp/tools/list-items.rls.integration.test.ts` for setup and the `PULSE_TEST_DB` skip guard. It builds a board from nothing through the tool surface only — no direct table writes:

```ts
describe("building a board end to end", () => {
  it("goes from nothing to a populated, viewable board", async () => {
    const ctx = { getClient: async () => client, actorId: userId };

    // 1. Learn the vocabulary — no capability, no DB.
    const schema = await describeSchemaDescriptor.invoke(ctx, {
      topic: "column_kinds",
    });
    expect(schema.isError).toBeUndefined();

    // 2. Create the board.
    const board = await manageBoardDescriptor.invoke(ctx, {
      action: "create",
      workspaceId,
      name: "Hiring Q3",
    });
    const { boardId } = JSON.parse(board.content[0]!.text);
    expect(boardId).toBeTruthy();

    // 3. Columns, in ONE call.
    const cols = await manageColumnDescriptor.invoke(ctx, {
      action: "create",
      boardId,
      columns: [
        {
          kind: "status",
          name: "Stage",
          settings: {
            options: [
              { id: "applied", label: "Applied", color: "gray" },
              { id: "hired", label: "Hired", color: "green" },
            ],
          },
        },
        { kind: "date", name: "Start date" },
        { kind: "people", name: "Owner" },
      ],
    });
    const created = JSON.parse(cols.content[0]!.text);
    expect(created.errors).toEqual([]);
    expect(created.created).toHaveLength(3);

    // 4. Groups, in ONE call.
    const groups = await manageGroupDescriptor.invoke(ctx, {
      action: "create",
      boardId,
      groups: [{ name: "Engineering" }, { name: "Design" }],
    });
    const groupId = JSON.parse(groups.content[0]!.text).created[0].id;

    // 5. Items, in ONE call, with a field value set on creation.
    const items = await createItemDescriptor.invoke(ctx, {
      groupId,
      items: [
        {
          name: "Backend engineer",
          fields: [
            { columnId: created.created[0].id, value: { optionId: "applied" } },
          ],
        },
        { name: "Platform engineer" },
      ],
    });
    expect(JSON.parse(items.content[0]!.text).errors).toEqual([]);

    // 6. A view over it.
    const view = await manageViewDescriptor.invoke(ctx, {
      action: "create",
      boardId,
      kind: "kanban",
      name: "By stage",
    });
    expect(view.isError).toBeUndefined();

    // Six tool calls for a whole board. That number IS the batching decision.
  });

  it("leaves everything recoverable — archive then restore", async () => {
    const ctx = { getClient: async () => client, actorId: userId };
    const archived = await manageBoardDescriptor.invoke(ctx, {
      action: "archive",
      boardId,
    });
    expect(archived.isError).toBeUndefined();
    const restored = await manageBoardDescriptor.invoke(ctx, {
      action: "restore",
      boardId,
    });
    expect(restored.isError).toBeUndefined();
  });

  it("refuses a create from a board-scoped agent", async () => {
    const tools = buildAgentTools({
      ctx,
      client,
      scope: { mode: "list", boardIds: [boardId] },
    });
    const r = await tools.manage_board.execute!(
      { action: "create", workspaceId, name: "Sneaky" },
      {} as never,
    );
    expect(JSON.stringify(r)).toContain("scoped to specific boards");
  });
});
```

- [ ] **Step 2: Run it against DEV**

Run: `PULSE_TEST_DB=1 pnpm vitest run src/lib/mcp/tools/board-build.rls.integration.test.ts`
Expected: PASS. Clean up every object the test creates in an `afterAll` — this runs against the DEV database, which holds real user-facing data.

- [ ] **Step 3: Full gates and commit**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
git add src/lib/mcp/tools/board-build.rls.integration.test.ts
git commit -m "test(mcp): build a board end to end through the tool surface"
```

- [ ] **Step 4: Finish**

Run `scripts/finish-task.sh` from inside the worktree.

---

# How to test this (hand to the user after the merge)

The surface ships **inert**: both new capabilities are refused by every org's ceiling until an admin opens them. So the walkthrough starts there.

1. Pull `develop` and restart the dev server.
2. Go to **Settings → AI → Org agent ceiling**. Two new switches are there: **Build and change board structure** and **Remove things**. Turn both on. (Before this, everything below is denied by design.)
3. Go to **Settings → Agents**, open an agent, and grant it the same two capabilities. Leave its board scope on **All boards** — a narrowed agent deliberately cannot create.
4. Go to **Settings → MCP**. The tools table now lists 35 tools; the ten `manage_*` tools show as **write** and `describe_schema` as **read**.
5. In a connected MCP client (Claude Desktop), ask: _"Use describe_schema to see what column kinds exist, then build me a hiring board with a status column, a date column and an owner column, two groups, and three roles."_ Expect a new board, correctly shaped, in about six tool calls.
6. Open the board in Pulse. Confirm the columns, groups and items are there and the status options are the ones the agent chose.
7. Ask the client to **archive** the board, then check **Trash** — it is there and restorable. Ask it to **permanently delete** the board: it cannot, and should say so.
8. Now narrow the agent's board scope to one specific board and ask it to create a new board. Expect the refusal: _"This agent is scoped to specific boards, so it cannot create new ones."_
9. Revoke **Remove things** from the agent and ask it to archive something. Expect an approval card in the agent's proposals, whose sentence names the action — _"Move a board to Trash. You can restore it from there."_ — not _"Run manage_board."_
