# Ask Monolith Phase 2 — Write Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the `/ask` full-page chat propose board writes that the user confirms in-thread, reusing the already-built-and-tested write engine and `ActionConfirmCard`.

**Architecture:** The streaming Ask loop gains the existing `WRITE_TOOLS` and **ends the turn** the moment a `propose_*` tool records a `ValidatedAction` — a propose tool returns nothing the model can continue on, and continuing invites a past-tense "I've created it" before the human gate. The proposal rides one new NDJSON event and is persisted in the **existing** `ai_messages.tool_trace` jsonb column (**no migration**). Approve/Cancel are Server Actions that re-read the actions from that row through RLS (the client sends only two ids) and **append** an outcome assistant message — `ai_messages` has no UPDATE policy, and the model's context is built from `content` only, so appending is both the only permitted and the only coherent option.

**Tech Stack:** Next.js 16 App Router (RSC + Server Actions + one streaming Route Handler), Anthropic SDK tool-use loop, Supabase (RLS is the security boundary), Zod, Tailwind v4 + shadcn primitives, Vitest + React Testing Library, Playwright for e2e.

**Spec:** `docs/superpowers/specs/2026-07-26-ask-pulse-phase2-write-actions-design.md`

---

## Before you start

- [ ] **Work in the worktree.** This plan is scoped to `.claude/worktrees/ask-pulse-phase2` on branch `task/ask-pulse-phase2`. If you are starting fresh, run `scripts/start-task.sh ask-pulse-phase2` from the main checkout first. Never build on `develop`.
- [ ] **Read the design skills before Task 5.** Tasks 5 and 6 touch UI. Load `pulse-ui` and `frontend-design` (AGENTS.md working agreement #3). Tasks 1–4 and 7 are non-visual.
- [ ] **Read the spec** — especially "The hard part" and "Persistence". The two decisions that shape every task are: the turn ends at the confirm card, and the outcome is an appended message, not an update.
- [ ] **Read the reference implementation** `src/components/ai/actions/QuickAction.tsx` and its host `src/components/command-palette.tsx`. This feature mirrors it on a different surface.
- [ ] **This task adds NO migration.** If you find yourself writing SQL, stop and re-read the spec's "Persistence" section.
- [ ] **Confirm Next.js 16 APIs against `node_modules/next/dist/docs/`** before touching route code.
- [ ] Run `pnpm test` once to confirm a green baseline before changing anything.

## File structure

**Created**

| Path                                         | Responsibility                                                                     |
| -------------------------------------------- | ---------------------------------------------------------------------------------- |
| `src/lib/ai/ask/tool-trace.ts`               | Client-safe Zod shape of `ai_messages.tool_trace` + pure proposal-state derivation |
| `src/lib/ai/ask/tool-trace.test.ts`          | Unit tests for the above                                                           |
| `src/lib/ai/ask/proposal-actions.ts`         | `applyAskProposal` / `cancelAskProposal` Server Actions                            |
| `src/lib/ai/ask/proposal-actions.test.ts`    | Unit tests for the above                                                           |
| `src/components/ai/ask/MessageList.test.tsx` | Component tests for confirm-card rendering (no test file exists today)             |
| `e2e/ask.spec.ts`                            | Deterministic, non-AI e2e cover for the `/ask` surface                             |

**Modified**

| Path                                                      | Change                                                                          |
| --------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `src/lib/ai/write/schema.ts`                              | Add `executionResultSchema`; derive `ExecutionResult` from it                   |
| `src/lib/ai/ask/stream-protocol.ts`                       | Add the `proposal` event + the shared fallback-answer constant                  |
| `src/lib/ai/ask/ask-stream.ts`                            | Carry write tools; branch and end the turn on a collected proposal              |
| `src/lib/ai/ask/ask-stream.test.ts`                       | New branch tests; pass the now-required `orgId`                                 |
| `src/app/api/ask/route.ts`                                | Write-aware system prompt (date + timezone), pass `orgId`, persist the trace    |
| `src/app/api/ask/route.test.ts`                           | Engine mock returns `proposedActions`; assert trace persistence                 |
| `src/components/ai/ask/MessageList.tsx`                   | `UIMessage.trace`; render `ActionConfirmCard` per proposed action               |
| `src/components/ai/ask/AskChat.tsx`                       | Stash the proposal, bind at `done`, wire Approve/Cancel, track the live conv id |
| `src/components/ai/ask/AskChat.test.tsx`                  | Proposal → card → approve → outcome                                             |
| `src/app/ask/[conversationId]/page.tsx`                   | Map `tool_trace` through `parseToolTrace`                                       |
| `src/lib/ai/ask/ai-conversations.rls.integration.test.ts` | Cross-user isolation for proposal + outcome rows                                |

**Deleted:** none.

## Execution DAG

Dependency edges (from the per-task `Interfaces` blocks):

- Task 1 — no dependencies
- Task 2 — no dependencies
- Task 3 — depends on Task 1
- Task 4 — depends on Task 1, Task 2
- Task 5 — depends on Task 1
- Task 6 — depends on Task 2, Task 3, Task 5
- Task 7 — depends on Task 6

**Parallel batches** (each batch is one wave of concurrent agents):

- **Batch 1 (parallel):** Task 1, Task 2
- **Batch 2 (parallel):** Task 3, Task 4, Task 5 — these touch **disjoint files** (`proposal-actions.*` vs `api/ask/route.*` vs `components/ai/ask/MessageList.*` + `app/ask/[conversationId]/page.tsx`), so they can run in one worktree without clobbering each other.
- **Batch 3:** Task 6
- **Batch 4:** Task 7

**Critical path:** Task 1 → Task 3 → Task 6 → Task 7 (four waves — the real wall-clock floor).

---

### Task 1: `executionResultSchema` + the client-safe `tool-trace` module

**Interfaces:**

- **Consumes:** `validatedActionSchema` (existing, `src/lib/ai/write/schema.ts`)
- **Produces:** `executionResultSchema`, `askToolTraceSchema`, `AskToolTrace`, `parseToolTrace`, `resolveProposalStates`, `MAX_PROPOSED_ACTIONS`

**Files:**

- Modify: `src/lib/ai/write/schema.ts` (lines 68–70 — the hand-written `ExecutionResult` type)
- Create: `src/lib/ai/ask/tool-trace.ts`
- Create: `src/lib/ai/ask/tool-trace.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/ai/ask/tool-trace.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  parseToolTrace,
  resolveProposalStates,
  type AskToolTrace,
} from "./tool-trace";

const ACTION = {
  kind: "create_item" as const,
  boardId: "b1",
  groupId: "g1",
  name: "Ship v2",
  summary: 'Create task "Ship v2" in Backlog',
  warnings: [],
};

describe("parseToolTrace", () => {
  it("parses a legacy boardsConsulted-only row", () => {
    expect(parseToolTrace({ boardsConsulted: ["b1"] })).toEqual({
      boardsConsulted: ["b1"],
    });
  });

  it("parses a proposal trace", () => {
    const t = parseToolTrace({
      boardsConsulted: [],
      proposedActions: [ACTION],
    });
    expect(t?.proposedActions).toHaveLength(1);
    expect(t?.proposedActions?.[0].summary).toBe(ACTION.summary);
  });

  it("parses an applied outcome trace", () => {
    const t = parseToolTrace({
      resolvesProposal: "11111111-1111-4111-8111-111111111111",
      outcome: "applied",
      results: [{ ok: true, itemId: "i1" }],
    });
    expect(t?.outcome).toBe("applied");
    expect(t?.results).toEqual([{ ok: true, itemId: "i1" }]);
  });

  it("returns null for null, a scalar, and a malformed action", () => {
    expect(parseToolTrace(null)).toBeNull();
    expect(parseToolTrace("nope")).toBeNull();
    expect(parseToolTrace({ proposedActions: [{ kind: "nope" }] })).toBeNull();
  });

  it("ignores unknown keys rather than failing the whole row", () => {
    expect(parseToolTrace({ boardsConsulted: [], somethingNew: 1 })).toEqual({
      boardsConsulted: [],
    });
  });
});

describe("resolveProposalStates", () => {
  const proposal = {
    id: "p1",
    trace: { proposedActions: [ACTION] } as AskToolTrace,
  };

  it("reports idle when nothing resolves the proposal", () => {
    expect(resolveProposalStates([proposal]).get("p1")).toEqual({
      state: "idle",
    });
  });

  it("reports done when a later message applied it", () => {
    const states = resolveProposalStates([
      proposal,
      {
        id: "o1",
        trace: {
          resolvesProposal: "p1",
          outcome: "applied",
          results: [{ ok: true, itemId: "i1" }],
        } as AskToolTrace,
      },
    ]);
    expect(states.get("p1")).toEqual({ state: "done", note: "Applied." });
  });

  it("reports error with the joined messages when any result failed", () => {
    const states = resolveProposalStates([
      proposal,
      {
        id: "o1",
        trace: {
          resolvesProposal: "p1",
          outcome: "applied",
          results: [{ ok: false, error: "No date column on this board." }],
        } as AskToolTrace,
      },
    ]);
    expect(states.get("p1")).toEqual({
      state: "error",
      note: "No date column on this board.",
    });
  });

  it("reports the cancelled note", () => {
    const states = resolveProposalStates([
      proposal,
      {
        id: "o1",
        trace: { resolvesProposal: "p1", outcome: "cancelled" } as AskToolTrace,
      },
    ]);
    expect(states.get("p1")).toEqual({
      state: "done",
      note: "Cancelled — nothing was changed.",
    });
  });

  it("has no entry for a message without proposals", () => {
    expect(
      resolveProposalStates([{ id: "m1", trace: { boardsConsulted: [] } }])
        .size,
    ).toBe(0);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm vitest run src/lib/ai/ask/tool-trace.test.ts`
Expected: FAIL — `Failed to resolve import "./tool-trace"`.

- [ ] **Step 3: Add `executionResultSchema` to the canonical write schema**

In `src/lib/ai/write/schema.ts`, replace the hand-written type:

```ts
export type ExecutionResult =
  | { ok: true; itemId?: string }
  | { ok: false; error: string };
```

with the Zod schema plus an inferred type (identical shape — one home, no drift):

```ts
/** Result of running ONE approved action. A Zod schema (not just a type)
 *  because it is persisted into `ai_messages.tool_trace` and read back from
 *  untyped jsonb. */
export const executionResultSchema = z.union([
  z.object({ ok: z.literal(true), itemId: z.string().optional() }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export type ExecutionResult = z.infer<typeof executionResultSchema>;
```

- [ ] **Step 4: Implement the trace module**

Create `src/lib/ai/ask/tool-trace.ts`:

```ts
// Client-safe (NO server-only): imported by the /ask page, MessageList, the
// stream protocol's consumers, and the proposal Server Actions. Shapes the
// `ai_messages.tool_trace` jsonb column, which is untyped at the DB level — so
// everything read out of it goes through Zod before it is trusted.
import { z } from "zod";
import {
  validatedActionSchema,
  executionResultSchema,
} from "@/lib/ai/write/schema";

/** Hard cap on proposals stored (and later executed) for one turn. Mirrors the
 *  `.max(10)` in `executeActions` so the two surfaces cannot diverge. */
export const MAX_PROPOSED_ACTIONS = 10;

/**
 * Two shapes share one column:
 *   proposal turn → { boardsConsulted, proposedActions }
 *   outcome turn  → { resolvesProposal, outcome, results }
 * Unknown keys are stripped rather than rejected, so today's
 * `{ boardsConsulted }` rows keep parsing and a future key never bricks a
 * thread's render.
 */
export const askToolTraceSchema = z.object({
  boardsConsulted: z.array(z.string()).optional(),
  proposedActions: z
    .array(validatedActionSchema)
    .max(MAX_PROPOSED_ACTIONS)
    .optional(),
  resolvesProposal: z.string().uuid().optional(),
  outcome: z.enum(["applied", "cancelled"]).optional(),
  results: z.array(executionResultSchema).optional(),
});
export type AskToolTrace = z.infer<typeof askToolTraceSchema>;

/** Parse one `tool_trace` value. Anything malformed degrades to `null` — a bad
 *  row must not take the whole conversation down with it. */
export function parseToolTrace(value: unknown): AskToolTrace | null {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return null;
  const parsed = askToolTraceSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Subset of ActionConfirmCard's ConfirmState that a persisted proposal can be
 *  in. "running" is transient client state, so it is not derivable from rows. */
export type ProposalState = "idle" | "done" | "error";
export type ProposalStatus = { state: ProposalState; note?: string };

/** Minimal shape this derivation needs — `UIMessage` satisfies it. */
export type TracedMessage = { id: string; trace?: AskToolTrace | null };

/**
 * Walk a thread once and decide, for each message carrying `proposedActions`,
 * whether it still awaits the user.
 *
 * A proposal is resolved by a LATER message whose trace names it in
 * `resolvesProposal` — never by mutating the proposal row, because
 * `ai_messages` has no UPDATE policy (RLS default-deny) and because the model's
 * context is built from `content` only, so the outcome has to be a real turn.
 * Deriving instead of storing also makes reload and live-update render
 * identically.
 */
export function resolveProposalStates(
  messages: TracedMessage[],
): Map<string, ProposalStatus> {
  const resolved = new Map<string, ProposalStatus>();
  for (const m of messages) {
    const t = m.trace;
    if (!t?.resolvesProposal) continue;
    if (t.outcome === "cancelled") {
      resolved.set(t.resolvesProposal, {
        state: "done",
        note: "Cancelled — nothing was changed.",
      });
      continue;
    }
    const errors = (t.results ?? []).flatMap((r) => (r.ok ? [] : [r.error]));
    resolved.set(
      t.resolvesProposal,
      errors.length
        ? { state: "error", note: errors.join("; ") }
        : { state: "done", note: "Applied." },
    );
  }

  const out = new Map<string, ProposalStatus>();
  for (const m of messages) {
    if (!m.trace?.proposedActions?.length) continue;
    out.set(m.id, resolved.get(m.id) ?? { state: "idle" });
  }
  return out;
}
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `pnpm vitest run src/lib/ai/ask/tool-trace.test.ts src/lib/ai/write/schema.test.ts`
Expected: PASS — 11 new tests plus the existing `schema.test.ts` suite still green.

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: no errors. (`ExecutionResult` is structurally identical to the type it replaced, so `execute.ts`, `actions.ts` and `QuickAction.tsx` are unaffected.)

- [ ] **Step 7: Commit**

```bash
git add src/lib/ai/write/schema.ts src/lib/ai/ask/tool-trace.ts src/lib/ai/ask/tool-trace.test.ts
git commit -m "feat(ask): client-safe tool_trace schema + proposal-state derivation"
```

---

### Task 2: Stream protocol `proposal` event + the `ask-stream` branch

**Interfaces:**

- **Consumes:** `ValidatedAction` (existing), `WRITE_TOOLS` / `LIST_MEMBERS_TOOL` / `createWriteToolExecutor` (existing)
- **Produces:** `AskStreamEvent` variant `{ type: "proposal"; actions }`, `PROPOSAL_FALLBACK_ANSWER`, `askPulseStream` returning `proposedActions` and requiring `orgId`

**Files:**

- Modify: `src/lib/ai/ask/stream-protocol.ts`
- Modify: `src/lib/ai/ask/ask-stream.ts` (whole file replaced)
- Modify: `src/lib/ai/ask/ask-stream.test.ts` (whole file replaced)

- [ ] **Step 1: Extend the protocol**

Replace the whole of `src/lib/ai/ask/stream-protocol.ts` with:

```ts
// Client-safe (no server-only). NDJSON events over the /api/ask response body.
// Imported by both the server (route + engine) and the client stream hook, so it
// must never pull in server-only modules. `ValidatedAction` is safe to name
// here: `@/lib/ai/write/schema` is plain Zod and is already imported by the
// "use client" ActionConfirmCard.
//
// There is deliberately NO execution-result event. This body is ONE model turn,
// opened by POST /api/ask and closed when the turn ends; Approve happens after
// that stream is gone — possibly after a reload, in a different session. Nothing
// could ever emit such an event. Execution is a Server Action
// (`applyAskProposal`) returning `ActionResult`, which is also where AGENTS.md
// puts every mutation.
import type { ValidatedAction } from "@/lib/ai/write/schema";

/** Persisted + rendered when a proposal turn produced no lead-in text of its
 *  own. Shared so the engine, the DB row and the optimistic client bubble all
 *  say the same thing. */
export const PROPOSAL_FALLBACK_ANSWER = "Here's what I'll do — confirm below.";

export type AskStreamEvent =
  | { type: "token"; text: string }
  | { type: "status"; text: string }
  /** The turn ended at a confirm card. Emitted before persistence so the client
   *  can stash the actions; it binds them to the real message id at `done`. */
  | { type: "proposal"; actions: ValidatedAction[] }
  | {
      type: "done";
      conversationId: string;
      assistantMessageId: string;
      boardsConsulted: string[];
      title?: string;
    }
  | { type: "error"; message: string };

/** Serialize one event as an NDJSON line (JSON + newline delimiter). */
export function encodeEvent(e: AskStreamEvent): string {
  return JSON.stringify(e) + "\n";
}
```

- [ ] **Step 2: Write the failing tests**

Replace the whole of `src/lib/ai/ask/ask-stream.test.ts` with:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { AskStreamEvent } from "./stream-protocol";

// The real tool modules hit Supabase. Mock both so the loop's CONTROL FLOW is
// what's under test, not the tools themselves (they have their own suites).
const mockExecuteAskTool = vi.fn();
const mockWriterExecute = vi.fn();
let collected: unknown[] = [];

vi.mock("@/lib/ai/ask/tools", () => ({
  ASK_TOOLS: [{ name: "list_boards" }, { name: "get_board_overview" }],
  executeAskTool: (...a: unknown[]) => mockExecuteAskTool(...a),
}));
vi.mock("@/lib/ai/write/write-tools", () => ({
  WRITE_TOOLS: [{ name: "propose_create_item" }],
  LIST_MEMBERS_TOOL: { name: "list_board_members" },
  createWriteToolExecutor: () => ({
    execute: (...a: unknown[]) => mockWriterExecute(...a),
    collected: () => collected,
  }),
}));

import { askPulseStream } from "./ask-stream";

type Round = {
  text?: string;
  stop_reason: "tool_use" | "end_turn";
  content: unknown[];
};

/** Scripted Anthropic double: one entry per `.stream()` call. */
function fakeClient(rounds: Round[]) {
  let i = 0;
  return {
    messages: {
      stream: vi.fn(() => {
        const round = rounds[i++];
        const handlers: Record<string, (arg: string) => void> = {};
        const p = {
          on: (evt: string, cb: (arg: string) => void) => {
            handlers[evt] = cb;
            return p;
          },
          finalMessage: async () => {
            if (round.text) handlers["text"]?.(round.text);
            return {
              stop_reason: round.stop_reason,
              content: round.content,
              usage: { input_tokens: 5, output_tokens: 2 },
            };
          },
        };
        return p;
      }),
      create: vi.fn(async () => ({
        content: [{ type: "text", text: "capped" }],
        usage: { input_tokens: 1, output_tokens: 1 },
      })),
    },
  };
}

const ACTION = {
  kind: "create_item",
  boardId: "b1",
  groupId: "g1",
  name: "Ship v2",
  summary: 'Create task "Ship v2" in Backlog',
  warnings: [],
};

const run = (
  client: unknown,
  emit: (e: AskStreamEvent) => void,
  messages = [{ role: "user" as const, content: "hi" }],
) =>
  askPulseStream({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- scripted structural double
    client: client as any,
    apiKey: "k",
    orgId: "org1",
    workspaceId: "ws1",
    messages,
    system: "SYS",
    emit,
  });

beforeEach(() => {
  vi.clearAllMocks();
  collected = [];
});

describe("askPulseStream", () => {
  it("streams text deltas and returns the final answer + usage (read-only path)", async () => {
    const tokens: string[] = [];
    const client = fakeClient([
      {
        text: "Hello",
        stop_reason: "end_turn",
        content: [{ type: "text", text: "Hello" }],
      },
    ]);
    const res = await run(client, (e) => {
      if (e.type === "token") tokens.push(e.text);
    });
    expect(tokens.join("")).toBe("Hello");
    expect(res.answer).toBe("Hello");
    expect(res.usage).toEqual({ inputTokens: 5, outputTokens: 2 });
    expect(res.boardsConsulted).toEqual([]);
    expect(res.proposedActions).toEqual([]);
  });

  it("ENDS the turn when a propose tool records an action", async () => {
    // The writer collects on execute — that growth is the branch condition.
    mockWriterExecute.mockImplementation(async () => {
      collected = [ACTION];
      return { content: JSON.stringify({ preview: ACTION.summary }) };
    });
    const client = fakeClient([
      {
        text: "I'll create that — ",
        stop_reason: "tool_use",
        content: [
          { type: "text", text: "I'll create that — " },
          {
            type: "tool_use",
            id: "t1",
            name: "propose_create_item",
            input: {},
          },
        ],
      },
    ]);
    const events: AskStreamEvent[] = [];
    const res = await run(client, (e) => events.push(e));

    expect(client.messages.stream).toHaveBeenCalledTimes(1);
    expect(client.messages.create).not.toHaveBeenCalled();
    expect(res.proposedActions).toEqual([ACTION]);
    expect(res.answer).toBe("I'll create that — ");
    expect(events).toContainEqual({ type: "proposal", actions: [ACTION] });
  });

  it("falls back to shared copy when a proposal turn streamed no text", async () => {
    mockWriterExecute.mockImplementation(async () => {
      collected = [ACTION];
      return { content: "{}" };
    });
    const client = fakeClient([
      {
        stop_reason: "tool_use",
        content: [
          {
            type: "tool_use",
            id: "t1",
            name: "propose_create_item",
            input: {},
          },
        ],
      },
    ]);
    const res = await run(client, () => {});
    expect(res.answer).toBe("Here's what I'll do — confirm below.");
  });

  it("does NOT end the turn when the propose tool errored — it feeds back and continues", async () => {
    // collected never grows: createWriteToolExecutor records nothing on error.
    mockWriterExecute.mockResolvedValue({
      content: JSON.stringify({ error: "board not found" }),
    });
    const client = fakeClient([
      {
        stop_reason: "tool_use",
        content: [
          {
            type: "tool_use",
            id: "t1",
            name: "propose_create_item",
            input: {},
          },
        ],
      },
      {
        text: "Which board did you mean?",
        stop_reason: "end_turn",
        content: [{ type: "text", text: "Which board did you mean?" }],
      },
    ]);
    const events: AskStreamEvent[] = [];
    const res = await run(client, (e) => events.push(e));

    expect(client.messages.stream).toHaveBeenCalledTimes(2);
    expect(res.proposedActions).toEqual([]);
    expect(res.answer).toBe("Which board did you mean?");
    expect(events.some((e) => e.type === "proposal")).toBe(false);
  });

  it("still runs read tools and tracks boardsConsulted", async () => {
    mockExecuteAskTool.mockResolvedValue({ content: "[]", boardId: "b1" });
    const client = fakeClient([
      {
        stop_reason: "tool_use",
        content: [
          { type: "tool_use", id: "t1", name: "get_board_overview", input: {} },
        ],
      },
      {
        text: "Two overdue.",
        stop_reason: "end_turn",
        content: [{ type: "text", text: "Two overdue." }],
      },
    ]);
    const res = await run(client, () => {});
    expect(mockExecuteAskTool).toHaveBeenCalled();
    expect(res.boardsConsulted).toEqual(["b1"]);
  });
});
```

- [ ] **Step 3: Run them and confirm they fail**

Run: `pnpm vitest run src/lib/ai/ask/ask-stream.test.ts`
Expected: FAIL — `orgId` is not a known property and `res.proposedActions` is undefined.

- [ ] **Step 4: Implement the branch**

Replace the whole of `src/lib/ai/ask/ask-stream.ts` with:

```ts
import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { MODEL } from "@/lib/ai/providers/anthropic";
import { ASK_TOOLS, executeAskTool } from "@/lib/ai/ask/tools";
import {
  WRITE_TOOLS,
  LIST_MEMBERS_TOOL,
  createWriteToolExecutor,
} from "@/lib/ai/write/write-tools";
import type { ValidatedAction } from "@/lib/ai/write/schema";
import type { AiUsageTokens } from "@/lib/ai/pricing";
import {
  PROPOSAL_FALLBACK_ANSWER,
  type AskStreamEvent,
} from "./stream-protocol";

/** Hard cap on tool-use rounds. Bounds worst-case token spend + latency; when
 *  hit, the loop forces one final no-tools answer from what it has gathered. */
const MAX_ROUNDS = 6;

/** Read tools execute for real and feed content back to the model; everything
 *  else (list_board_members + the propose_* tools) goes through the
 *  propose-only writer, which NEVER mutates. */
const READ_TOOL_NAMES = new Set(ASK_TOOLS.map((t) => t.name));

/** Concatenate the text blocks of a model response, dropping tool_use/other blocks. */
function textOf(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

/**
 * Streaming twin of `askPulseLoop`: drives the Ask Pulse Anthropic tool-use loop
 * with a prebuilt `messages` array + `system`, and STREAMS the final answer's
 * text deltas via `emit`. Tool rounds run buffered between streams; the terminal
 * answer streams token-by-token. Usage is summed across every round so the
 * caller meters the full turn. RLS-scoped tool execution throughout.
 *
 * Phase 2: the loop also carries the propose-only WRITE_TOOLS. Unlike a read
 * tool, a propose_* tool RECORDS a ValidatedAction and returns nothing the model
 * needs in order to continue — so the turn ENDS at the confirm card. Anthropic
 * emits text blocks BEFORE the tool_use block in the same message, so the
 * user still gets a streamed lead-in sentence for free, and we never give the
 * model a turn in which it could claim (past tense) to have done the write.
 *
 * `askPulseLoop` in ./ask.ts stays READ-ONLY — only this streaming twin writes.
 */
export async function askPulseStream(args: {
  apiKey: string;
  orgId: string;
  workspaceId: string;
  messages: Anthropic.MessageParam[];
  system: string;
  emit: (e: AskStreamEvent) => void;
  client?: Anthropic; // DI for tests
}): Promise<{
  answer: string;
  boardsConsulted: string[];
  proposedActions: ValidatedAction[];
  usage: AiUsageTokens;
}> {
  const client = args.client ?? new Anthropic({ apiKey: args.apiKey });
  const writer = createWriteToolExecutor({
    orgId: args.orgId,
    workspaceId: args.workspaceId,
  });
  const tools = [...ASK_TOOLS, LIST_MEMBERS_TOOL, ...WRITE_TOOLS];
  const messages = [...args.messages];
  const usage: AiUsageTokens = { inputTokens: 0, outputTokens: 0 };
  const boards = new Set<string>();

  for (let round = 0; round < MAX_ROUNDS; round++) {
    let streamedText = "";
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 4096,
      system: args.system,
      tools,
      messages,
    });
    stream.on("text", (t) => {
      streamedText += t;
      args.emit({ type: "token", text: t });
    });
    const final = await stream.finalMessage();
    usage.inputTokens += final.usage.input_tokens;
    usage.outputTokens += final.usage.output_tokens;

    if (final.stop_reason !== "tool_use") {
      const answer = streamedText || textOf(final.content);
      return {
        answer,
        boardsConsulted: [...boards],
        proposedActions: [],
        usage,
      };
    }

    messages.push({ role: "assistant", content: final.content });
    const collectedBefore = writer.collected().length;
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    let consulted = 0;
    for (const block of final.content) {
      if (block.type !== "tool_use") continue;
      if (READ_TOOL_NAMES.has(block.name)) {
        const r = await executeAskTool(block.name, block.input, {
          workspaceId: args.workspaceId,
        });
        if (r.boardId) {
          boards.add(r.boardId);
          consulted++;
        }
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: r.content,
        });
        continue;
      }
      const r = await writer.execute(block.name, block.input);
      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: r.content,
      });
    }

    // The branch: a proposal was RECORDED, so the turn is over — the only thing
    // that can happen next is a human decision. Keyed off the collected count
    // growing, not off the tool name: a propose_* call that FAILED (bad id,
    // unknown group) collects nothing, and its {"error": …} result falls through
    // to the normal feed-back below so the model can self-correct.
    const proposed = writer.collected() as ValidatedAction[];
    if (proposed.length > collectedBefore) {
      args.emit({ type: "proposal", actions: proposed });
      return {
        answer: streamedText || PROPOSAL_FALLBACK_ANSWER,
        boardsConsulted: [...boards],
        proposedActions: proposed,
        usage,
      };
    }

    // Guard: model signalled tool_use but emitted no tool_use blocks — bail to
    // the final-answer fallback rather than push an empty user turn.
    if (toolResults.length === 0) break;
    args.emit({
      type: "status",
      text: consulted
        ? `Consulting ${boards.size} board${boards.size === 1 ? "" : "s"}…`
        : "Thinking…",
    });
    messages.push({ role: "user", content: toolResults });
  }

  // Cap reached (or an empty tool turn): one final buffered answer.
  const capped = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: args.system,
    messages: [
      ...messages,
      { role: "user", content: "Answer now with what you have." },
    ],
  });
  usage.inputTokens += capped.usage.input_tokens;
  usage.outputTokens += capped.usage.output_tokens;
  const answer = textOf(capped.content);
  args.emit({ type: "token", text: answer });
  return { answer, boardsConsulted: [...boards], proposedActions: [], usage };
}
```

> Note the deliberate omission: the capped fallback calls `messages.create` **without `tools`**, exactly as before, so the forced final answer can never smuggle in a write.

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `pnpm vitest run src/lib/ai/ask/ask-stream.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ai/ask/stream-protocol.ts src/lib/ai/ask/ask-stream.ts src/lib/ai/ask/ask-stream.test.ts
git commit -m "feat(ask): carry write tools in the streaming loop; end the turn at a proposal"
```

---

### Task 3: `applyAskProposal` / `cancelAskProposal` Server Actions

**Depends on:** Task 1

**Interfaces:**

- **Consumes:** `parseToolTrace`, `AskToolTrace` (Task 1 — `parseToolTrace` already enforces the `MAX_PROPOSED_ACTIONS` cap, so this module does not re-check it); `executeAction` (existing); `getAiEntitlement` (existing); `fail` / `ActionResult` (existing canonical module)
- **Produces:** `applyAskProposal`, `cancelAskProposal`, `ProposalOutcome`

**Files:**

- Create: `src/lib/ai/ask/proposal-actions.ts`
- Create: `src/lib/ai/ask/proposal-actions.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/ai/ask/proposal-actions.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";

const mockMaybeSingle = vi.fn();
const mockPriorLimit = vi.fn();
const mockInsertSingle = vi.fn();
const mockInsert = vi.fn(() => ({
  select: () => ({ single: mockInsertSingle }),
}));
const mockExecuteAction = vi.fn();
const mockGetAiEntitlement = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  requireUser: vi.fn(async () => ({ id: "u1" })),
}));
vi.mock("@/lib/org/active", () => ({
  resolveActiveOrg: vi.fn(async () => ({ id: "org1" })),
}));
vi.mock("@/lib/ai/entitlement", () => ({
  getAiEntitlement: (...a: unknown[]) => mockGetAiEntitlement(...a),
}));
vi.mock("@/lib/ai/write/execute", () => ({
  executeAction: (...a: unknown[]) => mockExecuteAction(...a),
}));
// select→eq→eq→(maybeSingle | limit) covers BOTH reads: the proposal row and
// the idempotency probe.
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: mockMaybeSingle, limit: mockPriorLimit }),
        }),
      }),
      insert: mockInsert,
    }),
  }),
}));

import { applyAskProposal, cancelAskProposal } from "./proposal-actions";

const CONV = "11111111-1111-4111-8111-111111111111";
const MSG = "22222222-2222-4222-8222-222222222222";
const ACTION = {
  kind: "create_item",
  boardId: "b1",
  groupId: "g1",
  name: "Ship v2",
  summary: 'Create task "Ship v2" in Backlog',
  warnings: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAiEntitlement.mockResolvedValue({ mode: "managed" });
  mockMaybeSingle.mockResolvedValue({
    data: { tool_trace: { proposedActions: [ACTION] } },
    error: null,
  });
  mockPriorLimit.mockResolvedValue({ data: [], error: null });
  mockInsertSingle.mockResolvedValue({ data: { id: "o1" }, error: null });
  mockExecuteAction.mockResolvedValue({ ok: true, itemId: "i1" });
});

describe("applyAskProposal", () => {
  it("rejects non-uuid ids before touching the database", async () => {
    const res = await applyAskProposal({ conversationId: "x", messageId: MSG });
    expect(res.ok).toBe(false);
    expect(mockMaybeSingle).not.toHaveBeenCalled();
  });

  it("refuses when the org has AI turned off", async () => {
    mockGetAiEntitlement.mockResolvedValue({ mode: "off" });
    const res = await applyAskProposal({
      conversationId: CONV,
      messageId: MSG,
    });
    expect(res.ok).toBe(false);
    expect(mockExecuteAction).not.toHaveBeenCalled();
  });

  it("fails when RLS returns no row (a foreign or missing message)", async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    const res = await applyAskProposal({
      conversationId: CONV,
      messageId: MSG,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/not found/i);
    expect(mockExecuteAction).not.toHaveBeenCalled();
  });

  it("fails when the trace carries no proposals", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { tool_trace: { boardsConsulted: [] } },
      error: null,
    });
    const res = await applyAskProposal({
      conversationId: CONV,
      messageId: MSG,
    });
    expect(res.ok).toBe(false);
    expect(mockExecuteAction).not.toHaveBeenCalled();
  });

  it("refuses a second apply (two tabs / double click)", async () => {
    mockPriorLimit.mockResolvedValue({ data: [{ id: "o0" }], error: null });
    const res = await applyAskProposal({
      conversationId: CONV,
      messageId: MSG,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/already resolved/i);
    expect(mockExecuteAction).not.toHaveBeenCalled();
  });

  it("executes the action read FROM THE DATABASE and appends an outcome turn", async () => {
    const res = await applyAskProposal({
      conversationId: CONV,
      messageId: MSG,
    });
    expect(mockExecuteAction).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "create_item", name: "Ship v2" }),
    );
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation_id: CONV,
        role: "assistant",
        tool_trace: expect.objectContaining({
          resolvesProposal: MSG,
          outcome: "applied",
          results: [{ ok: true, itemId: "i1" }],
        }),
      }),
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.messageId).toBe("o1");
      expect(res.data.content).toContain("Ship v2");
    }
  });

  it("records a failed execution instead of claiming success", async () => {
    mockExecuteAction.mockResolvedValue({
      ok: false,
      error: "No date column.",
    });
    const res = await applyAskProposal({
      conversationId: CONV,
      messageId: MSG,
    });
    expect(res.ok).toBe(true); // the attempt was recorded
    if (res.ok) expect(res.data.content).toContain("No date column.");
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        tool_trace: expect.objectContaining({
          results: [{ ok: false, error: "No date column." }],
        }),
      }),
    );
  });
});

describe("cancelAskProposal", () => {
  it("appends a cancelled outcome and never executes", async () => {
    const res = await cancelAskProposal({
      conversationId: CONV,
      messageId: MSG,
    });
    expect(mockExecuteAction).not.toHaveBeenCalled();
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "Cancelled — nothing was changed.",
        tool_trace: expect.objectContaining({
          resolvesProposal: MSG,
          outcome: "cancelled",
        }),
      }),
    );
    expect(res.ok).toBe(true);
  });

  it("works even when AI is turned off (nothing is spent and nothing is written)", async () => {
    mockGetAiEntitlement.mockResolvedValue({ mode: "off" });
    const res = await cancelAskProposal({
      conversationId: CONV,
      messageId: MSG,
    });
    expect(res.ok).toBe(true);
  });

  it("refuses to cancel a proposal that was already resolved", async () => {
    mockPriorLimit.mockResolvedValue({ data: [{ id: "o0" }], error: null });
    const res = await cancelAskProposal({
      conversationId: CONV,
      messageId: MSG,
    });
    expect(res.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `pnpm vitest run src/lib/ai/ask/proposal-actions.test.ts`
Expected: FAIL — `Failed to resolve import "./proposal-actions"`.

- [ ] **Step 3: Implement the Server Actions**

Create `src/lib/ai/ask/proposal-actions.ts`:

```ts
"use server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { resolveActiveOrg } from "@/lib/org/active";
import { createClient } from "@/lib/supabase/server";
import { getAiEntitlement } from "@/lib/ai/entitlement";
import { executeAction } from "@/lib/ai/write/execute";
import type { ValidatedAction, ExecutionResult } from "@/lib/ai/write/schema";
import { parseToolTrace, type AskToolTrace } from "./tool-trace";
// Canonical shared result type — never re-declare locally (AGENTS.md invariant).
import { fail, type ActionResult } from "@/lib/actions/result";
import type { Json } from "@/types/database.types";

const idsSchema = z.object({
  conversationId: z.string().uuid(),
  messageId: z.string().uuid(),
});

/** The appended outcome turn, handed straight back so the client can push it
 *  into the transcript without a refetch (0 RSC navigations). */
export type ProposalOutcome = {
  messageId: string;
  content: string;
  trace: AskToolTrace;
};

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

type Loaded =
  | { ok: true; actions: ValidatedAction[] }
  | { ok: false; error: string };

/**
 * Read a proposal turn back through RLS and refuse anything already resolved.
 *
 * The CLIENT NEVER SENDS THE ACTIONS — it sends two ids, and the payload is
 * re-read from a row the caller could only reach via their own RLS scope. That
 * is strictly stronger than round-tripping a ValidatedAction[] through the
 * browser. `parseToolTrace` is the re-validation: the column is untyped jsonb,
 * so every action goes back through `validatedActionSchema` (and its ≤10 cap)
 * before we will run it.
 */
async function loadProposal(
  supabase: SupabaseClient,
  conversationId: string,
  messageId: string,
): Promise<Loaded> {
  const row = await supabase
    .from("ai_messages")
    .select("tool_trace")
    .eq("id", messageId)
    .eq("conversation_id", conversationId)
    .maybeSingle();
  if (row.error || !row.data)
    return { ok: false, error: "Proposal not found." };

  const actions = parseToolTrace(row.data.tool_trace)?.proposedActions ?? [];
  if (actions.length === 0)
    return { ok: false, error: "That turn has nothing to apply." };

  // Idempotency: two tabs, or a double click, must not double-write. Scoped by
  // the indexed conversation_id over a thread already capped at 200 rows.
  const prior = await supabase
    .from("ai_messages")
    .select("id")
    .eq("conversation_id", conversationId)
    .eq("tool_trace->>resolvesProposal", messageId)
    .limit(1);
  if (prior.data?.length)
    return { ok: false, error: "This proposal was already resolved." };

  return { ok: true, actions };
}

/**
 * Append the outcome as a real assistant turn rather than updating the proposal
 * row. Two independent reasons: `ai_messages` has no UPDATE policy (RLS
 * default-deny, and this is user-owned content so the service client is the
 * wrong tool), and `buildAskMessages` feeds the model `content` only — an
 * outcome hidden in jsonb would leave the model believing nothing happened.
 */
async function insertOutcome(
  supabase: SupabaseClient,
  conversationId: string,
  content: string,
  trace: AskToolTrace,
): Promise<ActionResult<ProposalOutcome>> {
  const ins = await supabase
    .from("ai_messages")
    .insert({
      conversation_id: conversationId,
      role: "assistant",
      content,
      // The generated column type is the opaque `Json`; the shape is guaranteed
      // by askToolTraceSchema, so this cast is a serialization detail, not a
      // loosening of types.
      tool_trace: trace as unknown as Json,
    })
    .select("id")
    .single();
  if (ins.error || !ins.data) return fail("Couldn't record the result.");
  return { ok: true, data: { messageId: ins.data.id, content, trace } };
}

/** Deterministic outcome copy — no extra model call, no extra tokens. */
function outcomeContent(
  actions: ValidatedAction[],
  results: ExecutionResult[],
): string {
  return actions
    .map((a, i) => {
      const r = results[i];
      if (!r) return `Failed — ${a.summary}: no result.`;
      return r.ok
        ? `Done — ${a.summary}.`
        : `Failed — ${a.summary}: ${r.error}`;
    })
    .join("\n");
}

/**
 * Apply a proposal the user approved in the /ask thread.
 *
 * No `runAi` and no new charge: executing an approved proposal is deterministic
 * DB work, not a model call (mirrors `executeActions`). We only re-check that
 * the org can still use AI, so a stale proposal can't be applied after an admin
 * turns AI off. RLS is the guard on every underlying write.
 */
export async function applyAskProposal(input: {
  conversationId: string;
  messageId: string;
}): Promise<ActionResult<ProposalOutcome>> {
  const parsed = idsSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid proposal.");
  const { conversationId, messageId } = parsed.data;

  try {
    await requireUser();
    const org = await resolveActiveOrg();
    if (!org) return fail("No organization.");
    const ent = await getAiEntitlement(org.id);
    if (ent.mode === "off")
      return fail("AI is turned off for your organization.");

    const supabase = await createClient();
    const loaded = await loadProposal(supabase, conversationId, messageId);
    if (!loaded.ok) return fail(loaded.error);

    const results: ExecutionResult[] = [];
    for (const action of loaded.actions)
      results.push(await executeAction(action));

    return await insertOutcome(
      supabase,
      conversationId,
      outcomeContent(loaded.actions, results),
      { resolvesProposal: messageId, outcome: "applied", results },
    );
  } catch {
    return fail("Couldn't apply that action. Please try again.");
  }
}

/**
 * Decline a proposal. Persisted (not just dismissed client-side) for two
 * reasons: the card must not come back pending after a reload, and the model
 * has to learn the user declined instead of re-proposing the same thing.
 * No entitlement check — nothing is spent and nothing is written.
 */
export async function cancelAskProposal(input: {
  conversationId: string;
  messageId: string;
}): Promise<ActionResult<ProposalOutcome>> {
  const parsed = idsSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid proposal.");
  const { conversationId, messageId } = parsed.data;

  try {
    await requireUser();
    const supabase = await createClient();
    const loaded = await loadProposal(supabase, conversationId, messageId);
    if (!loaded.ok) return fail(loaded.error);

    return await insertOutcome(
      supabase,
      conversationId,
      "Cancelled — nothing was changed.",
      { resolvesProposal: messageId, outcome: "cancelled" },
    );
  } catch {
    return fail("Couldn't cancel that. Please try again.");
  }
}
```

> Before running: confirm `Json` is exported from `src/types/database.types.ts` (it is, at line 1). If a regeneration ever removes it, use
> `Database["public"]["Tables"]["ai_messages"]["Insert"]["tool_trace"]` instead.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `pnpm vitest run src/lib/ai/ask/proposal-actions.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ai/ask/proposal-actions.ts src/lib/ai/ask/proposal-actions.test.ts
git commit -m "feat(ask): approve/cancel proposal server actions (re-read from RLS, append outcome)"
```

---

### Task 4: Route wiring — write-aware system prompt and trace persistence

**Depends on:** Task 1, Task 2

**Interfaces:**

- **Consumes:** `askPulseStream` with `orgId` + `proposedActions` (Task 2); `AskToolTrace` (Task 1); `getUserTimeZoneCached` (existing)
- **Produces:** an `/api/ask` turn that persists `proposedActions` into `ai_messages.tool_trace`

**Files:**

- Modify: `src/app/api/ask/route.ts`
- Modify: `src/app/api/ask/route.test.ts`

- [ ] **Step 1: Grep before writing a date helper (AGENTS.md invariant)**

Run: `grep -rn "toLocaleDateString\|Intl.DateTimeFormat" src/lib src/app --include="*.ts" --include="*.tsx"`
If an existing "today in this timezone" helper turns up, **use it** and skip the local `todayIn` in Step 3. If nothing turns up, write the local helper exactly as shown.

- [ ] **Step 2: Write the failing tests**

In `src/app/api/ask/route.test.ts`, update the engine mock so it returns the new field, and add a proposal case. Replace the existing `vi.mock("@/lib/ai/ask/ask-stream", …)` block with:

```ts
const askPulseStreamMock = vi.fn(
  async ({ emit }: { emit: (e: { type: string; text: string }) => void }) => {
    emit({ type: "token", text: "Hi" });
    return {
      answer: "Hi",
      boardsConsulted: [],
      proposedActions: [],
      usage: { inputTokens: 1, outputTokens: 1 },
    };
  },
);
vi.mock("@/lib/ai/ask/ask-stream", () => ({
  askPulseStream: (a: unknown) =>
    askPulseStreamMock(
      a as { emit: (e: { type: string; text: string }) => void },
    ),
}));
vi.mock("@/lib/profile/queries-cached", () => ({
  getUserTimeZoneCached: vi.fn(async () => "Europe/Berlin"),
}));
```

Then capture the insert payload — replace the supabase mock's `insert` line so the arguments are observable:

```ts
const insertSpy = vi.fn(() => ({ select: () => ({ single }) }));
```

and use `insert: insertSpy,` inside the mocked `from()`. Add these tests to the `describe`:

```ts
it("persists boardsConsulted with no proposals on a read-only turn", async () => {
  await POST(makeReq());
  expect(insertSpy).toHaveBeenCalledWith(
    expect.objectContaining({
      role: "assistant",
      tool_trace: { boardsConsulted: [] },
    }),
  );
});

it("persists proposedActions into tool_trace on a proposal turn", async () => {
  const action = {
    kind: "create_item",
    boardId: "b1",
    groupId: "g1",
    name: "Ship v2",
    summary: 'Create task "Ship v2" in Backlog',
    warnings: [],
  };
  askPulseStreamMock.mockImplementationOnce(async ({ emit }) => {
    emit({ type: "token", text: "I'll create that — " });
    return {
      answer: "I'll create that — ",
      boardsConsulted: ["b1"],
      proposedActions: [action],
      usage: { inputTokens: 1, outputTokens: 1 },
    };
  });
  await POST(makeReq());
  expect(insertSpy).toHaveBeenCalledWith(
    expect.objectContaining({
      tool_trace: { boardsConsulted: ["b1"], proposedActions: [action] },
    }),
  );
});
```

- [ ] **Step 3: Run them and confirm they fail**

Run: `pnpm vitest run src/app/api/ask/route.test.ts`
Expected: FAIL — `insertSpy` is not called with `proposedActions` (the route drops the field).

- [ ] **Step 4: Make the system prompt write-aware**

In `src/app/api/ask/route.ts`, replace the `const SYSTEM = [...]` block with:

```ts
/** Today's calendar date in a given IANA zone, so "Friday" resolves correctly
 *  for a write. Falls back to UTC if the stored zone is unusable. */
function todayIn(timezone: string): string {
  try {
    return new Date().toLocaleDateString("en-CA", { timeZone: timezone });
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

/**
 * One prompt for one loop: the read guidance that grounds every answer, plus
 * the write guidance already proven in `src/lib/ai/write/propose.ts`. The
 * propose_* tools do not write — the "stop after proposing" instruction matches
 * the engine, which ends the turn at the confirm card either way.
 */
function buildSystem(today: string, timezone: string): string {
  return [
    "You are the AI assistant for Monolith, a helpful analyst answering questions about the user's boards — and, when asked, proposing changes to them.",
    "Use the read tools to ground every claim in real data. Never fabricate.",
    "Start broad (list_boards, get_board_overview) and query_items only for the rows a question needs.",
    "Cell values reference option/user ids — decode labels via get_board_overview before answering.",
    "If you cannot answer from the data, say so plainly.",
    "",
    `Today is ${today} (timezone ${timezone}). Resolve relative dates like "Friday" to an ISO date (YYYY-MM-DD).`,
    "When the user asks you to CHANGE something, first resolve the exact board, group, status option and owner userIds with the read tools (list_boards, get_board_overview, list_board_members). NEVER assume an id you have not read.",
    "Then call a propose_* tool with the resolved ids. The propose_* tools do NOT write — the user confirms first. Say in ONE short sentence what you are about to propose, then stop.",
    "If the target board, group or item is ambiguous, DO NOT propose — ask exactly ONE focused question and wait for the answer.",
  ].join("\n");
}
```

- [ ] **Step 5: Wire the timezone, `orgId`, and the trace**

Add the import near the other lib imports:

```ts
import { getUserTimeZoneCached } from "@/lib/profile/queries-cached";
import type { AskToolTrace } from "@/lib/ai/ask/tool-trace";
import type { Json } from "@/types/database.types";
```

Immediately after the `workspaceId` guard (`if (!workspaceId) return …`), add:

```ts
const timezone = (await getUserTimeZoneCached(user.id)) ?? "UTC";
const system = buildSystem(todayIn(timezone), timezone);
```

In the `askPulseStream({ … })` call, add `orgId: org.id,` and change
`system: composeSystem(SYSTEM, summary),` to `system: composeSystem(system, summary),`.

In the object returned from the `runAi` callback, add `proposedActions: r.proposedActions,` alongside `answer` and `boardsConsulted`.

Finally, replace the assistant insert with:

```ts
const trace: AskToolTrace = { boardsConsulted: result.boardsConsulted };
if (result.proposedActions.length)
  trace.proposedActions = result.proposedActions;

const ins = await supabase
  .from("ai_messages")
  .insert({
    conversation_id: conversationId,
    role: "assistant",
    content: result.answer,
    tool_trace: trace as unknown as Json,
  })
  .select("id")
  .single();
```

> The `proposal` event itself needs no route code — `askPulseStream` emits it through the same `emit` closure that already carries tokens and status.

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `pnpm vitest run src/app/api/ask/route.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/ask/route.ts src/app/api/ask/route.test.ts
git commit -m "feat(ask): write-aware system prompt + persist proposals into tool_trace"
```

---

### Task 5: Render the confirm card in the transcript

**Depends on:** Task 1

**Interfaces:**

- **Consumes:** `AskToolTrace`, `parseToolTrace`, `resolveProposalStates` (Task 1); `ActionConfirmCard` (existing)
- **Produces:** `UIMessage.trace`; `MessageList` props `onApprove` / `onCancel` / `busyMessageId`

**Files:**

- Modify: `src/components/ai/ask/MessageList.tsx`
- Create: `src/components/ai/ask/MessageList.test.tsx`
- Modify: `src/app/ask/[conversationId]/page.tsx`

- [ ] **Step 1: Load the design skills**

Load `pulse-ui` and `frontend-design` before touching any JSX (AGENTS.md #3). The card itself is already designed — the only new styling is its placement in the thread (indented to the assistant gutter, hairline gap).

- [ ] **Step 2: Write the failing tests**

Create `src/components/ai/ask/MessageList.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { MessageList, type UIMessage } from "./MessageList";

const ACTION = {
  kind: "create_item" as const,
  boardId: "b1",
  groupId: "g1",
  name: "Ship v2",
  summary: 'Create task "Ship v2" in Backlog',
  warnings: ['Board has 2 date columns — used "Due".'],
};

const base = { streamingText: null, status: null };

function renderList(messages: UIMessage[], overrides = {}) {
  const onApprove = vi.fn();
  const onCancel = vi.fn();
  render(
    <MessageList
      {...base}
      messages={messages}
      onApprove={onApprove}
      onCancel={onCancel}
      {...overrides}
    />,
  );
  return { onApprove, onCancel };
}

describe("MessageList proposals", () => {
  it("renders no card for a plain assistant turn", () => {
    renderList([{ id: "a1", role: "assistant", content: "Two overdue." }]);
    expect(screen.queryByRole("group", { name: "Proposed action" })).toBeNull();
  });

  it("renders a confirm card with the summary and warning", () => {
    renderList([
      {
        id: "p1",
        role: "assistant",
        content: "I'll create that —",
        trace: { proposedActions: [ACTION] },
      },
    ]);
    expect(screen.getByText(ACTION.summary)).toBeInTheDocument();
    expect(screen.getByText(ACTION.warnings[0])).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /approve/i }),
    ).toBeInTheDocument();
  });

  it("calls onApprove / onCancel with the proposal message id", () => {
    const { onApprove, onCancel } = renderList([
      {
        id: "p1",
        role: "assistant",
        content: "I'll create that —",
        trace: { proposedActions: [ACTION] },
      },
    ]);
    fireEvent.click(screen.getByRole("button", { name: /approve/i }));
    expect(onApprove).toHaveBeenCalledWith("p1");
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledWith("p1");
  });

  it("hides the buttons and shows the note once a later turn resolved it", () => {
    renderList([
      {
        id: "p1",
        role: "assistant",
        content: "I'll create that —",
        trace: { proposedActions: [ACTION] },
      },
      {
        id: "o1",
        role: "assistant",
        content: 'Done — Create task "Ship v2" in Backlog.',
        trace: {
          resolvesProposal: "p1",
          outcome: "applied",
          results: [{ ok: true, itemId: "i1" }],
        },
      },
    ]);
    expect(screen.queryByRole("button", { name: /approve/i })).toBeNull();
    expect(screen.getByText("Applied.")).toBeInTheDocument();
  });

  it("shows the running label while that proposal is busy", () => {
    renderList(
      [
        {
          id: "p1",
          role: "assistant",
          content: "I'll create that —",
          trace: { proposedActions: [ACTION] },
        },
      ],
      { busyMessageId: "p1" },
    );
    expect(screen.getByRole("button", { name: /applying/i })).toBeDisabled();
  });
});
```

- [ ] **Step 3: Run them and confirm they fail**

Run: `pnpm vitest run src/components/ai/ask/MessageList.test.tsx`
Expected: FAIL — `onApprove` is not a known prop and no card renders.

- [ ] **Step 4: Extend `MessageList`**

In `src/components/ai/ask/MessageList.tsx`, add the imports:

```tsx
import { ActionConfirmCard } from "@/components/ai/actions/ActionConfirmCard";
import {
  resolveProposalStates,
  type AskToolTrace,
} from "@/lib/ai/ask/tool-trace";
```

Extend the exported type:

```tsx
export type UIMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Parsed `ai_messages.tool_trace`. Carries a turn's proposed actions, or —
   *  on an outcome turn — which proposal it resolved. */
  trace?: AskToolTrace | null;
};
```

Extend the component signature:

```tsx
export function MessageList({
  messages,
  streamingText,
  status,
  onApprove,
  onCancel,
  busyMessageId,
}: {
  messages: UIMessage[];
  streamingText: string | null;
  status: string | null;
  onApprove: (messageId: string) => void;
  onCancel: (messageId: string) => void;
  busyMessageId?: string | null;
}) {
```

Inside the component, above the `return`, derive the states once:

```tsx
// Pure derivation over the thread — a proposal is resolved by a LATER message
// naming it, so reload and live-update render identically.
const proposalStates = resolveProposalStates(messages);
```

Replace the `{messages.map(...)}` block with:

```tsx
{
  messages.map((m) => {
    const actions = m.trace?.proposedActions ?? [];
    // NOT named `status` — that is the streaming status-line prop.
    const proposalStatus = proposalStates.get(m.id);
    return (
      <div key={m.id} className="flex flex-col gap-3">
        <Bubble role={m.role} content={m.content} />
        {actions.length > 0 && proposalStatus ? (
          <div className="flex flex-col gap-2 pl-10">
            {actions.map((action, i) => (
              <ActionConfirmCard
                key={i}
                action={action}
                state={
                  busyMessageId === m.id ? "running" : proposalStatus.state
                }
                resultNote={proposalStatus.note}
                onApprove={() => onApprove(m.id)}
                onCancel={() => onCancel(m.id)}
              />
            ))}
          </div>
        ) : null}
      </div>
    );
  });
}
```

> Approve/Cancel are **per-turn, not per-card** — every card in a turn is wired to the same handler and one Approve applies all of that turn's actions. This mirrors `QuickAction.tsx` exactly (it maps the same array onto one `approve()`), and in practice the model proposes one action.

- [ ] **Step 5: Map the persisted trace on the server page**

In `src/app/ask/[conversationId]/page.tsx`, add the import:

```tsx
import { parseToolTrace } from "@/lib/ai/ask/tool-trace";
```

and add one line to the `initialMessages` mapper, after `content: r.content,`:

```tsx
        // An unconfirmed proposal survives a reload: it lives in tool_trace,
        // not client state, and Approve re-reads it server-side.
        trace: parseToolTrace(r.tool_trace),
```

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `pnpm vitest run src/components/ai/ask/MessageList.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 7: Commit**

```bash
git add src/components/ai/ask/MessageList.tsx src/components/ai/ask/MessageList.test.tsx "src/app/ask/[conversationId]/page.tsx"
git commit -m "feat(ask): render the confirm card in the transcript"
```

---

### Task 6: Wire Approve / Cancel in `AskChat`

**Depends on:** Task 2, Task 3, Task 5

**Interfaces:**

- **Consumes:** `PROPOSAL_FALLBACK_ANSWER` + the `proposal` event (Task 2); `applyAskProposal` / `cancelAskProposal` (Task 3); `MessageList`'s new props (Task 5)
- **Produces:** the complete propose → confirm → outcome loop on `/ask`

**Files:**

- Modify: `src/components/ai/ask/AskChat.tsx`
- Modify: `src/components/ai/ask/AskChat.test.tsx`

- [ ] **Step 1: Write the failing test**

In `src/components/ai/ask/AskChat.test.tsx`, add the Server Action mock next to the existing mocks (before the `import { AskChat }` line):

```tsx
const applyAskProposal = vi.fn(async () => ({
  ok: true as const,
  data: {
    messageId: "o1",
    content: 'Done — Create task "Ship v2" in Backlog.',
    trace: {
      resolvesProposal: "a1",
      outcome: "applied" as const,
      results: [{ ok: true as const, itemId: "i1" }],
    },
  },
}));
const cancelAskProposal = vi.fn();
vi.mock("@/lib/ai/ask/proposal-actions", () => ({
  applyAskProposal: (i: unknown) => applyAskProposal(i as never),
  cancelAskProposal: (i: unknown) => cancelAskProposal(i as never),
}));
```

Change the `./use-ask-stream` mock so the scripted events can vary per test — replace that whole `vi.mock` block with:

```tsx
const send = vi.fn();
vi.mock("./use-ask-stream", () => ({
  useAskStream: () => ({ streaming: false, send }),
}));
```

and add a `beforeEach` restoring the default read-only script:

```tsx
import { beforeEach } from "vitest";

const ACTION = {
  kind: "create_item" as const,
  boardId: "b1",
  groupId: "g1",
  name: "Ship v2",
  summary: 'Create task "Ship v2" in Backlog',
  warnings: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  send.mockImplementation(
    async (_id: string, onEvent: (e: Record<string, unknown>) => void) => {
      onEvent({ type: "token", text: "Answer" });
      onEvent({
        type: "done",
        conversationId: "c1",
        assistantMessageId: "a1",
        boardsConsulted: [],
      });
    },
  );
});
```

Then add the new test:

```tsx
it("binds a proposal to the persisted message id and applies it on approve", async () => {
  send.mockImplementation(
    async (_id: string, onEvent: (e: Record<string, unknown>) => void) => {
      onEvent({ type: "token", text: "I'll create that — " });
      onEvent({ type: "proposal", actions: [ACTION] });
      onEvent({
        type: "done",
        conversationId: "c1",
        assistantMessageId: "a1",
        boardsConsulted: ["b1"],
      });
    },
  );
  render(<AskChat conversationId={null} initialMessages={[]} />);

  fireEvent.change(screen.getByLabelText("Your question"), {
    target: { value: "create Ship v2 in Backlog" },
  });
  fireEvent.keyDown(screen.getByLabelText("Your question"), {
    key: "Enter",
    metaKey: true,
  });

  // The card renders once the turn is persisted.
  await waitFor(() =>
    expect(screen.getByText(ACTION.summary)).toBeInTheDocument(),
  );

  fireEvent.click(screen.getByRole("button", { name: /approve/i }));

  // The conversation id created mid-turn is used, not the null prop.
  await waitFor(() =>
    expect(applyAskProposal).toHaveBeenCalledWith({
      conversationId: "c1",
      messageId: "a1",
    }),
  );
  // The outcome turn lands in the transcript and resolves the card.
  await waitFor(() =>
    expect(
      screen.getByText('Done — Create task "Ship v2" in Backlog.'),
    ).toBeInTheDocument(),
  );
  expect(screen.queryByRole("button", { name: /approve/i })).toBeNull();
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm vitest run src/components/ai/ask/AskChat.test.tsx`
Expected: FAIL — no confirm card renders (the `proposal` event is ignored).

- [ ] **Step 3: Implement the wiring**

Replace the whole of `src/components/ai/ask/AskChat.tsx` with:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  appendUserMessage,
  createConversation,
} from "@/lib/ai/ask/conversation-actions";
import {
  applyAskProposal,
  cancelAskProposal,
} from "@/lib/ai/ask/proposal-actions";
import { PROPOSAL_FALLBACK_ANSWER } from "@/lib/ai/ask/stream-protocol";
import type { ValidatedAction } from "@/lib/ai/write/schema";
import { useAskStream } from "./use-ask-stream";
import { MessageList, type UIMessage } from "./MessageList";
import { Composer } from "./Composer";

