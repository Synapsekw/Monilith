# Agents Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `/ask` into **Agents** — a chat surface where a leading `@handle` routes a turn to that agent and stays on it, agents answer with their own documents and memory, daily briefings live in their own rail section, and the page's UI matches layout C from the spec.

**Architecture:** The persona stops being an immutable property of a conversation. A new `ai_messages.agent_id` records who each turn belongs to; `ai_conversations.agent_id` becomes "who is on right now" and is rewritten server-side when a leading handle (or the header switcher) changes it. `/api/ask` reads the persona off the **last user message**, then composes that agent's system prompt through the same `documentBudget` → `selectDocuments`/`selectMemory` → `composeSystemPrompt` path a scheduled run uses. The rail splits into two bounded reads over two new partial indexes.

**Tech Stack:** Next.js 16 App Router (RSC + Server Actions), Supabase (Postgres + RLS), Anthropic SDK (the `/api/ask` stream), Zod, Vitest + Testing Library, Tailwind v4 + shadcn.

**Spec:** `docs/superpowers/specs/2026-09-07-agents-page-design.md`

## Global Constraints

- **This is Next.js 16.** Confirm any App Router / caching API against `node_modules/next/dist/docs/` before using it.
- **Server Components by default; Server Actions for all mutations.** The single sanctioned exception is the existing streaming route `src/app/api/ask/route.ts`.
- **Validate at boundaries with Zod.** TypeScript strict, no `any`.
- **Never trust a client-supplied agent id.** Every persona decision is re-derived server-side from message text + an RLS-scoped roster read.
- **Reuse canonical modules.** `ActionResult` / `fail` from `src/lib/actions/result.ts`. Knowledge-envelope arithmetic only from `src/lib/agents/document-budget.ts` and block building only from `src/lib/agents/document-inject.ts` — never a second copy.
- **Migrations:** minted with `scripts/new-migration.sh <slug>`, applied to DEV through the `supabase-dev` MCP with the **same version + name**, verified with `pnpm db:ledger-check`. In a worktree `pnpm db:types` fails (`LegacyProjectNotLinkedError`) — regenerate types with the `supabase-dev` MCP `generate_typescript_types` and run prettier on the result. Types are committed in the same task.
- **UI tasks must load the `pulse-ui` skill and the `frontend-design` skill before writing markup.** Monochrome + single periwinkle accent, hairlines brighten (never thicken) on hover, `Kicker` for mono uppercase labels.
- **Data-fetching budget (working agreement #5):** rail search, date grouping, briefings expand/collapse, mention filtering and agent chips are **client state over already-loaded data — 0 server round-trips**. Agent switch is one Server Action, never a `<Link>` or `router` navigation.
- **Route stays `/ask`.** Renaming is user-facing labels only; code identifiers (`AskChat`, `AskAiMark`, `askPulseStream`) are untouched.
- **Boundaries confirmed by the owner:** chat injects documents + memory **read-only** — no `agent_remember`/`agent_forget` descriptors in chat, and no agent capability grants in chat.
- **Commit identity** is `Danijel Jovanovic <info@synapse-solutions.ai>` (set by `start-task.sh`). **Stage by path** — never `git add -A`.
- **Commit subjects are lowercase** (commitlint `subject-case` rejects sentence-case).
- Gates for every task: `pnpm typecheck && pnpm lint && pnpm test`. The full `pnpm build` runs in Task 12 / `finish-task.sh`.

---

## Workspace

All of this work happens in **one** worktree — the tasks interlock on `AskChat.tsx`, `route.ts` and `conversations.ts`, so parallel worktrees would only manufacture rebase conflicts.

```bash
scripts/start-task.sh agents-page
cd .claude/worktrees/agents-page
```

For a subagent-driven session, call `EnterWorktree({ path: ".claude/worktrees/agents-page" })` first so dispatched subagents share the branch.

## File Structure

**Created**

| File                                                             | Responsibility                                                                    |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `supabase/migrations/<stamp>_message_agent_and_rail_indexes.sql` | `ai_messages.agent_id` + two partial rail indexes                                 |
| `src/lib/ai/ask/persona-routing.ts`                              | Pure: leading-handle parse + sticky persona resolution                            |
| `src/lib/ai/ask/persona-routing.test.ts`                         | Its unit tests                                                                    |
| `src/lib/ai/ask/agent-knowledge.ts`                              | Server: compose an agent's chat system prompt (documents + memory + instructions) |
| `src/lib/ai/ask/agent-knowledge.test.ts`                         | Its unit tests                                                                    |
| `src/components/ai/ask/ThreadHeader.tsx`                         | Thread title + agent switcher chip                                                |
| `src/components/ai/ask/ThreadHeader.test.tsx`                    | Its component tests                                                               |
| `src/components/ai/ask/rail-groups.ts`                           | Pure: Today/Earlier grouping + search filter for the rail                         |
| `src/components/ai/ask/rail-groups.test.ts`                      | Its unit tests                                                                    |

**Modified**

| File                                                                         | Change                                                                        |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `src/types/database.types.ts`                                                | Regenerated (never hand-edited)                                               |
| `src/lib/ai/ask/conversations.ts`                                            | `listChats` / `listBriefings`; `agent_id` in `MessageRow` + `ThreadMessage`   |
| `src/lib/ai/ask/conversation-actions.ts`                                     | Persona resolution on send; `setConversationAgent`                            |
| `src/app/api/ask/route.ts`                                                   | Persona from the last user message; agent knowledge; assistant row `agent_id` |
| `src/components/ai/ask/AskRailData.tsx`                                      | Two reads, passed as two props                                                |
| `src/components/ai/ask/ConversationRail.tsx`                                 | Search, Today/Earlier, Briefings section                                      |
| `src/components/ai/ask/AskChat.tsx`                                          | Header, persona state, drop `personaIgnored`                                  |
| `src/components/ai/ask/MessageList.tsx`                                      | Per-turn agent attribution, new empty state                                   |
| `src/components/ai/ask/Composer.tsx`                                         | Agent chips, sticky helper line                                               |
| `src/components/ai/ask/ThinkingIndicator.tsx`                                | Label copy                                                                    |
| `src/app/ask/page.tsx`, `src/app/ask/[conversationId]/page.tsx`              | Load roster + current persona                                                 |
| `src/components/shell/sidebar-nav.tsx`, `src/components/command-palette.tsx` | Labels                                                                        |
| `src/app/(app)/settings/agents/page.tsx` + settings nav                      | "Agent setup"                                                                 |

---

### Task 1: Schema — message agent + rail indexes

**Files:**

- Create: `supabase/migrations/<stamp>_message_agent_and_rail_indexes.sql`
- Modify: `src/types/database.types.ts` (regenerated)

**Interfaces:**

- Consumes: nothing.
- Produces: `ai_messages.agent_id: string | null` in the generated types; indexes `ai_conversations_chats_idx`, `ai_conversations_briefings_idx`.

- [ ] **Step 1: Mint the migration file**

```bash
scripts/new-migration.sh message_agent_and_rail_indexes
```

Note the printed path and version — the same version and name must be used when applying.

- [ ] **Step 2: Write the SQL**

```sql
-- Who a turn belongs to: on a user turn, the agent it was addressed to; on an
-- assistant turn, the agent that answered. NULL is the plain Monolith
-- assistant, which is what every pre-existing row is.
--
-- `on delete set null`, never cascade: deleting an agent must not delete the
-- owner's transcript. No new policy — `ai_messages` is insert-only and its
-- existing policies gate on conversation ownership, not per column.
alter table public.ai_messages
  add column agent_id uuid references public.user_agents (id) on delete set null;

-- The rail reads chats and briefings SEPARATELY so a week of daily reports can
-- no longer push chats past the shared cap. Each read is `user_id = $1` +
-- `order by updated_at desc limit 50` with the run_id predicate constant, so a
-- partial index serves each one index-only.
create index ai_conversations_chats_idx
  on public.ai_conversations (user_id, updated_at desc)
  where run_id is null;

create index ai_conversations_briefings_idx
  on public.ai_conversations (user_id, updated_at desc)
  where run_id is not null;
```

- [ ] **Step 3: Apply to DEV with the same version + name**

Use the `supabase-dev` MCP `apply_migration` tool with `name` = the migration file's name (version + slug exactly as minted) and the SQL above. Do not use the dashboard.

- [ ] **Step 4: Verify the ledger matches the repo**

Run: `pnpm db:ledger-check`
Expected: no drift reported in either direction. If the remote stamped its own version, repair with `scripts/reconcile-migration-version.sh` before continuing.

- [ ] **Step 5: Regenerate types**

Use the `supabase-dev` MCP `generate_typescript_types`, write the result to `src/types/database.types.ts`, then run `pnpm prettier --write src/types/database.types.ts`. (`pnpm db:types` throws `LegacyProjectNotLinkedError` inside a worktree.)

- [ ] **Step 6: Verify the column is in the types**

Run: `grep -n "agent_id" src/types/database.types.ts | head`
Expected: an `agent_id: string | null` line inside the `ai_messages` Row/Insert/Update blocks.

- [ ] **Step 7: Extend the RLS integration test for the new column**

In `src/lib/ai/ask/ai-conversations.rls.integration.test.ts`, add a case that tenant B can neither read nor write `ai_messages.agent_id` on tenant A's thread — the column carries no policy of its own, so this is the guard that says the inherited one covers it:

```ts
it("a non-owner cannot read or stamp agent_id on someone else's turn", async () => {
  const { data: read } = await tenantB
    .from("ai_messages")
    .select("id, agent_id")
    .eq("conversation_id", TENANT_A_CONVERSATION);
  expect(read ?? []).toEqual([]);

  const { error } = await tenantB.from("ai_messages").insert({
    conversation_id: TENANT_A_CONVERSATION,
    role: "user",
    content: "hello",
    agent_id: TENANT_A_AGENT,
  });
  expect(error).not.toBeNull();
});
```

Run: `PULSE_TEST_DB=1 pnpm vitest run src/lib/ai/ask/ai-conversations.rls.integration.test.ts`
Expected: PASS. Without `PULSE_TEST_DB` the suite SKIPS by design — say so in the report rather than claiming it passed.

- [ ] **Step 8: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations src/types/database.types.ts src/lib/ai/ask/ai-conversations.rls.integration.test.ts
git commit -m "feat(db): add ai_messages.agent_id and split rail indexes"
```

---

### Task 2: Persona routing (pure)

**Files:**

- Create: `src/lib/ai/ask/persona-routing.ts`
- Test: `src/lib/ai/ask/persona-routing.test.ts`

**Interfaces:**

- Consumes: `AgentMentionTarget` from `src/lib/collaboration/mentions.ts` (`{ kind: "agent"; agentId: string; handle: string; name: string }`).
- Produces:
  - `leadingHandle(text: string): string | null`
  - `resolveAddressedAgent(args: { text: string; roster: readonly AgentMentionTarget[]; currentAgentId: string | null }): { agentId: string | null; switched: boolean }`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/ai/ask/persona-routing.test.ts
import { describe, expect, it } from "vitest";
import { leadingHandle, resolveAddressedAgent } from "./persona-routing";
import type { AgentMentionTarget } from "@/lib/collaboration/mentions";

const roster: AgentMentionTarget[] = [
  { kind: "agent", agentId: "a-ops", handle: "ops", name: "Ops" },
  { kind: "agent", agentId: "a-fin", handle: "finance", name: "Finance" },
];

describe("leadingHandle", () => {
  it("reads a handle that leads the text", () => {
    expect(leadingHandle("@ops what slipped?")).toBe("ops");
  });

  it("lowercases, and stops at the handle charset", () => {
    expect(leadingHandle("  @OPS, anything?")).toBe("ops");
  });

  it("ignores a handle that does not lead", () => {
    expect(leadingHandle("ask @ops later")).toBeNull();
  });
});

describe("resolveAddressedAgent", () => {
  it("routes to the addressed agent and reports the switch", () => {
    expect(
      resolveAddressedAgent({
        text: "@finance what does that cost?",
        roster,
        currentAgentId: "a-ops",
      }),
    ).toEqual({ agentId: "a-fin", switched: true });
  });

  it("is STICKY: no handle keeps the current persona", () => {
    expect(
      resolveAddressedAgent({
        text: "and next week?",
        roster,
        currentAgentId: "a-ops",
      }),
    ).toEqual({ agentId: "a-ops", switched: false });
  });

  it("keeps the current persona when the handle matches nobody", () => {
    expect(
      resolveAddressedAgent({
        text: "@nobody hello",
        roster,
        currentAgentId: "a-ops",
      }),
    ).toEqual({ agentId: "a-ops", switched: false });
  });

  it("re-addressing the current agent is not a switch", () => {
    expect(
      resolveAddressedAgent({
        text: "@ops again please",
        roster,
        currentAgentId: "a-ops",
      }),
    ).toEqual({ agentId: "a-ops", switched: false });
  });

  it("answers as the plain assistant when there is no persona at all", () => {
    expect(
      resolveAddressedAgent({ text: "hello", roster, currentAgentId: null }),
    ).toEqual({ agentId: null, switched: false });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run src/lib/ai/ask/persona-routing.test.ts`
Expected: FAIL — cannot resolve `./persona-routing`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/ai/ask/persona-routing.ts
import type { AgentMentionTarget } from "@/lib/collaboration/mentions";

/**
 * The handle charset, mirroring `user_agents_handle_shape` (see
 * `src/lib/agents/handle.ts` · HANDLE_RE): lowercase letters, digits and
 * dashes, first character alphanumeric. Matching the real shape is what makes
 * "@ops," and "@ops?" address Ops — the punctuation simply is not part of a
 * handle.
 *
 * Free of `server-only` on purpose: the composer needs the same answer the
 * server will reach, so the helper line can name who will actually answer.
 */
const LEADING_HANDLE = /^@([a-z0-9][a-z0-9-]*)/i;

/** The handle that LEADS the text, lowercased, or null. Leading, not anywhere:
 *  "@ops what slipped?" addresses Ops; "ask @ops later" is a sentence that
 *  happens to name one. */
export function leadingHandle(text: string): string | null {
  const match = LEADING_HANDLE.exec(text.trim());
  return match ? match[1]!.toLowerCase() : null;
}

/**
 * Who answers this turn.
 *
 * STICKY: a turn with no leading handle inherits the thread's current persona,
 * so a conversation with an agent stays a conversation with that agent. A
 * handle nobody owns also inherits — the question is still a perfectly good
 * question, and erroring on a typo would be worse than answering it.
 *
 * `switched` is what tells the caller to rewrite `ai_conversations.agent_id`;
 * re-addressing the agent already on duty is deliberately NOT a switch, so a
 * habitual "@ops …" costs no write.
 *
 * PURE. The roster it is given decides everything, which is what lets the
 * server hand it an RLS-scoped roster and ignore whatever the client believed.
 */
export function resolveAddressedAgent(args: {
  text: string;
  roster: readonly AgentMentionTarget[];
  currentAgentId: string | null;
}): { agentId: string | null; switched: boolean } {
  const handle = leadingHandle(args.text);
  if (!handle) return { agentId: args.currentAgentId, switched: false };
  const hit = args.roster.find((a) => a.handle.toLowerCase() === handle);
  if (!hit) return { agentId: args.currentAgentId, switched: false };
  return {
    agentId: hit.agentId,
    switched: hit.agentId !== args.currentAgentId,
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run src/lib/ai/ask/persona-routing.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/ask/persona-routing.ts src/lib/ai/ask/persona-routing.test.ts
git commit -m "feat(ask): resolve a turn's agent from a leading handle, stickily"
```

---

### Task 3: Conversation reads carry the agent

**Files:**

- Modify: `src/lib/ai/ask/conversations.ts`
- Test: `src/lib/ai/ask/conversations.test.ts`

**Interfaces:**

- Consumes: `ai_messages.agent_id` (Task 1).
- Produces:
  - `MessageRow` gains `agent_id`.
  - `ThreadMessage` gains `agentId: string | null`.
  - `currentPersonaFrom(rows: MessageRow[], conversationAgentId: string | null): string | null`
  - `getConversationPersona(conversationId: string): Promise<string | null>`

- [ ] **Step 1: Write the failing test**

```ts
// append to src/lib/ai/ask/conversations.test.ts
import { currentPersonaFrom, toThreadMessages } from "./conversations";

describe("currentPersonaFrom", () => {
  const row = (
    role: "user" | "assistant",
    agent_id: string | null,
    created_at: string,
  ) => ({
    id: `m-${created_at}`,
    role,
    content: "x",
    tool_trace: null,
    agent_id,
    created_at,
  });

  it("takes the LAST user turn's agent, not the conversation column", () => {
    const rows = [
      row("user", "a-ops", "2026-09-07T10:00:00Z"),
      row("assistant", "a-ops", "2026-09-07T10:00:05Z"),
      row("user", "a-fin", "2026-09-07T10:01:00Z"),
    ];
    expect(currentPersonaFrom(rows, "a-ops")).toBe("a-fin");
  });

  it("falls back to the conversation column when no user turn carries one", () => {
    expect(currentPersonaFrom([row("user", null, "t")], "a-ops")).toBe("a-ops");
  });

  it("is null when neither has one", () => {
    expect(currentPersonaFrom([], null)).toBeNull();
  });
});

describe("toThreadMessages", () => {
  it("carries the answering agent onto the render shape", () => {
    const [m] = toThreadMessages([
      {
        id: "m1",
        role: "assistant",
        content: "hi",
        tool_trace: null,
        agent_id: "a-ops",
        created_at: "2026-09-07T10:00:00Z",
      },
    ]);
    expect(m.agentId).toBe("a-ops");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run src/lib/ai/ask/conversations.test.ts`
Expected: FAIL — `currentPersonaFrom` is not exported; `agentId` is undefined.

- [ ] **Step 3: Implement**

In `src/lib/ai/ask/conversations.ts`:

```ts
export type MessageRow = Pick<
  Database["public"]["Tables"]["ai_messages"]["Row"],
  "id" | "role" | "content" | "tool_trace" | "created_at" | "agent_id"
>;
```

Add `agent_id` to the `getMessages` select:

```ts
    .select("id, role, content, tool_trace, created_at, agent_id")
```

Extend the render shape and its mapping:

```ts
export type ThreadMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  trace: AskToolTrace | null;
  /** The agent this turn belongs to — who it was addressed to (user turn) or
   *  who answered it (assistant turn). Null is the plain assistant, which is
   *  every row written before per-message routing existed. */
  agentId: string | null;
};

export function toThreadMessages(rows: MessageRow[]): ThreadMessage[] {
  return rows.map((r) => ({
    id: r.id,
    role: r.role as "user" | "assistant",
    content: r.content,
    trace: parseToolTrace(r.tool_trace),
    agentId: r.agent_id,
  }));
}

/**
 * Who is on duty in this thread.
 *
 * The LAST USER TURN wins over `ai_conversations.agent_id`: the column is
 * rewritten by the same send that writes the message, so the two agree — but
 * the message is the record of what was actually asked, and a persona that
 * disagrees with the last question is the bug this whole slice removes. The
 * column is the fallback for threads written before the column existed, and
 * for a briefing thread whose only turn is the agent's own report.
 */
export function currentPersonaFrom(
  rows: MessageRow[],
  conversationAgentId: string | null,
): string | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i]!;
    if (r.role === "user" && r.agent_id) return r.agent_id;
  }
  return conversationAgentId;
}

/** The thread's persona column, for a surface that has the id but not the
 *  rows. One indexed single-row read; degrades to null rather than throwing —
 *  a thread that renders as the plain assistant beats a 500. */
export async function getConversationPersona(
  conversationId: string,
): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ai_conversations")
    .select("agent_id")
    .eq("id", conversationId)
    .maybeSingle();
  if (error) {
    console.error(`[ask] persona read failed for ${conversationId}`, error);
    return null;
  }
  return data?.agent_id ?? null;
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run src/lib/ai/ask/conversations.test.ts`
Expected: PASS. Fix any existing test in that file whose fixture rows now need `agent_id` (add `agent_id: null`).

- [ ] **Step 5: Typecheck the consumers**

Run: `pnpm typecheck`
Expected: PASS — if `AskChat`/`MessageList` complain about `agentId`, add the optional field to `UIMessage` now (`agentId?: string | null`); Task 9 renders it.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ai/ask/conversations.ts src/lib/ai/ask/conversations.test.ts src/components/ai/ask/MessageList.tsx
git commit -m "feat(ask): read each turn's agent and derive the thread's persona"
```

---

### Task 4: Sends resolve the persona; the header can set it

**Files:**

- Modify: `src/lib/ai/ask/conversation-actions.ts`
- Test: `src/lib/ai/ask/conversation-actions.test.ts`

**Interfaces:**

- Consumes: `resolveAddressedAgent` (Task 2), `currentPersonaFrom` / `getMessages` (Task 3), `listOwnerAgentTargets` from `src/lib/ai/ask/owner-agents.ts`.
- Produces:
  - `appendUserMessage` persists `ai_messages.agent_id` and updates `ai_conversations.agent_id` on a switch; returns `ActionResult<{ messageId: string; agentId: string | null }>`.
  - `createConversation` accepts `agentId?: string` **or** resolves a leading handle from `firstMessage`; returns `ActionResult<{ conversationId: string; agentId: string | null }>`.
  - `setConversationAgent(input: { conversationId: string; agentId: string | null }): Promise<ActionResult<{ agentId: string | null }>>`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/ai/ask/conversation-actions.test.ts — new describe blocks
describe("appendUserMessage persona routing", () => {
  it("stamps the addressed agent on the message and moves the thread's persona", async () => {
    // roster read -> ops + finance; thread currently on ops
    const res = await appendUserMessage({
      conversationId: "11111111-1111-4111-8111-111111111111",
      content: "@finance what does that cost?",
    });
    expect(res).toEqual({
      ok: true,
      data: { messageId: "m1", agentId: "a-fin" },
    });
    expect(insertedMessage).toMatchObject({ role: "user", agent_id: "a-fin" });
    expect(updatedConversation).toMatchObject({ agent_id: "a-fin" });
  });

  it("inherits the current persona when no handle leads the message", async () => {
    const res = await appendUserMessage({
      conversationId: "11111111-1111-4111-8111-111111111111",
      content: "and next week?",
    });
    expect(insertedMessage).toMatchObject({ agent_id: "a-ops" });
    expect(updatedConversation).toBeNull(); // no switch, no write
    expect(res.ok).toBe(true);
  });
});

describe("setConversationAgent", () => {
  it("refuses an agent the caller does not own", async () => {
    // ownedAgentId's RLS-scoped read returns no row
    const res = await setConversationAgent({
      conversationId: "11111111-1111-4111-8111-111111111111",
      agentId: "22222222-2222-4222-8222-222222222222",
    });
    expect(res).toEqual({ ok: false, error: "Agent not found." });
  });

  it("clears the persona back to the plain assistant", async () => {
    const res = await setConversationAgent({
      conversationId: "11111111-1111-4111-8111-111111111111",
      agentId: null,
    });
    expect(res).toEqual({ ok: true, data: { agentId: null } });
    expect(updatedConversation).toMatchObject({ agent_id: null });
  });
});
```

Mock the Supabase client the same way `conversations.test.ts` does (`vi.mock("@/lib/supabase/server")` with a `from` spy), and mock `@/lib/ai/ask/owner-agents` to return the two-agent roster. Capture `insertedMessage` / `updatedConversation` in the `from` spy's chain so the assertions above have something to read.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run src/lib/ai/ask/conversation-actions.test.ts`
Expected: FAIL — `setConversationAgent` is not exported; `agent_id` is never written.

- [ ] **Step 3: Implement in `conversation-actions.ts`**

```ts
import { resolveAddressedAgent } from "@/lib/ai/ask/persona-routing";
import { listOwnerAgentTargets } from "@/lib/ai/ask/owner-agents";
import { currentPersonaFrom } from "@/lib/ai/ask/conversations";
```

`appendUserMessage` becomes:

```ts
/**
 * Append a follow-up user message, and decide who answers it.
 *
 * The persona is re-derived HERE, server-side, from the message text and an
 * RLS-scoped roster — the client's belief about which agent it addressed is
 * never an input. A leading handle switches the thread; anything else inherits
 * (see persona-routing.ts). The switch is written to the conversation row only
 * when it IS a switch, so a habitual "@ops …" costs one insert, not two writes.
 */
export async function appendUserMessage(input: {
  conversationId: string;
  content: string;
}): Promise<ActionResult<{ messageId: string; agentId: string | null }>> {
  const content = messageSchema.safeParse(input.content);
  const id = idSchema.safeParse(input.conversationId);
  if (!content.success || !id.success) return fail("Invalid message.");

  const user = await requireUser();
  const supabase = await createClient();

  // Both reads are RLS-scoped: a thread that is not the caller's returns no
  // rows, and the insert below would fail anyway.
  const [roster, rows] = await Promise.all([
    listOwnerAgentTargets(user.id),
    getMessages(id.data),
  ]);
  const conv = await supabase
    .from("ai_conversations")
    .select("agent_id")
    .eq("id", id.data)
    .maybeSingle();

  const { agentId, switched } = resolveAddressedAgent({
    text: content.data,
    roster,
    currentAgentId: currentPersonaFrom(rows, conv.data?.agent_id ?? null),
  });

  const { data, error } = await supabase
    .from("ai_messages")
    .insert({
      conversation_id: id.data,
      role: "user",
      content: content.data,
      agent_id: agentId,
    })
    .select("id")
    .single();
  if (error || !data) return fail("Couldn't save your message.");

  if (switched) {
    // Best-effort: the message already records who was addressed, and
    // `currentPersonaFrom` prefers it — so a failed column write costs the
    // header chip a beat, never the routing.
    await supabase
      .from("ai_conversations")
      .update({ agent_id: agentId })
      .eq("id", id.data);
  }

  return { ok: true, data: { messageId: data.id, agentId } };
}
```

`createConversation`: after the existing `ownedAgentId` block, resolve a leading handle when no explicit agent was supplied, and stamp the first message:

```ts
// An explicit `agentId` (the board dock, or a surface with a chosen persona)
// wins; otherwise a handle LEADING the first message picks the persona, which
// is what makes "@ops what slipped?" open a thread with Ops.
if (!agentId) {
  const roster = await listOwnerAgentTargets(user.id);
  agentId = resolveAddressedAgent({
    text: parsed.data,
    roster,
    currentAgentId: null,
  }).agentId;
}
```

(Move `const user = await requireUser();` above this block.) Then the first message insert takes `agent_id: agentId`, and the return becomes:

```ts
return { ok: true, data: { conversationId: conv.data.id, agentId } };
```

New action:

```ts
/**
 * Put a different agent on duty for the rest of the thread — the header
 * switcher, and the ONLY way back to the plain Monolith assistant (`null`).
 * There is no magic handle for that: "monolith" and "none" are reserved and
 * can never be an agent's handle (see agents/handle.ts · RESERVED_HANDLES).
 *
 * One targeted write, no revalidation: the rail does not render personas, and
 * revalidating `/ask` here would re-run the page's reads for a chip
 * (working agreement #5).
 */
export async function setConversationAgent(input: {
  conversationId: string;
  agentId: string | null;
}): Promise<ActionResult<{ agentId: string | null }>> {
  const id = idSchema.safeParse(input.conversationId);
  if (!id.success) return fail("Invalid conversation.");

  let agentId: string | null = null;
  if (input.agentId !== null) {
    const a = idSchema.safeParse(input.agentId);
    if (!a.success) return fail("Invalid agent.");
    agentId = await ownedAgentId(a.data);
    // Fails CLOSED, with one message for "not yours" and "not there" alike.
    if (!agentId) return fail("Agent not found.");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("ai_conversations")
    .update({ agent_id: agentId })
    .eq("id", id.data);
  if (error) return fail("Couldn't switch agent.");
  return { ok: true, data: { agentId } };
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run src/lib/ai/ask/conversation-actions.test.ts`
Expected: PASS. Update any existing assertion that expected `createConversation` to resolve to `{ conversationId }` only.

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (AskChat consumes `res.data.conversationId`, which is unchanged).

- [ ] **Step 6: Commit**

```bash
git add src/lib/ai/ask/conversation-actions.ts src/lib/ai/ask/conversation-actions.test.ts
git commit -m "feat(ask): route each send to an agent and let the header switch it"
```

---

### Task 5: Agent knowledge in a chat turn

**Files:**

- Create: `src/lib/ai/ask/agent-knowledge.ts`
- Test: `src/lib/ai/ask/agent-knowledge.test.ts`

**Interfaces:**

- Consumes: `listDocumentsForAgent(client, userAgentId)` and `listMemoryForAgent(client, userAgentId)`; `documentBudget`, `selectDocuments`, `selectMemory`, `estimateTokens`, `ASSUMED_PREFIX_TOKENS` from `document-budget.ts`; `buildDocumentBlock`, `buildMemoryBlock`, `composeSystemPrompt` from `document-inject.ts`.
- Produces: `composeAgentChatSystem(args: { client: SupabaseClient<Database>; preamble: string; agent: { id: string; name: string; instructions: string; docNonce: string }; contextLength: number | null }): Promise<string>`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/ai/ask/agent-knowledge.test.ts
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/agents/documents-db", () => ({
  listDocumentsForAgent: vi.fn(async () => [
    { id: "d1", title: "Tone guide", body: "Be terse.", tokenEstimate: 10 },
  ]),
}));
vi.mock("@/lib/agents/memory-db", () => ({
  listMemoryForAgent: vi.fn(async () => [
    { key: "cadence", value: "Standup is 09:30", tokenEstimate: 8 },
  ]),
}));