/**
 * Client controller for a single chat surface.
 *
 * Data-fetching budget (working agreement #5): sending in an existing thread and
 * streaming tokens are 0-RSC-navigation — token deltas append to client state
 * only. Starting a NEW chat rewrites the URL via `history.pushState` (no RSC
 * re-run). Send / rename / delete are Server Actions; switching to another
 * thread (from the rail) is a legitimate RSC load of *different* data. After a
 * completed turn we `router.refresh()` once so the rail picks up a new
 * auto-title.
 *
 * Phase 2: a turn can end at a confirm card. The `proposal` event arrives before
 * the message is persisted, so its actions are stashed and bound to the real
 * `assistantMessageId` at `done`. Approve/Cancel are Server Actions that take
 * only ids — the actions themselves are re-read server-side from the message
 * row through RLS — and their outcome turn is appended to client state, so
 * confirming costs exactly ONE round-trip and zero RSC navigations.
 */
export function AskChat({
  conversationId,
  initialMessages,
}: {
  conversationId: string | null;
  initialMessages: UIMessage[];
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<UIMessage[]>(initialMessages);
  const [streamText, setStreamText] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  // The live conversation id. The prop is null on /ask until the first send
  // mints one — without tracking it here, Approve on a first-turn proposal
  // would have no conversation to address.
  const [activeId, setActiveId] = useState<string | null>(conversationId);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const { streaming, send } = useAskStream();

  async function onSubmit(text: string) {
    let convId = activeId;
    setMessages((m) => [
      ...m,
      { id: `tmp-${Date.now()}`, role: "user", content: text },
    ]);

    if (!convId) {
      const res = await createConversation({ firstMessage: text });
      if (!res.ok) {
        setStatus(res.error);
        return;
      }
      convId = res.data.conversationId;
      setActiveId(convId);
      // Client nav — no RSC refetch (working agreement #5).
      window.history.pushState(null, "", `/ask/${convId}`);
    } else {
      const res = await appendUserMessage({
        conversationId: convId,
        content: text,
      });
      if (!res.ok) {
        setStatus(res.error);
        return;
      }
    }

    // Accumulate streamed tokens and any proposal in closure locals so the
    // `done` handler sees both regardless of React's render batching.
    let acc = "";
    let proposed: ValidatedAction[] = [];
    setStreamText("");
    setStatus(null);
    await send(convId, (e) => {
      if (e.type === "token") {
        acc += e.text;
        setStreamText(acc);
      } else if (e.type === "status") {
        setStatus(e.text);
      } else if (e.type === "proposal") {
        proposed = e.actions;
      } else if (e.type === "error") {
        setStatus(e.message);
        setStreamText(null);
      } else if (e.type === "done") {
        setMessages((m) => [
          ...m,
          {
            id: e.assistantMessageId || `a-${Date.now()}`,
            role: "assistant",
            content: acc || (proposed.length ? PROPOSAL_FALLBACK_ANSWER : ""),
            trace: proposed.length
              ? {
                  boardsConsulted: e.boardsConsulted,
                  proposedActions: proposed,
                }
              : null,
          },
        ]);
        setStreamText(null);
        setStatus(null);
        router.refresh(); // refresh rail (titles) once, after completion
      }
    });
  }

  /** Approve or decline a proposal. Both append the server's outcome turn,
   *  which is what flips the card out of `idle` (see resolveProposalStates). */
  function resolve(messageId: string, approve: boolean) {
    if (!activeId || busyId) return;
    setBusyId(messageId);
    setStatus(null);
    startTransition(async () => {
      const action = approve ? applyAskProposal : cancelAskProposal;
      const res = await action({ conversationId: activeId, messageId });
      setBusyId(null);
      if (!res.ok) {
        setStatus(res.error);
        return;
      }
      setMessages((m) => [
        ...m,
        {
          id: res.data.messageId,
          role: "assistant",
          content: res.data.content,
          trace: res.data.trace,
        },
      ]);
    });
  }

  return (
    <div className="flex h-full flex-col">
      <MessageList
        messages={messages}
        streamingText={streamText}
        status={status}
        busyMessageId={busyId}
        onApprove={(id) => resolve(id, true)}
        onCancel={(id) => resolve(id, false)}
      />
      <Composer disabled={streaming} onSubmit={onSubmit} />
    </div>
  );
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `pnpm vitest run src/components/ai/ask/`
Expected: PASS — the original AskChat test plus the new proposal test, plus the MessageList suite.

- [ ] **Step 5: Run the full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/components/ai/ask/AskChat.tsx src/components/ai/ask/AskChat.test.tsx
git commit -m "feat(ask): approve/cancel a proposal in the chat thread"
```

---

### Task 7: RLS integration cover + a deterministic `/ask` e2e

**Depends on:** Task 6

**Interfaces:**

- **Consumes:** the whole feature
- **Produces:** cross-user isolation evidence for proposal/outcome rows; the first `e2e/ask*.spec.ts`

**Files:**

- Modify: `src/lib/ai/ask/ai-conversations.rls.integration.test.ts`
- Create: `e2e/ask.spec.ts`

- [ ] **Step 1: Read the existing integration suite**

Read `src/lib/ai/ask/ai-conversations.rls.integration.test.ts` in full. It already provisions two users and skips the whole file without `PULSE_TEST_DB`. Reuse its helpers and its describe-level skip verbatim — do **not** invent a second harness.

- [ ] **Step 2: Add the two isolation cases**

Append to the existing describe block (adapting the helper names to whatever that file already uses for "user A's client" / "user B's client" / "a conversation owned by A"):

```ts
it("hides a proposal trace from a non-owner", async () => {
  const conversationId = await createConversationFor(userA);
  await clientA.from("ai_messages").insert({
    conversation_id: conversationId,
    role: "assistant",
    content: "I'll create that —",
    tool_trace: {
      proposedActions: [
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

  const { data } = await clientB
    .from("ai_messages")
    .select("id, tool_trace")
    .eq("conversation_id", conversationId);
  expect(data ?? []).toHaveLength(0);
});

it("refuses an outcome message written into someone else's thread", async () => {
  const conversationId = await createConversationFor(userA);
  const { error } = await clientB.from("ai_messages").insert({
    conversation_id: conversationId,
    role: "assistant",
    content: "Cancelled — nothing was changed.",
    tool_trace: { resolvesProposal: conversationId, outcome: "cancelled" },
  });
  expect(error).not.toBeNull();
});
```

- [ ] **Step 3: Run the integration suite**

Run: `PULSE_TEST_DB=1 pnpm vitest run --project integration src/lib/ai/ask/ai-conversations.rls.integration.test.ts`
Expected: PASS. Without `PULSE_TEST_DB` the file skips — confirm that too with `pnpm vitest run src/lib/ai/ask/ai-conversations.rls.integration.test.ts` (expect: skipped, not failed).

- [ ] **Step 4: Create the e2e spec**

Create `e2e/ask.spec.ts`. **Copy the entire auth scaffold verbatim from `e2e/command-palette.spec.ts`** — the dotenv preamble, the `SUPABASE_URL` / `ANON_KEY` / `SERVICE_ROLE_KEY` reads, the graceful `describe.skip` when secrets are absent, the `beforeAll` that creates a confirmed user via the service-role admin API, and the UI login + onboarding walk. Do not re-derive it; the two files must stay identical in that half so a change to the harness is a one-line diff in both.

Then use this body:

```ts
test("the /ask surface loads and starts a conversation", async ({ page }) => {
  await page.goto("/ask");

  // Layout B: the conversation rail replaces the Monolith nav.
  await expect(
    page.getByRole("link", { name: /back to monolith/i }),
  ).toBeVisible();

  const composer = page.getByLabel("Your question");
  await expect(composer).toBeVisible();

  // Empty state before anything is asked.
  await expect(
    page.getByText(/answers are grounded in your real data/i),
  ).toBeVisible();

  await composer.fill("what is overdue?");
  await composer.press("Meta+Enter");

  // createConversation mints the row and the History API rewrites the URL with
  // no RSC navigation. The user's own turn is echoed immediately.
  await expect(page).toHaveURL(/\/ask\/[0-9a-f-]{36}$/);
  await expect(page.getByText("what is overdue?")).toBeVisible();
});
```

> **Deliberate limit:** this spec stops at the user turn. Driving the model round-trip would need a live Anthropic key plus credits and a non-deterministic answer — a flake and cost generator, not a test. The confirm → approve → outcome half is covered deterministically by `MessageList.test.tsx` and `AskChat.test.tsx` with mocked Server Actions. This is stated in the spec as a conscious limit.

- [ ] **Step 5: Run the e2e spec**

Run: `pnpm e2e e2e/ask.spec.ts`
Expected: PASS (or a graceful skip if `SUPABASE_SERVICE_ROLE_KEY` is absent — the same behaviour as `command-palette.spec.ts`).

- [ ] **Step 6: Run the full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all four green. Also run `pnpm db:ledger-check` — this task adds **no migration**, so it must report no drift.

- [ ] **Step 7: Commit**

```bash
git add src/lib/ai/ask/ai-conversations.rls.integration.test.ts e2e/ask.spec.ts
git commit -m "test(ask): RLS isolation for proposal traces + /ask e2e surface cover"
```

---

## Closing the task

- [ ] **Finish the branch.** From inside the worktree run `scripts/finish-task.sh`. It rebases onto the latest `develop`, re-runs all four gates against the merged state, merges, pushes, and removes the worktree + branch. Do not hand-rebase; if it stops on a real conflict, resolve `git rebase develop` and re-run.
- [ ] **Do not run any migration tooling.** There is no migration in this task.
- [ ] **Hand the user the walkthrough below** in the closing message, and repeat it in the `/wrapup` session note under "How to test".

### How to test this (hand to the user verbatim)

1. Pull the latest `develop` and run the app against DEV: `git pull && pnpm dev`.
2. Make sure your org has AI enabled with an Anthropic key (Settings → AI). Write actions need Anthropic — an OpenAI-only key returns "needs an Anthropic key".
3. Open **http://localhost:3000/ask**.
4. First ask a plain question, e.g. _"what's overdue?"_ — confirm the read-only behaviour is unchanged: tokens stream in, the rail picks up an auto-title.
5. Now type a command: **_"create a task called Ship v2 in the Backlog group on <one of your boards>, due Friday"_**. Expected: a short lead-in sentence streams in ("I'll create that —"), then a **Proposed action** card appears with a plain-English summary and Approve / Cancel. **Nothing has been written yet.**
6. Try an ambiguous command in a new chat, e.g. _"create a task"_ with no board named. Expected: **no card** — the assistant asks exactly one follow-up question instead. Answer it and confirm the card then appears.
7. Before clicking anything, **reload the page**. Expected: the card is still there, still pending, with Approve/Cancel live.
8. Click **Approve**. Expected: the button reads "Applying…", then the card locks with "Applied." and a new turn appears: _Done — Create task "Ship v2" in Backlog._
9. Open that board in another tab. Expected: the item is there, with the owner/date/status you asked for. (An open board updates live via Realtime.)
10. Ask a follow-up in the same chat: _"did you create it?"_ Expected: the assistant knows it did — the outcome turn is part of the conversation.
11. Start another proposal and click **Cancel** instead. Expected: the card locks with "Cancelled — nothing was changed.", a matching turn appears, and **nothing** changed on the board. Reload — it stays cancelled.
12. Edge case worth a look: open the same conversation in two tabs with one pending proposal, and click Approve in both. Expected: the first applies; the second reports _"This proposal was already resolved."_ — no duplicate item.