import { composeAgentChatSystem } from "./agent-knowledge";

const agent = {
  id: "a-ops",
  name: "Ops",
  instructions: "Watch the delivery board.",
  docNonce: "NONCE123",
};

describe("composeAgentChatSystem", () => {
  it("orders preamble, documents, memory, then instructions", async () => {
    const out = await composeAgentChatSystem({
      client: {} as never,
      preamble: "PREAMBLE",
      agent,
      contextLength: 200_000,
    });
    const doc = out.indexOf("Tone guide");
    const mem = out.indexOf("Standup is 09:30");
    const ins = out.indexOf("Watch the delivery board.");
    expect(out.startsWith("PREAMBLE")).toBe(true);
    expect(doc).toBeLessThan(mem);
    expect(mem).toBeLessThan(ins);
  });

  it("keys the instructions marker with the agent's nonce", async () => {
    const out = await composeAgentChatSystem({
      client: {} as never,
      preamble: "PREAMBLE",
      agent,
      contextLength: 200_000,
    });
    expect(out).toContain("[NONCE123]");
  });

  it("names the agent in the preamble it composes with", async () => {
    const out = await composeAgentChatSystem({
      client: {} as never,
      preamble: "PREAMBLE",
      agent,
      contextLength: 200_000,
    });
    expect(out).toContain('personal agent "Ops"');
  });

  it("degrades to instructions-only when the knowledge reads fail", async () => {
    const { listDocumentsForAgent } = await import("@/lib/agents/documents-db");
    vi.mocked(listDocumentsForAgent).mockRejectedValueOnce(new Error("boom"));
    const out = await composeAgentChatSystem({
      client: {} as never,
      preamble: "PREAMBLE",
      agent,
      contextLength: 200_000,
    });
    expect(out).toContain("Watch the delivery board.");
    expect(out).not.toContain("Tone guide");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run src/lib/ai/ask/agent-knowledge.test.ts`
Expected: FAIL — cannot resolve `./agent-knowledge`.

- [ ] **Step 3: Implement**

```ts
// src/lib/ai/ask/agent-knowledge.ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { listDocumentsForAgent } from "@/lib/agents/documents-db";
import { listMemoryForAgent } from "@/lib/agents/memory-db";
import {
  ASSUMED_PREFIX_TOKENS,
  documentBudget,
  estimateTokens,
  selectDocuments,
  selectMemory,
} from "@/lib/agents/document-budget";
import {
  buildDocumentBlock,
  buildMemoryBlock,
  composeSystemPrompt,
} from "@/lib/agents/document-inject";

/** Neutralise a name interpolated inline: no newlines to start a fresh
 *  instruction line, no angle brackets to open or close a block. Same stance as
 *  `persona.ts` · sanitizeInline, which this replaces for agent turns. */
function sanitizeInline(text: string): string {
  return text.replace(/[\r\n]+/g, " ").replace(/[<>]/g, "");
}

/**
 * The system prompt for a chat turn answered BY AN AGENT.
 *
 * It goes through the SAME path a scheduled run uses — `documentBudget` divides
 * one envelope between documents and memory, `selectDocuments` is
 * all-or-nothing, `selectMemory` keeps the freshest that fit, and
 * `composeSystemPrompt` keys the instructions marker with the agent's stable
 * `doc_nonce` whenever either untrusted block is present. A second arithmetic
 * here is exactly the drift `document-budget.ts` exists to prevent.
 *
 * READ-ONLY by design: no `agent_remember`/`agent_forget` descriptors are added
 * anywhere on this path. Memory is the one untrusted block whose writer and
 * reader are the same actor, and opening that on an interactive surface is its
 * own spec.
 *
 * Called INSIDE the `runAi` callback, because that is the only place the
 * resolved model — and therefore its real context window — is known
 * (`execute-run.ts` does the same, for the same reason).
 *
 * NEVER throws. A knowledge read that fails degrades to instructions-only: an
 * agent answering with less context beats a turn that fails outright.
 */
export async function composeAgentChatSystem(args: {
  client: SupabaseClient<Database>;
  preamble: string;
  agent: { id: string; name: string; instructions: string; docNonce: string };
  contextLength: number | null;
}): Promise<string> {
  const named = [
    args.preamble,
    "",
    `You are answering as the user's personal agent "${sanitizeInline(args.agent.name)}".`,
  ].join("\n");

  let documentBlock = "";
  let memoryBlock = "";
  try {
    const [attached, notes] = await Promise.all([
      listDocumentsForAgent(args.client, args.agent.id),
      listMemoryForAgent(args.client, args.agent.id),
    ]);
    const memoryTokens = notes.reduce((n, m) => n + m.tokenEstimate, 0);
    const { budget, memoryNoteBudget } = documentBudget({
      contextLength: args.contextLength,
      prefixTokens: ASSUMED_PREFIX_TOKENS,
      instructionTokens: estimateTokens(args.agent.instructions),
      memoryTokens,
    });
    documentBlock = buildDocumentBlock(
      selectDocuments(attached, budget).included,
    );
    memoryBlock = buildMemoryBlock(
      selectMemory(notes, memoryNoteBudget).included,
    );
  } catch (e) {
    console.error(`[ask] agent knowledge read failed for ${args.agent.id}`, e);
  }

  return composeSystemPrompt({
    preamble: named,
    documentBlock,
    memoryBlock,
    instructions: args.agent.instructions,
    nonce: args.agent.docNonce,
  });
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run src/lib/ai/ask/agent-knowledge.test.ts`
Expected: PASS (4 tests). If `selectDocuments`/`selectMemory` return a different property name than `included`, read `src/lib/agents/document-budget.ts` and use the real one — do not add an adapter.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/ask/agent-knowledge.ts src/lib/ai/ask/agent-knowledge.test.ts
git commit -m "feat(ask): compose an agent's chat prompt from its documents and memory"
```

---

### Task 6: `/api/ask` answers as the addressed agent

**Files:**

- Modify: `src/app/api/ask/route.ts`
- Test: `src/app/api/ask/route.test.ts`

**Interfaces:**

- Consumes: `currentPersonaFrom` (Task 3), `composeAgentChatSystem` (Task 5), `model.contextLength` from the `runAi` callback's `ResolvedAiCall`.
- Produces: assistant rows stamped with `agent_id`; no change to the NDJSON event protocol.

- [ ] **Step 1: Write the failing test**

```ts
// src/app/api/ask/route.test.ts — new cases
it("answers as the agent the LAST user turn addressed, not the request body", async () => {
  // messages: user(@ops), assistant(ops), user(agent_id = a-fin)
  await POST(request({ conversationId: CONV_ID, agentId: "a-attacker" }));
  expect(capturedSystem).toContain('personal agent "Finance"');
  expect(capturedSystem).not.toContain("a-attacker");
});

it("stamps the answering agent on the assistant row", async () => {
  await POST(request({ conversationId: CONV_ID }));
  expect(insertedAssistantRow).toMatchObject({
    role: "assistant",
    agent_id: "a-fin",
  });
});

it("stays the plain assistant when no turn carries an agent", async () => {
  // all rows agent_id: null, conversation agent_id null
  await POST(request({ conversationId: CONV_ID }));
  expect(capturedSystem).not.toContain("personal agent");
});
```

Follow the existing mocking in `route.test.ts` (it already stubs `runAi`, the Supabase client and `askPulseStream`); capture the `system` string `askPulseStream` was called with.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run src/app/api/ask/route.test.ts`
Expected: FAIL — the persona still comes from `conv.data.agent_id`, and the assistant insert has no `agent_id`.

- [ ] **Step 3: Implement**

Delete the pre-turn persona block (`if (conv.data.agent_id) { … composePersona … }`) and the now-unused `composePersona` import; keep `composeBoardScope`. Inside the turn, after `const allRows = await getMessages(conversationId);`:

```ts
// WHO ANSWERS. The last user turn's `agent_id` — written by
// appendUserMessage from the message text against an RLS-scoped roster —
// is the record of what was actually asked. The request body carries no
// agent field at all, so a client cannot select a persona here.
const personaAgentId = currentPersonaFrom(allRows, conv.data.agent_id);
const personaAgent = personaAgentId
  ? (
      await supabase
        .from("user_agents")
        .select("id, name, instructions, doc_nonce")
        .eq("id", personaAgentId)
        .maybeSingle()
    ).data
  : null;
```

Inside the `runAi` callback, compose the agent's system prompt where the model is known:

```ts
// Composed HERE, not above: `model.contextLength` is what the
// knowledge envelope is divided against, and it is only resolved
// inside this callback (execute-run.ts, same reason).
const turnSystem = personaAgent
  ? await composeAgentChatSystem({
      client: supabase,
      preamble: system,
      agent: {
        id: personaAgent.id,
        name: personaAgent.name,
        instructions: personaAgent.instructions,
        docNonce: personaAgent.doc_nonce,
      },
      contextLength: model.contextLength,
    })
  : system;
```

and pass `system: composeSystem(turnSystem, summary)` to `askPulseStream`. Stamp the persisted row:

```ts
        .insert({
          conversation_id: conversationId,
          role: "assistant",
          content: result.answer,
          tool_trace: trace as unknown as Json,
          agent_id: personaAgentId,
        })
```

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run src/app/api/ask/route.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite + typecheck**

Run: `pnpm typecheck && pnpm vitest run`
Expected: PASS. `persona.ts`'s `composePersona` may now be unused by the route — leave the module and its tests in place if the board dock still imports it; if nothing imports it, delete `composePersona` and its tests in this commit.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/ask/route.ts src/app/api/ask/route.test.ts
git commit -m "feat(ask): answer each turn as the agent that turn addressed"
```

---

### Task 7: Rail reads split chats from briefings

**Files:**

- Modify: `src/lib/ai/ask/conversations.ts`, `src/components/ai/ask/AskRailData.tsx`
- Test: `src/lib/ai/ask/conversations.test.ts`

**Interfaces:**

- Consumes: the partial indexes from Task 1.
- Produces:
  - `RAIL_LIMIT = 50`
  - `listChats(userId: string): Promise<ConversationRow[]>`
  - `listBriefings(userId: string): Promise<ConversationRow[]>`
  - `ConversationRail` receives `chats` and `briefings` props (Task 8 renders them).

- [ ] **Step 1: Write the failing test**

```ts
describe("listChats / listBriefings", () => {
  it("lists only threads with no run, bounded and newest-first", async () => {
    const limit = vi
      .fn()
      .mockResolvedValue({ data: [{ id: "c1" }], error: null });
    const order = vi.fn().mockReturnValue({ limit });
    const is = vi.fn().mockReturnValue({ order });
    const eq = vi.fn().mockReturnValue({ is });
    from.mockReturnValue({ select: vi.fn().mockReturnValue({ eq }) });

    await listChats("user-1");
    expect(eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(is).toHaveBeenCalledWith("run_id", null);
    expect(order).toHaveBeenCalledWith("updated_at", { ascending: false });
    expect(limit).toHaveBeenCalledWith(50);
  });

  it("lists only briefings", async () => {
    const limit = vi.fn().mockResolvedValue({ data: [], error: null });
    const order = vi.fn().mockReturnValue({ limit });
    const not = vi.fn().mockReturnValue({ order });
    const eq = vi.fn().mockReturnValue({ not });
    from.mockReturnValue({ select: vi.fn().mockReturnValue({ eq }) });

    await listBriefings("user-1");
    expect(not).toHaveBeenCalledWith("run_id", "is", null);
    expect(limit).toHaveBeenCalledWith(50);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run src/lib/ai/ask/conversations.test.ts`
Expected: FAIL — `listChats` / `listBriefings` are not exported.

- [ ] **Step 3: Implement**

Replace `listConversations` (and its old test) with:

```ts
/** Each rail section is bounded on its own. Two reads, not one shared cap: a
 *  week of daily briefings would otherwise push every chat past a single limit,
 *  which is the bug this split exists to fix. Both are served index-only by the
 *  partial indexes added with `ai_messages.agent_id`. */
export const RAIL_LIMIT = 50;

/** The user's own chats — threads no agent run wrote. */
export async function listChats(userId: string): Promise<ConversationRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ai_conversations")
    .select("id, title, updated_at")
    .eq("user_id", userId)
    .is("run_id", null)
    .order("updated_at", { ascending: false })
    .limit(RAIL_LIMIT);
  if (error) throw new Error(`listChats: ${error.message}`);
  return data ?? [];
}

/** Briefings — one per agent run (`writeBriefingThread` sets `run_id`). */
export async function listBriefings(
  userId: string,
): Promise<ConversationRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ai_conversations")
    .select("id, title, updated_at")
    .eq("user_id", userId)
    .not("run_id", "is", null)
    .order("updated_at", { ascending: false })
    .limit(RAIL_LIMIT);
  if (error) throw new Error(`listBriefings: ${error.message}`);
  return data ?? [];
}
```

`AskRailData.tsx`:

```tsx
export async function AskRailData() {
  const user = await requireUser();
  // Two bounded, indexed reads issued concurrently — one round-trip's latency
  // for both (working agreement #5).
  const [chats, briefings] = await Promise.all([
    listChats(user.id),
    listBriefings(user.id),
  ]);
  return <ConversationRail chats={chats} briefings={briefings} />;
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run src/lib/ai/ask/conversations.test.ts`
Expected: PASS. `ConversationRail` will not typecheck until Task 8 — that is expected; do not "fix" it by keeping the old prop.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/ask/conversations.ts src/lib/ai/ask/conversations.test.ts src/components/ai/ask/AskRailData.tsx
git commit -m "feat(ask): read chats and briefings as two bounded rail sections"
```

---

### Task 8: Rail UI — search, Today/Earlier, briefings section

**Files:**

- Create: `src/components/ai/ask/rail-groups.ts`, `src/components/ai/ask/rail-groups.test.ts`
- Modify: `src/components/ai/ask/ConversationRail.tsx`
- Test: `src/components/ai/ask/ConversationRail.test.tsx`

**Interfaces:**

- Consumes: `chats` / `briefings` (Task 7).
- Produces: `ConversationRail({ chats, briefings })`; `groupChats(rows, now)`, `filterRows(rows, query)`.

**Before writing markup:** load the `pulse-ui` skill and the `frontend-design` skill.

- [ ] **Step 1: Write the failing test for the pure helpers**

```ts
// src/components/ai/ask/rail-groups.test.ts
import { describe, expect, it } from "vitest";
import { filterRows, groupChats } from "./rail-groups";

const row = (id: string, title: string, updated_at: string) => ({
  id,
  title,
  updated_at,
});
const NOW = new Date("2026-09-07T15:00:00Z");

describe("groupChats", () => {
  it("splits today from earlier in the viewer's local day", () => {
    const groups = groupChats(
      [
        row("c1", "Today thread", "2026-09-07T09:00:00Z"),
        row("c2", "Old thread", "2026-09-01T09:00:00Z"),
      ],
      NOW,
    );
    expect(groups.today.map((r) => r.id)).toEqual(["c1"]);
    expect(groups.earlier.map((r) => r.id)).toEqual(["c2"]);
  });

  it("keeps a section absent rather than empty", () => {
    const groups = groupChats([row("c2", "Old", "2026-09-01T09:00:00Z")], NOW);
    expect(groups.today).toEqual([]);
  });
});

describe("filterRows", () => {
  it("matches titles case-insensitively", () => {
    const rows = [row("c1", "Q3 slippage", "t"), row("c2", "Hiring", "t")];
    expect(filterRows(rows, "SLIP").map((r) => r.id)).toEqual(["c1"]);
  });

  it("returns everything for an empty query", () => {
    const rows = [row("c1", "A", "t")];
    expect(filterRows(rows, "  ")).toEqual(rows);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run src/components/ai/ask/rail-groups.test.ts`
Expected: FAIL — cannot resolve `./rail-groups`.

- [ ] **Step 3: Implement the helpers**

```ts
// src/components/ai/ask/rail-groups.ts
import type { ConversationRow } from "@/lib/ai/ask/conversations";

/** Same local calendar day as `now`. Local, not UTC: the rail says "Today" to a
 *  person, and a person's day is the one their clock is on. */
function isSameLocalDay(iso: string, now: Date): boolean {
  const d = new Date(iso);
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

/** Today / Earlier, preserving the server's newest-first order. Pure, so the
 *  rail can regroup on every keystroke without a round-trip. */
export function groupChats(
  rows: readonly ConversationRow[],
  now: Date,
): { today: ConversationRow[]; earlier: ConversationRow[] } {
  const today: ConversationRow[] = [];
  const earlier: ConversationRow[] = [];
  for (const r of rows) {
    (isSameLocalDay(r.updated_at, now) ? today : earlier).push(r);
  }
  return { today, earlier };
}

/** Title search over rows the page ALREADY loaded — a keystroke costs zero
 *  server round-trips (working agreement #5). */
export function filterRows(
  rows: readonly ConversationRow[],
  query: string,
): ConversationRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...rows];
  return rows.filter((r) => r.title.toLowerCase().includes(q));
}
```

- [ ] **Step 4: Run the helper tests**

Run: `pnpm vitest run src/components/ai/ask/rail-groups.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Write the failing rail component test**

```tsx
// src/components/ai/ask/ConversationRail.test.tsx — add to the existing file
const chats: ConversationRow[] = [
  { id: "c1", title: "Q3 slippage", updated_at: new Date().toISOString() },
  { id: "c2", title: "Hiring plan", updated_at: "2026-08-01T10:00:00Z" },
];
const briefings: ConversationRow[] = [
  { id: "b1", title: "Ops — 2026-09-07", updated_at: "2026-09-07T06:00:00Z" },
];

it("keeps briefings out of the chat list, in their own section", () => {
  render(<ConversationRail chats={chats} briefings={briefings} />);
  const chatNav = screen.getByRole("navigation", { name: /chats/i });
  expect(within(chatNav).queryByText(/Ops — 2026-09-07/)).toBeNull();
  expect(screen.getByRole("group", { name: /briefings/i })).toBeInTheDocument();
});

it("counts the briefings on the collapsed section", () => {
  render(<ConversationRail chats={chats} briefings={briefings} />);
  expect(screen.getByText(/briefings/i).textContent).toMatch(/1/);
});

it("filters the loaded rows as you type, with no server call", async () => {
  render(<ConversationRail chats={chats} briefings={briefings} />);
  await userEvent.type(
    screen.getByLabelText(/search conversations/i),
    "hiring",
  );
  expect(screen.queryByText("Q3 slippage")).toBeNull();
  expect(screen.getByText("Hiring plan")).toBeInTheDocument();
});

it("groups today's chats under Today", () => {
  render(<ConversationRail chats={chats} briefings={briefings} />);
  expect(screen.getByText(/^today$/i)).toBeInTheDocument();
  expect(screen.getByText(/^earlier$/i)).toBeInTheDocument();
});
```

Import `within` from `@testing-library/react` and `userEvent` from `@testing-library/user-event`.

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm vitest run src/components/ai/ask/ConversationRail.test.tsx`
Expected: FAIL — the component still takes `conversations`.

- [ ] **Step 7: Implement the rail**

Change the signature to `{ chats, briefings }`. Keep `RailRow` exactly as it is (rename/delete work on both kinds of row). Add, in order:

1. the existing **New chat** button (keep `bg-transparent` — the rail sits on the wash; its test is already in this file);
2. a search `Input` with `aria-label="Search conversations"`, `value`/`onChange` bound to a `query` state;
3. `<nav aria-label="Chats">` containing `Today` and `Earlier` `<Kicker>` sections rendered from `groupChats(filterRows(chats, query), new Date())` — render a section only when it has rows;
4. a `<details>` element with `aria-label="Briefings"` (`role="group"`), summary `Briefings` + count, listing `filterRows(briefings, query)` as `RailRow`s. Collapsed by default.

Empty states: "No conversations yet." when `chats` is empty, "No matches." when a query filters everything out.

- [ ] **Step 8: Run the rail tests**

Run: `pnpm vitest run src/components/ai/ask/ConversationRail.test.tsx`
Expected: PASS, including the pre-existing `bg-transparent` test.

- [ ] **Step 9: Commit**

```bash
git add src/components/ai/ask/rail-groups.ts src/components/ai/ask/rail-groups.test.ts src/components/ai/ask/ConversationRail.tsx src/components/ai/ask/ConversationRail.test.tsx
git commit -m "feat(ask): give the rail search, day groups and a briefings section"
```

---

### Task 9: Thread header with the agent switcher

**Files:**

- Create: `src/components/ai/ask/ThreadHeader.tsx`, `src/components/ai/ask/ThreadHeader.test.tsx`
- Modify: `src/components/ai/ask/AskChat.tsx`, `src/app/ask/page.tsx`, `src/app/ask/[conversationId]/page.tsx`
- Test: `src/components/ai/ask/AskChat.test.tsx`

**Interfaces:**

- Consumes: `setConversationAgent` (Task 4), `getConversationPersona` (Task 3), `listOwnerAgentTargets`, `MentionTarget`.
- Produces: `ThreadHeader({ title, agents, agentId, onAgentChange })`; `AskChat` gains `title?: string` and `initialAgentId?: string | null` props and owns the live persona state.

**Before writing markup:** load the `pulse-ui` skill and the `frontend-design` skill.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/ai/ask/ThreadHeader.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThreadHeader } from "./ThreadHeader";
import type { MentionTarget } from "@/lib/collaboration/mentions";

const agents: MentionTarget[] = [
  { kind: "agent", agentId: "a-ops", handle: "ops", name: "Ops" },
  { kind: "agent", agentId: "a-fin", handle: "finance", name: "Finance" },
];

describe("ThreadHeader", () => {
  it("names who is answering", () => {
    render(
      <ThreadHeader
        title="Q3 slippage"
        agents={agents}
        agentId="a-ops"
        onAgentChange={vi.fn()}
      />,
    );
    expect(screen.getByText("Q3 slippage")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ops/i })).toBeInTheDocument();
  });

  it("falls back to the plain assistant when no agent is on duty", () => {
    render(
      <ThreadHeader
        title="New chat"
        agents={agents}
        agentId={null}
        onAgentChange={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: /monolith assistant/i }),
    ).toBeInTheDocument();
  });

  it("switches to another agent", async () => {
    const onAgentChange = vi.fn();
    render(
      <ThreadHeader
        title="Q3"
        agents={agents}
        agentId="a-ops"
        onAgentChange={onAgentChange}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /ops/i }));
    await userEvent.click(screen.getByRole("menuitem", { name: /finance/i }));
    expect(onAgentChange).toHaveBeenCalledWith("a-fin");
  });

  it("hands back the plain assistant", async () => {
    const onAgentChange = vi.fn();
    render(
      <ThreadHeader
        title="Q3"
        agents={agents}
        agentId="a-ops"
        onAgentChange={onAgentChange}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /ops/i }));
    await userEvent.click(
      screen.getByRole("menuitem", { name: /monolith assistant/i }),
    );
    expect(onAgentChange).toHaveBeenCalledWith(null);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run src/components/ai/ask/ThreadHeader.test.tsx`
Expected: FAIL — cannot resolve `./ThreadHeader`.

- [ ] **Step 3: Implement `ThreadHeader`**

A `"use client"` component: thread title on the left (truncating), and on the right a `DropdownMenu` (`@/components/ui/dropdown-menu`, already used by the rail) whose trigger is a `Button variant="ghost" size="sm"` showing a periwinkle dot + the current agent's name, or "Monolith assistant" when `agentId` is null. Menu items: every agent in `agents` (`kind === "agent"`), a separator, then "Monolith assistant". Each item calls `onAgentChange(agentId | null)`.

Document in the component's doc comment that switching is one Server Action and never a navigation.

- [ ] **Step 4: Run the header tests**

Run: `pnpm vitest run src/components/ai/ask/ThreadHeader.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire it into `AskChat`**

- Add props `title?: string` and `initialAgentId?: string | null`.
- `const [agentId, setAgentId] = useState<string | null>(initialAgentId ?? null);`
- Render `<ThreadHeader …/>` above `MessageList`, only when `agents.length > 0` **or** a thread exists (the board dock passes no agents and no title — it must keep rendering exactly as before).
- `onAgentChange`: set state immediately; if `activeId` exists, call `setConversationAgent({ conversationId: activeId, agentId: next })` inside `startTransition` and revert the state on `!res.ok`.
- `onSubmit`: pass `addressedAgentId ?? agentId` as the persona for a new conversation, and after a successful send set `setAgentId(res.data.agentId)` from `createConversation` / `appendUserMessage`.
- **Delete** `personaIgnored`, its `setPersonaIgnored` calls and the notice block at the bottom of the component.

Pages:

```tsx
// src/app/ask/page.tsx — unchanged except the title
return (
  <AskChat
    conversationId={null}
    initialMessages={[]}
    agents={agents}
    title="New chat"
  />
);
```

```tsx
// src/app/ask/[conversationId]/page.tsx
const user = await requireUser();
const [rows, runId, agents, persona] = await Promise.all([
  getMessages(conversationId),
  getConversationRunId(conversationId),
  listOwnerAgentTargets(user.id),
  getConversationPersona(conversationId),
]);
…
<AskChat
  conversationId={conversationId}
  initialMessages={toThreadMessages(rows)}
  agentProposals={proposals}
  agents={agents}
  initialAgentId={persona}
/>
```

- [ ] **Step 6: Update the AskChat test**

Replace any assertion on the "Start a new chat to ask a different agent." notice with one that the notice is **gone** and the header chip reflects the new agent after a send. Run: `pnpm vitest run src/components/ai/ask/AskChat.test.tsx`
Expected: PASS.

- [ ] **Step 7: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/components/ai/ask/ThreadHeader.tsx src/components/ai/ask/ThreadHeader.test.tsx src/components/ai/ask/AskChat.tsx src/components/ai/ask/AskChat.test.tsx "src/app/ask/page.tsx" "src/app/ask/[conversationId]/page.tsx"
git commit -m "feat(ask): add a thread header that names and switches the agent"
```

---

### Task 10: Attribute every answer in the transcript

**Files:**

- Modify: `src/components/ai/ask/MessageList.tsx`, `src/components/ai/ask/ThinkingIndicator.tsx`, `src/components/ai/ask/AskChat.tsx`
- Test: `src/components/ai/ask/MessageList.test.tsx`

**Interfaces:**

- Consumes: `UIMessage.agentId` (Task 3), the roster (`MentionTarget[]`).
- Produces: `MessageList` gains `agents?: readonly MentionTarget[]` and `streamingAgentId?: string | null`.

**Before writing markup:** load the `pulse-ui` skill and the `frontend-design` skill.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/ai/ask/MessageList.test.tsx — new cases
const agents: MentionTarget[] = [
  { kind: "agent", agentId: "a-ops", handle: "ops", name: "Ops" },
];

it("names the agent that answered a turn", () => {
  render(
    <MessageList
      messages={[
        {
          id: "m1",
          role: "user",
          content: "@ops what slipped?",
          agentId: "a-ops",
        },
        {
          id: "m2",
          role: "assistant",
          content: "Three items.",
          agentId: "a-ops",
        },
      ]}
      agents={agents}
      streamingText={null}
      status={null}
      onApprove={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
  expect(screen.getByText("Ops")).toBeInTheDocument();
});

it("labels an unattributed answer as the plain assistant", () => {
  render(
    <MessageList
      messages={[{ id: "m1", role: "assistant", content: "Hi", agentId: null }]}
      agents={agents}
      streamingText={null}
      status={null}
      onApprove={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
  expect(screen.getByText("Monolith")).toBeInTheDocument();
});

it("greets an owner with agents by offering them", () => {
  render(
    <MessageList
      messages={[]}
      agents={agents}
      streamingText={null}
      status={null}
      onApprove={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
  expect(screen.getByText(/@ops/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run src/components/ai/ask/MessageList.test.tsx`
Expected: FAIL — no attribution is rendered.

- [ ] **Step 3: Implement**

- `UIMessage` gains `agentId?: string | null` (already added in Task 3 if typecheck demanded it).
- `Bubble` takes `agentName: string` for assistant turns and renders it above the text as a `Kicker` (`Ops`, or `Monolith` when the turn has no agent) — the existing `size-7` mark stays as the gutter.
- `MessageList` resolves names once per render: `const nameOf = (id?: string | null) => agents.find((a) => a.kind === "agent" && a.agentId === id)?.name ?? "Monolith";`
- The live streaming bubble uses `nameOf(streamingAgentId)`.
- Empty state: keep the mark, change the `Kicker` to `Agents`, and when `agents.length > 0` list the handles ("Start with `@ops`, `@finance` — or just ask.").
- `ThinkingIndicator`: the fallback label becomes the answering agent's name when one is known — pass `label={status ?? \`${agentName} is working…\`}`from`MessageList`; keep `THINKING_FALLBACK_LABEL` for the no-agent case.
- `AskChat` passes `agents` and `streamingAgentId={agentId}` into `MessageList`.

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run src/components/ai/ask/MessageList.test.tsx src/components/ai/ask/ThinkingIndicator.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/ai/ask/MessageList.tsx src/components/ai/ask/MessageList.test.tsx src/components/ai/ask/ThinkingIndicator.tsx src/components/ai/ask/AskChat.tsx
git commit -m "feat(ask): name the agent behind every answer"
```

---

### Task 11: Composer — agent chips and a sticky helper line

**Files:**

- Modify: `src/components/ai/ask/Composer.tsx`
- Test: `src/components/ai/ask/Composer.test.tsx`

**Interfaces:**

- Consumes: `leadingHandle` / `resolveAddressedAgent` (Task 2), the roster, the sticky `agentId` (Task 9).
- Produces: `Composer({ disabled, agents, agentId, onSubmit })` — `agentId` is the thread's current persona, used for the helper line.

**Before writing markup:** load the `pulse-ui` skill and the `frontend-design` skill.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/ai/ask/Composer.test.tsx — new cases
it("says who answers when the persona is sticky and nothing was typed", () => {
  render(
    <Composer
      disabled={false}
      agents={agents}
      agentId="a-ops"
      onSubmit={vi.fn()}
    />,
  );
  expect(screen.getByText(/asking ops/i)).toBeInTheDocument();
});

it("a typed handle overrides the sticky persona in the helper line", async () => {
  render(
    <Composer
      disabled={false}
      agents={agents}
      agentId="a-ops"
      onSubmit={vi.fn()}
    />,
  );
  await userEvent.type(screen.getByLabelText(/your question/i), "@finance hi");
  expect(screen.getByText(/asking finance/i)).toBeInTheDocument();
});

it("inserts a handle when its chip is clicked", async () => {
  render(
    <Composer
      disabled={false}
      agents={agents}
      agentId={null}
      onSubmit={vi.fn()}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "@finance" }));
  expect(screen.getByLabelText(/your question/i)).toHaveValue("@finance ");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run src/components/ai/ask/Composer.test.tsx`
Expected: FAIL — no `agentId` prop, no chips.

- [ ] **Step 3: Implement**

- Replace the local `leadingAgent` helper with `resolveAddressedAgent` from Task 2 so the composer and the server agree by construction:

```ts
const { agentId: answeringId } = resolveAddressedAgent({
  text: value,
  roster: agents.filter((a): a is AgentMentionTarget => a.kind === "agent"),
  currentAgentId: agentId ?? null,
});
const answering = agents.find(
  (a) => a.kind === "agent" && a.agentId === answeringId,
);
```

- Helper line: `disabled` → "Working — one question at a time"; else `answering` → `Asking ${answering.name} — ⌘↵ to send`; else "⌘↵ to send".
- Chips: a row under the form, one `Button variant="ghost" size="sm"` per agent labelled `@handle`, which prepends the handle via `applyMention(value, value.length, target)` and focuses the textarea. Hidden when `agents.length === 0` (the board dock).
- `onSubmit` keeps sending the **typed** handle's agent id (or null) — the server re-resolves regardless.
- Placeholder becomes "Ask your agents…" when `agents.length > 0`.

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run src/components/ai/ask/Composer.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/ai/ask/Composer.tsx src/components/ai/ask/Composer.test.tsx
git commit -m "feat(ask): offer agent chips and say who answers next"
```

---

### Task 12: Rename Ask AI → Agents

**Files:**

- Modify: `src/components/shell/sidebar-nav.tsx`, `src/components/command-palette.tsx`, `src/app/(app)/settings/agents/page.tsx`, the settings nav entry for `/settings/agents`, `src/app/ask/layout.tsx` (doc comment)
- Test: whichever existing tests assert the old strings (`rg -n "Ask AI" src --glob '*.test.*'`)

**Interfaces:**

- Consumes: nothing.
- Produces: user-facing labels only. No route, component or export is renamed.

- [ ] **Step 1: Find every user-facing occurrence**

Run: `rg -n "Ask AI" src --glob '!src/lib/changelog/**'`
Expected: the nav link, the command palette item, the `/ask` layout doc comment, and any tests asserting them. **`src/lib/changelog/generated.ts` and the landing page are historical record — leave both alone.**

- [ ] **Step 2: Change the labels**

- `sidebar-nav.tsx`: `const ASK: NavLink = { label: "Agents", href: "/ask", icon: AskAiMark };`
- `command-palette.tsx`: `<AskAiMark className="size-4" /> Agents…`
- `settings/agents/page.tsx`: `export const metadata = { title: "Agent setup · Settings" };` and `<SettingsSection title="Agent setup" description="…">`. Keep the description text.
- The settings nav entry pointing at `/settings/agents`: label "Agent setup".
- `/ask` layout doc comment: "Layout B for the full-page **Agents** surface."

- [ ] **Step 3: Update the tests that assert the old strings**

Change the expected text in any test surfaced by Step 1 (e.g. a sidebar test asserting `Ask AI`) to the new label. Do not weaken an assertion to a regex that would pass either way.

- [ ] **Step 4: Run the suite**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/shell/sidebar-nav.tsx src/components/command-palette.tsx "src/app/(app)/settings/agents/page.tsx" src/app/ask/layout.tsx
git commit -m "feat(ui): rename ask ai to agents and settings to agent setup"
```

---

### Task 13: Verify and finish

**Files:** none (verification only).

- [ ] **Step 1: Run every gate**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all four PASS. Paste the real output into the task's report — evidence before claims (`superpowers:verification-before-completion`).

- [ ] **Step 2: Confirm the migration ledger still agrees**

Run: `pnpm db:ledger-check`
Expected: no drift.

- [ ] **Step 3: Exercise the surface by hand**

With `pnpm dev` running, on `/ask`: send `@<handle> what is overdue?` → the answer is stamped with that agent and the header chip names it; send a follow-up with no handle → the same agent answers; switch to "Monolith assistant" in the header → the next answer is stamped "Monolith"; confirm the rail lists chats under Today/Earlier with briefings collapsed in their own section, and that search filters instantly.

- [ ] **Step 4: Finish the task**

Run: `scripts/finish-task.sh` from inside the worktree. It rebases onto the latest `develop`, re-runs the gates against the merged state, merges, pushes and removes the worktree.

- [ ] **Step 5: Hand over a "How to test this" walkthrough**

Write the numbered manual-test guide (pull `develop`, where to go, what to click, expected result per step) into the closing message and into the `/wrapup` session note.

---

## Execution DAG

**Dependencies**

- Task 1 → everything that touches the new column or indexes (3, 4, 6, 7).
- Task 2 → Tasks 4, 11.
- Task 3 → Tasks 4, 6, 9, 10.
- Task 4 → Tasks 6, 9.
- Task 5 → Task 6.
- Task 7 → Task 8.
- Tasks 9, 10, 11 → Task 13.
- Task 12 is independent of all of them.

**Parallel batches**

| Batch | Tasks                      | Note                                                                              |
| ----- | -------------------------- | --------------------------------------------------------------------------------- |
| 1     | **1**, 12                  | The migration gates almost everything; the rename touches none of the same files. |
| 2     | **2**, **5**, **3**        | Pure/near-pure modules, disjoint files.                                           |
| 3     | **4**, **7**               | Actions and rail reads; disjoint files.                                           |
| 4     | **6**, **8**               | Route persona + rail UI.                                                          |
| 5     | **9**, then **10**, **11** | 9, 10 and 11 all edit `AskChat.tsx` — run them in sequence, not concurrently.     |
| 6     | **13**                     | Gates and closure.                                                                |

**Critical path:** 1 → 3 → 4 → 6 → 13 (schema, then the persona has to be readable, routable, and answerable before the surface is worth verifying).

**Concurrency caveat:** all tasks share ONE worktree, so "batch" means "safe to reorder / dispatch back-to-back", not "run two agents writing the same file at once". Batch 5's tasks are explicitly sequential.
