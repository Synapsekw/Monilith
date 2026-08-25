import { describe, it, expect, vi, beforeEach } from "vitest";
import type { LanguageModel } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { fakeResolvedModel } from "@/test/adapter-fakes";
import { signBody } from "@/lib/ai/agentic/hmac";
import {
  AiDisabledError,
  AiNotConfiguredError,
  PersonalAiKeyMissingError,
  ByoKeyMissingError,
} from "@/lib/ai/errors";
import { AGENT_CAPABILITIES } from "@/lib/agents/capabilities";

const SECRET = "test-secret";
const ORG = "00000000-0000-4000-8000-0000000000f1";
const OWNER = "00000000-0000-4000-8000-0000000000f2";

const getUserAgentById = vi.fn();
const findUserAgentRun = vi.fn();

vi.mock("@/lib/env.server", () => ({
  getServerEnv: () => ({
    AI_PGNET_HMAC_SECRET: SECRET,
    RESEND_API_KEY: null,
    DIGEST_SECRET: "d",
    APP_BASE_URL: "https://app.example.com",
    DIGEST_FROM_EMAIL: null,
  }),
}));

vi.mock("@/lib/agents/agents-db", () => ({
  getUserAgentById: (...a: unknown[]) => getUserAgentById(...a),
  findUserAgentRun: (...a: unknown[]) => findUserAgentRun(...a),
}));

// ── user_agent_runs mock ────────────────────────────────────────────────
// `claimRun`/`finalizeRun` in route.ts talk to `user_agent_runs` directly
// (insert for the claim, update for the finalize) rather than through
// agents-db.ts, so they need real insert/update semantics here — including a
// simulated 23505 unique-violation on the claim insert (Finding 1) and a
// simulated ordinary write failure on the finalize update (Finding 2).
type RunPatch = Record<string, unknown>;
const runInserts: RunPatch[] = [];
const runUpdates: { patch: RunPatch; key: RunPatch }[] = [];
let forceClaimConflict = false;
let forceFinalizeError = false;

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    from(table: string) {
      if (table !== "user_agent_runs") return {};
      return {
        // claimRun (route.ts) chains `.insert(row).select("id").single()` to
        // get the claimed row's id back — mirror that shape here rather than
        // the old bare `await insert(row)`. On a simulated 23505 the insert
        // is never actually written, so runInserts stays untouched, matching
        // the "no-op via the claim backstop" test's `toHaveLength(0)`.
        insert: (row: RunPatch) => {
          if (!forceClaimConflict) runInserts.push(row);
          return {
            select: () => ({
              single: async () =>
                forceClaimConflict
                  ? {
                      data: null,
                      error: {
                        code: "23505",
                        message:
                          'duplicate key value violates unique constraint "user_agent_runs_slot_uniq"',
                      },
                    }
                  : { data: { id: "run-1" }, error: null },
            }),
          };
        },
        update(patch: RunPatch) {
          const key: RunPatch = {};
          // Thenable chain: each .eq() records a key column and returns the
          // same builder; awaiting the builder at any point (mirrors real
          // supabase-js query builders) resolves and records the update.
          const builder = {
            eq(col: string, val: unknown) {
              key[col] = val;
              return builder;
            },
            then(onFulfilled: (v: { error: unknown }) => unknown) {
              runUpdates.push({ patch, key: { ...key } });
              const result = forceFinalizeError
                ? { error: { message: "db blip" } }
                : { error: null };
              return Promise.resolve(result).then(onFulfilled);
            },
          };
          return builder;
        },
      };
    },
  }),
}));

const requireAiEntitlement = vi.fn(async () => {});
vi.mock("@/lib/ai/entitlement", () => ({
  requireAiEntitlement: (...a: unknown[]) => requireAiEntitlement(...(a as [])),
}));

// ── org settings ────────────────────────────────────────────────────────
// The route reads `agentCapabilityCeiling` at RUN time — an admin lowering the
// ceiling clamps every existing agent without editing any of them, so the
// value has to come from here rather than from the agent row.
let ceiling: string[] = [...AGENT_CAPABILITIES];
const readOrgAiSettings = vi.fn(async () => ({
  agentCapabilityCeiling: ceiling,
}));
vi.mock("@/lib/ai/org-settings", () => ({
  readOrgAiSettings: (...a: unknown[]) => readOrgAiSettings(...(a as [])),
}));

// Real AgentCapExceededError export is preserved (route.ts does `instanceof`
// on it); only the DB-hitting function is replaced.
const assertRunAllowedToday = vi.fn(async () => {});
vi.mock("@/lib/agents/caps", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/agents/caps")>();
  return {
    ...actual,
    assertRunAllowedToday: (...a: unknown[]) =>
      assertRunAllowedToday(...(a as [])),
  };
});

// ── owner-client mock ───────────────────────────────────────────────────
// `writeBriefingThread` writes through the OWNER client, so this double has to
// be chainable: `.insert(row).select("id").single()` for the conversation and a
// bare awaited `.insert(row)` for the message. Returning `{}` here — as this
// file used to — made every route test hit `owner.from is not a function`,
// which writeBriefingThread's own outer catch swallowed into a null threadId.
// The thread-write seam was therefore never exercised by the route, and nothing
// could assert that `sendBriefingEmail` receives the id.
type OwnerRow = Record<string, unknown>;
const ownerConversationInsert = vi.fn();
const ownerMessageInsert = vi.fn();
let forceThreadInsertError: { code?: string; message: string } | null = null;

// `listDocumentsForAgent` (documents-db.ts) is deliberately NOT mocked, same
// reasoning as run-loop.ts above: the route drives the REAL query shape, with
// only the underlying client swapped. `docRows` mirrors what
// `user_agent_documents!inner(agent_documents(...))` returns — a plain array
// by default (no documents attached), overridable per test.
type DocRow = {
  agent_documents: {
    id: string;
    title: string;
    body: string;
    token_estimate: number;
  };
};
let docRows: DocRow[] = [];

/** A thenable Supabase-query-builder stand-in: every chained method returns
 *  itself, and awaiting it anywhere in the chain resolves to `result` — the
 *  shape `listDocumentsForAgent`'s `.select().eq().order().order()` chain
 *  needs, without re-implementing Supabase's real builder. */
function chainable(result: { data: unknown; error: unknown }) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    then: (onFulfilled: (v: typeof result) => unknown) =>
      Promise.resolve(result).then(onFulfilled),
  };
  return builder;
}

function ownerClientDouble() {
  return {
    // `create_item` runs `rpc("create_item")`; the tool wrapper first resolves
    // its `groupId` to a board for the scope guard. Both are stubbed so a
    // GRANTED write genuinely EXECUTES here — the positive control that proves
    // the gate is a gate and not a blanket refusal.
    rpc: async () => ({ data: { id: "item-1" }, error: null }),
    from(table: string) {
      if (table === "user_agent_documents") {
        return chainable({ data: docRows, error: null });
      }
      if (table === "groups") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { board_id: "44444444-4444-4444-8444-444444444444" },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "ai_conversations") {
        return {
          insert: (row: OwnerRow) => {
            ownerConversationInsert(row);
            return {
              select: () => ({
                single: async () =>
                  forceThreadInsertError
                    ? { data: null, error: forceThreadInsertError }
                    : { data: { id: "conv-1" }, error: null },
              }),
            };
          },
        };
      }
      return {
        insert: async (row: OwnerRow) => {
          ownerMessageInsert(row);
          return { error: null };
        },
      };
    },
  };
}

const getAgentOwnerClient = vi.fn(async () => ownerClientDouble() as never);
vi.mock("@/lib/agents/owner-client", () => ({
  getAgentOwnerClient: (...a: unknown[]) => getAgentOwnerClient(...(a as [])),
}));

// ── proposals ───────────────────────────────────────────────────────────
// `insertProposals` is the only DB write on the refusal path; the rows it is
// handed are what the approval UI later reads, so they are captured rather
// than executed.
const insertProposals = vi.fn(async () => {});
let proposalRows: Record<string, unknown>[] = [];
vi.mock("@/lib/agents/proposals-db", () => ({
  insertProposals: (_svc: unknown, rows: Record<string, unknown>[]) => {
    proposalRows = rows;
    return insertProposals();
  },
}));

const sendBriefingEmail = vi.fn(async () => ({ emailed: true }));
vi.mock("@/lib/agents/send", () => ({
  sendBriefingEmail: (...a: unknown[]) => sendBriefingEmail(...(a as [])),
}));

// ── the model ───────────────────────────────────────────────────────────
// `run-loop.ts` is deliberately NOT mocked. The route drives the REAL
// `buildAgentRuntime` + `runAgentLoop` + `generateText`, with only the
// LanguageModel swapped — so these tests exercise the assembled tool set and
// the installed grant gate, not a stand-in for them. That is the only way the
// "a run built without `toolApproval` would be ungated" gap can be closed from
// outside the gate's own module.
const languageModelFor = vi.fn();
let nextModel: () => LanguageModel = () => textOnlyModel("You did the thing.");
vi.mock("@/lib/ai/providers/language-model", () => ({
  languageModelFor: (a: unknown) => {
    languageModelFor(a);
    return nextModel();
  },
}));

const USAGE = {
  inputTokens: { total: 5, noCache: 5, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 2, text: 2, reasoning: undefined },
};

function textOnlyModel(text: string): LanguageModel {
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: "text", text }],
      finishReason: { unified: "stop", raw: undefined },
      usage: USAGE,
      warnings: [],
    }),
  });
}

/** Step 1 calls `create_item`; step 2 reports. The write is the interesting
 *  half — whether it runs is entirely the grant gate's decision. */
function writeThenReportModel(): LanguageModel {
  let step = 0;
  return new MockLanguageModelV4({
    doGenerate: async () => {
      step++;
      if (step === 1) {
        return {
          content: [
            {
              type: "tool-call",
              toolCallId: "call-1",
              toolName: "create_item",
              input: JSON.stringify({ groupId: GROUP, name: "Draft" }),
            },
          ],
          finishReason: { unified: "tool-calls", raw: undefined },
          usage: USAGE,
          warnings: [],
        };
      }
      return {
        content: [{ type: "text", text: "You have 1 overdue item." }],
        finishReason: { unified: "stop", raw: undefined },
        usage: USAGE,
        warnings: [],
      };
    },
  });
}

/** Step 1 calls `create_item`; step 2 dies. The interesting half is what
 *  survives the throw — the proposal (or the executed write) from step 1. */
function writeThenThrowModel(): LanguageModel {
  let step = 0;
  return new MockLanguageModelV4({
    doGenerate: async () => {
      step++;
      // A plain Error is not `isRetryable`, so the SDK rejects immediately
      // rather than backing off — see retryWithExponentialBackoff.
      if (step > 1) throw new Error("provider 503");
      return {
        content: [
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "create_item",
            input: JSON.stringify({ groupId: GROUP, name: "Draft" }),
          },
        ],
        finishReason: { unified: "tool-calls", raw: undefined },
        usage: USAGE,
        warnings: [],
      };
    },
  });
}

// runAi just runs the callback by default with an Anthropic adapter (metering
// is exercised in the gateway's own test). A vi.fn so individual tests can
// override it — e.g. to simulate the per_user "no key on file" path throwing
// AiNotConfiguredError, or a model whose catalog row is not tool-capable.
type FakeResolved = {
  adapter: { kind: string };
  provider: string;
  apiKey: string;
  baseUrl: string | null;
  model: ReturnType<typeof fakeResolvedModel>;
};
const resolvedDefaults = (): FakeResolved => ({
  adapter: { kind: "anthropic" },
  provider: "anthropic",
  apiKey: "k",
  baseUrl: null,
  model: fakeResolvedModel(),
});
/**
 * What the route reported it had spent, through `runAi`'s `reportUsage`. The
 * gateway meters this on the error path; here it stands in for "the run row and
 * the ledger both know what a run that died mid-loop cost".
 */
let reportedUsage: { inputTokens: number; outputTokens: number } | null = null;
type ReportUsage = (u: {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}) => void;
const captureUsage: ReportUsage = (u) => {
  reportedUsage = u;
};
const runAi = vi.fn(
  async (
    _args: unknown,
    fn: (r: FakeResolved, report: ReportUsage) => Promise<{ result: unknown }>,
  ) => (await fn(resolvedDefaults(), captureUsage)).result,
);
vi.mock("@/lib/ai/gateway", () => ({
  runAi: (...a: Parameters<typeof runAi>) => runAi(...a),
}));

const { POST } = await import("./route");

function post(body: object, sig?: string) {
  const raw = JSON.stringify(body);
  return new Request("https://x/api/ai/personal-agent", {
    method: "POST",
    body: raw,
    headers: { "x-pulse-signature": sig ?? signBody(raw, SECRET) },
  });
}

/** Drive the real callback route.ts hands runAi, with one field overridden. */
function resolveWith(over: Partial<FakeResolved>) {
  runAi.mockImplementation(
    async (
      _args: unknown,
      fn: (
        r: FakeResolved,
        report: ReportUsage,
      ) => Promise<{ result: unknown }>,
    ) => (await fn({ ...resolvedDefaults(), ...over }, captureUsage)).result,
  );
}

const AGENT_ID = "00000000-0000-4000-8000-0000000000aa";
// A REAL uuid: `create_item`'s inputSchema is `groupId: z.string().uuid()`, and
// the AI SDK validates tool input BEFORE consulting the approval gate — an
// invalid id would be swallowed as a tool-input error and never reach it.
const GROUP = "33333333-3333-4333-8333-333333333333";
const slot = {
  agent_id: AGENT_ID,
  fire_date: "2026-08-01",
  fire_hour: 7,
};

const enabledAgent = () => ({
  id: AGENT_ID,
  org_id: ORG,
  owner_id: OWNER,
  name: "Morning Brief",
  template_id: "morning-brief",
  instructions: "Be concise.",
  board_scope: { mode: "all" as const },
  cadence: "daily" as const,
  run_at_local_hour: 7,
  enabled: true,
  bridge_secret_id: null,
  // Empty is the DEFAULT and the backfill value of every existing agent: the
  // relaxation is opt-in, and an agent nobody has edited stays read-only.
  capabilities: [] as string[],
  // The per-agent model pin. Null on both = "use the org default", which is
  // every backfilled agent — the pinned case is exercised explicitly below.
  provider: null,
  model_id: null,
});

beforeEach(() => {
  getUserAgentById.mockReset();
  findUserAgentRun.mockReset();
  findUserAgentRun.mockResolvedValue(null);
  runInserts.length = 0;
  runUpdates.length = 0;
  forceClaimConflict = false;
  forceFinalizeError = false;
  requireAiEntitlement.mockReset();
  requireAiEntitlement.mockResolvedValue(undefined);
  assertRunAllowedToday.mockReset();
  assertRunAllowedToday.mockResolvedValue(undefined);
  getAgentOwnerClient.mockClear();
  ownerConversationInsert.mockReset();
  ownerMessageInsert.mockReset();
  forceThreadInsertError = null;
  docRows = [];
  ceiling = [...AGENT_CAPABILITIES];
  readOrgAiSettings.mockClear();
  // mockReset, not mockClear: several tests queue a one-shot rejection, and a
  // leftover one would fail an unrelated test further down the file.
  insertProposals.mockReset();
  insertProposals.mockResolvedValue(undefined);
  proposalRows = [];
  sendBriefingEmail.mockReset();
  sendBriefingEmail.mockResolvedValue({ emailed: true });
  languageModelFor.mockClear();
  nextModel = () => textOnlyModel("You have 1 overdue item.");
  runAi.mockReset();
  reportedUsage = null;
  runAi.mockImplementation(
    async (
      _args: unknown,
      fn: (
        r: FakeResolved,
        report: ReportUsage,
      ) => Promise<{ result: unknown }>,
    ) => (await fn(resolvedDefaults(), captureUsage)).result,
  );
});

describe("POST /api/ai/personal-agent", () => {
  it("rejects an unsigned request", async () => {
    const res = await POST(post(slot, "deadbeef"));
    expect(res.status).toBe(401);
  });

  it("rejects a tampered body", async () => {
    const raw = JSON.stringify(slot);
    const req = new Request("https://x/api/ai/personal-agent", {
      method: "POST",
      body: JSON.stringify({ ...slot, fire_hour: 9 }),
      headers: { "x-pulse-signature": signBody(raw, SECRET) },
    });
    expect((await POST(req)).status).toBe(401);
  });

  it("400s on a malformed body", async () => {
    const res = await POST(post({ nope: true }));
    expect(res.status).toBe(400);
  });

  it("404s for an unknown agent", async () => {
    getUserAgentById.mockResolvedValue(null);
    expect((await POST(post(slot))).status).toBe(404);
  });

  it("skips a disabled agent without writing a run", async () => {
    getUserAgentById.mockResolvedValue({ id: slot.agent_id, enabled: false });
    const res = await POST(post(slot));
    expect(await res.json()).toMatchObject({ status: "skipped" });
    expect(runInserts).toHaveLength(0);
    expect(runUpdates).toHaveLength(0);
  });

  it("is a no-op when the fire slot already ran (sequential redelivery, fast path)", async () => {
    getUserAgentById.mockResolvedValue({ id: slot.agent_id, enabled: true });
    findUserAgentRun.mockResolvedValue({ id: "existing" });
    const res = await POST(post(slot));
    expect(await res.json()).toMatchObject({ status: "noop" });
    expect(runInserts).toHaveLength(0);
    expect(runUpdates).toHaveLength(0);
  });

  // ── Finding 1: claim-before-send is the real backstop ──────────────────
  it("claims the slot with an insert BEFORE any token spend or email, then finalizes as ran", async () => {
    getUserAgentById.mockResolvedValue(enabledAgent());
    const res = await POST(post(slot));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ status: "ran" });

    // Exactly one insert (the claim) and one update (the finalize) — never
    // a second insert for the final status.
    expect(runInserts).toHaveLength(1);
    expect(runInserts[0]).toMatchObject({
      user_agent_id: AGENT_ID,
      fire_date: slot.fire_date,
      fire_hour: slot.fire_hour,
      status: "error", // conservative claim placeholder — see CLAIM_PLACEHOLDER
    });
    expect(runUpdates).toHaveLength(1);
    expect(runUpdates[0]!.patch).toMatchObject({
      status: "ran",
      input_tokens: 5,
      output_tokens: 2,
    });
    expect(sendBriefingEmail).toHaveBeenCalledOnce();
  });

  // ── the loop's own audit columns ───────────────────────────────────────
  it("records the run's effect: steps, tools used, grants and the agent's own report", async () => {
    getUserAgentById.mockResolvedValue({
      ...enabledAgent(),
      capabilities: ["board.write"],
    });
    nextModel = writeThenReportModel;

    const res = await POST(post(slot));

    await expect(res.json()).resolves.toMatchObject({ status: "ran" });
    expect(runUpdates[0]!.patch).toMatchObject({
      status: "ran",
      steps: 2,
      grants: ["board.write"],
      // The GRANTED write really executed — the positive control for the gate.
      tools_used: ["create_item"],
      output: "You have 1 overdue item.",
    });
    expect(proposalRows).toHaveLength(0);
  });

  // ── the zero-grant regression (Task 2's `default '{}'` backfill) ────────
  // Every agent that predates capabilities carries `capabilities: []`. Such an
  // agent must still COMPLETE and still email — it simply performs no writes.
  // If this ever fails, the relaxation stopped being opt-in.
  it("completes and still emails for an agent with NO capabilities, performing zero writes", async () => {
    getUserAgentById.mockResolvedValue(enabledAgent()); // capabilities: []
    nextModel = writeThenReportModel;

    const res = await POST(post(slot));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ status: "ran" });
    expect(runUpdates[0]!.patch).toMatchObject({
      status: "ran",
      grants: [],
      // The write was DENIED, so nothing executed. `tools_used` is an audit of
      // what happened, not of what was asked for.
      tools_used: [],
    });
    expect(sendBriefingEmail).toHaveBeenCalledOnce();
  });

  // ── the gate really is installed in the assembled run ──────────────────
  // `buildAgentTools` returns fully executable write tools. A run that forgot
  // `toolApproval` would execute them and no unit test of the gate alone would
  // notice — so this asserts the DENIAL end to end, through the real loop.
  it("denies an ungranted write and queues it as a proposal instead", async () => {
    getUserAgentById.mockResolvedValue(enabledAgent());
    nextModel = writeThenReportModel;

    await POST(post(slot));

    expect(insertProposals).toHaveBeenCalledOnce();
    expect(proposalRows).toHaveLength(1);
    expect(proposalRows[0]).toMatchObject({
      userAgentId: AGENT_ID,
      runId: "run-1",
      orgId: ORG,
      ownerId: OWNER,
      capability: "board.write",
      toolName: "create_item",
      toolCallId: "call-1",
      input: { groupId: GROUP, name: "Draft" },
    });
    // Never model-written text: `summariseProposal` derives the sentence from
    // the tool INPUT, so what the owner approves describes what would execute.
    expect(proposalRows[0]!.summary).toBe('Add "Draft" to a board group.');
  });

  it("tells the email how many actions await approval", async () => {
    getUserAgentById.mockResolvedValue(enabledAgent());
    nextModel = writeThenReportModel;

    await POST(post(slot));

    expect(sendBriefingEmail).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        proposalCount: 1,
        fireDate: slot.fire_date,
        summary: "You have 1 overdue item.",
      }),
    );
  });

  it("queues nothing, and says nothing, on a run with no refusals", async () => {
    getUserAgentById.mockResolvedValue(enabledAgent());

    await POST(post(slot));

    expect(proposalRows).toHaveLength(0);
    expect(sendBriefingEmail).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ proposalCount: 0 }),
    );
  });

  // ── the ORG ceiling is the admin half of the two-key gate ──────────────
  it("intersects the agent's grants with the org ceiling at RUN time", async () => {
    getUserAgentById.mockResolvedValue({
      ...enabledAgent(),
      capabilities: ["board.write", "files.write"],
    });
    ceiling = ["files.write"];
    nextModel = writeThenReportModel;

    await POST(post(slot));

    // board.write was granted on the agent but is above the ceiling, so the
    // effective set is the intersection — and the write did not run.
    expect(runUpdates[0]!.patch).toMatchObject({
      grants: ["files.write"],
      tools_used: [],
    });
  });

  // Over-ceiling means DENY WITH NO PROPOSAL: a proposal nobody in the org is
  // permitted to approve renders a button that can only ever fail.
  it("records NO proposal for a call above the org ceiling", async () => {
    getUserAgentById.mockResolvedValue({
      ...enabledAgent(),
      capabilities: ["board.write"],
    });
    ceiling = [];
    nextModel = writeThenReportModel;

    const res = await POST(post(slot));

    await expect(res.json()).resolves.toMatchObject({ status: "ran" });
    expect(proposalRows).toHaveLength(0);
  });

  // `DEFAULT_ORG_AI_SETTINGS.agentCapabilityCeiling` is a module singleton
  // returned BY IDENTITY, so an in-place mutation here would silently rewrite
  // the default for every org in the process.
  it("never mutates the ceiling array it was handed", async () => {
    getUserAgentById.mockResolvedValue({
      ...enabledAgent(),
      capabilities: ["board.write"],
    });
    const shared = ["files.write"];
    ceiling = shared;

    await POST(post(slot));

    expect(shared).toEqual(["files.write"]);
  });

  // ── The per-agent model pin (user_agents.provider / .model_id) ─────────
  it("spends the PINNED provider's key and asks for the pinned model", async () => {
    // An agent pinned to Kimi must resolve the Kimi key. Resolving whichever
    // key the owner happens to have would POST an Anthropic key to Moonshot.
    getUserAgentById.mockResolvedValue({
      ...enabledAgent(),
      provider: "moonshotai",
      model_id: "kimi-k2",
    });
    await POST(post(slot));

    expect(runAi).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: ORG,
        userId: OWNER,
        feature: "personal_agent_run",
        provider: "moonshotai",
        requestedModel: "kimi-k2",
      }),
      expect.any(Function),
    );
  });

  it("leaves the pin OFF the gateway args when the agent has none", async () => {
    // Omitted, not null-with-a-value: an unpinned agent takes the org default,
    // and passing a provider of `null` would be a request for a provider named
    // null rather than "no preference".
    getUserAgentById.mockResolvedValue(enabledAgent());
    await POST(post(slot));

    expect(runAi.mock.calls[0]![0]).toMatchObject({ provider: undefined });
    expect(runAi.mock.calls[0]![0]).toMatchObject({ requestedModel: null });
  });

  // The catalog key and the wire id are two different strings on purpose: the
  // Gateway publishes `claude-haiku-4.5` where Anthropic's API wants the dated
  // snapshot `claude-haiku-4-5-20251001`. A pin STORES the catalog key and the
  // picker DISPLAYS it; only `requestModel` may go on the wire. Sending the
  // catalog key is a 404 from the provider — a scheduled agent that stops
  // producing with no user-visible cause.
  it("puts the WIRE id on the provider call, never the catalog key the pin stores", async () => {
    getUserAgentById.mockResolvedValue({
      ...enabledAgent(),
      provider: "anthropic",
      model_id: "claude-sonnet-5",
    });
    resolveWith({
      model: fakeResolvedModel({
        model: "claude-sonnet-5",
        requestModel: "claude-sonnet-5-20260101",
      }),
    });
    await POST(post(slot));

    expect(languageModelFor).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "anthropic",
        model: "claude-sonnet-5-20260101",
      }),
    );
    // Belt and braces: the catalog key must not be what the provider is asked
    // for, even though it IS what the pin and the ledger store.
    expect(languageModelFor).not.toHaveBeenCalledWith(
      expect.objectContaining({ model: "claude-sonnet-5" }),
    );
  });

  it("passes the openai-compatible baseUrl through to the model factory", async () => {
    getUserAgentById.mockResolvedValue(enabledAgent());
    resolveWith({
      adapter: { kind: "openai-compatible" },
      provider: "moonshotai",
      baseUrl: "https://api.moonshot.ai/v1",
    });

    await POST(post(slot));

    expect(languageModelFor).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "openai-compatible",
        baseUrl: "https://api.moonshot.ai/v1",
      }),
    );
  });

  it("records model_substituted when the pinned model was gone", async () => {
    // A substituted run still SUCCEEDED. It is recorded on its own column, not
    // overloaded onto `error`, so the owner is not told a working agent broke.
    getUserAgentById.mockResolvedValue({
      ...enabledAgent(),
      provider: "anthropic",
      model_id: "claude-retired-9",
    });
    resolveWith({ model: fakeResolvedModel({ substituted: true }) });
    const res = await POST(post(slot));

    await expect(res.json()).resolves.toMatchObject({ status: "ran" });
    expect(runUpdates[0]!.patch).toMatchObject({
      status: "ran",
      error: null,
      model_substituted: true,
    });
  });

  it("records model_substituted: false on an ordinary run", async () => {
    getUserAgentById.mockResolvedValue(enabledAgent());
    await POST(post(slot));
    expect(runUpdates[0]!.patch).toMatchObject({ model_substituted: false });
  });

  it("is a no-op via the claim backstop when a concurrent delivery races the fast probe", async () => {
    getUserAgentById.mockResolvedValue(enabledAgent());
    // Simulate the race: findUserAgentRun's fast probe still sees null (the
    // other delivery hasn't committed yet), but by the time THIS delivery
    // tries to claim, the other delivery has already won the unique index.
    forceClaimConflict = true;

    const res = await POST(post(slot));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ status: "noop" });
    // No token spend, no email — the loser does NOTHING beyond the failed claim.
    expect(languageModelFor).not.toHaveBeenCalled();
    expect(sendBriefingEmail).not.toHaveBeenCalled();
    expect(runInserts).toHaveLength(0);
    expect(runUpdates).toHaveLength(0);
  });

  // ── the gated path also goes through claim + finalize ───────────────────
  it("claims the slot, then finalizes as skipped when entitlement is off (no spend)", async () => {
    getUserAgentById.mockResolvedValue(enabledAgent());
    requireAiEntitlement.mockRejectedValue(new AiDisabledError());

    const res = await POST(post(slot));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ status: "skipped" });
    expect(runInserts).toHaveLength(1);
    expect(runUpdates).toHaveLength(1);
    expect(runUpdates[0]!.patch).toMatchObject({ status: "skipped" });
    expect(languageModelFor).not.toHaveBeenCalled();
    expect(sendBriefingEmail).not.toHaveBeenCalled();
  });

  // ── Gap 1 / I1: a missing PER-USER AI key is a config state, not a fault ─
  it("finalizes as skipped (not error) when the owner has no AI key on file (per_user mode)", async () => {
    getUserAgentById.mockResolvedValue(enabledAgent());
    runAi.mockRejectedValue(new PersonalAiKeyMissingError());

    const res = await POST(post(slot));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      status: "skipped",
      reason: "no_key",
    });
    expect(runInserts).toHaveLength(1);
    expect(runUpdates).toHaveLength(1);
    expect(runUpdates[0]!.patch).toMatchObject({ status: "skipped" });
    // Never emails/records a "ran" outcome off an unconfigured key.
    expect(sendBriefingEmail).not.toHaveBeenCalled();
  });

  // ── M2: an org_byo org with no vault secret is the same kind of config
  //       state as a missing personal key — also skipped, not a 500. ──────
  it("finalizes as skipped (not error) when the org's org_byo key is missing", async () => {
    getUserAgentById.mockResolvedValue(enabledAgent());
    runAi.mockRejectedValue(new ByoKeyMissingError());

    const res = await POST(post(slot));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      status: "skipped",
      reason: "no_key",
    });
    expect(runUpdates[0]!.patch).toMatchObject({ status: "skipped" });
    expect(sendBriefingEmail).not.toHaveBeenCalled();
  });

  // ── the model-capability gate, which REPLACED the Anthropic-only one ────
  // The loop is provider-agnostic now, so the honest question is no longer
  // "is this Anthropic?" but "can THIS model call tools?".
  it("runs the loop on a NON-Anthropic provider whose model is tool-capable", async () => {
    getUserAgentById.mockResolvedValue(enabledAgent());
    resolveWith({
      adapter: { kind: "openai" },
      provider: "openai",
      model: fakeResolvedModel({ provider: "openai", supportsTools: true }),
    });

    const res = await POST(post(slot));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ status: "ran" });
    expect(sendBriefingEmail).toHaveBeenCalledOnce();
  });

  // A model that cannot call tools is a CONFIGURATION state the owner can fix
  // — skipped, with a message naming the model and where to change it. Nothing
  // is spent: the throw happens before the first model call.
  it("finalizes as skipped when the resolved model cannot use tools, and never calls the model", async () => {
    getUserAgentById.mockResolvedValue(enabledAgent());
    resolveWith({
      model: fakeResolvedModel({
        model: "claude-legacy-1",
        supportsTools: false,
      }),
    });

    const res = await POST(post(slot));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      status: "skipped",
      reason: "model_not_tool_capable",
    });
    expect(runInserts).toHaveLength(1);
    expect(runUpdates).toHaveLength(1);
    expect(runUpdates[0]!.patch).toMatchObject({ status: "skipped" });
    // The message has to name the model AND both places a model can come from
    // — the agent's own pin overrides the org default, so naming only one of
    // them sends the owner to a page with nothing wrong on it.
    expect(runUpdates[0]!.patch.error).toMatch(/claude-legacy-1/);
    expect(runUpdates[0]!.patch.error).toMatch(/Settings → Agents/);
    expect(runUpdates[0]!.patch.error).toMatch(/Settings → AI/);
    expect(languageModelFor).not.toHaveBeenCalled();
    expect(sendBriefingEmail).not.toHaveBeenCalled();
  });

  // ── I1: a PLATFORM-wide AiNotConfiguredError (e.g. managed mode's
  //       ANTHROPIC_API_KEY missing) must NOT be silently skipped — nobody
  //       but ops can fix it, and a "skipped" row never pages anyone. ──────
  it("finalizes as ERROR (not skipped) on a platform-wide AiNotConfiguredError, distinct from the per-user/org_byo config states above", async () => {
    getUserAgentById.mockResolvedValue(enabledAgent());
    // Deliberately the base class, NOT PersonalAiKeyMissingError — this is
    // what gateway.ts's `managed` branch throws when ANTHROPIC_API_KEY is
    // absent, which is a distinct failure mode from a per-user missing key.
    runAi.mockRejectedValue(new AiNotConfiguredError());

    const res = await POST(post(slot));

    expect(res.status).toBe(500);
    expect(runUpdates).toHaveLength(1);
    expect(runUpdates[0]!.patch).toMatchObject({ status: "error" });
    expect(sendBriefingEmail).not.toHaveBeenCalled();
  });

  // ── I2: the seam between the thread write and the email ────────────────
  // briefing-thread.test.ts and send.test.ts each cover their own half; this is
  // the only place that proves the id crosses between them.
  it("writes the briefing thread through the owner client and hands its id to the email", async () => {
    getUserAgentById.mockResolvedValue(enabledAgent());

    const res = await POST(post(slot));

    expect(res.status).toBe(200);
    expect(ownerConversationInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        org_id: ORG,
        user_id: OWNER,
        agent_id: AGENT_ID,
        // The run's id from the claim — the idempotency key that stops a
        // redelivered fire slot minting a second thread.
        run_id: "run-1",
        // A briefing spans every board its owner can see, so it belongs to none.
        board_id: null,
      }),
    );
    // The agent's own report is the thread's first (assistant) turn.
    expect(ownerMessageInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation_id: "conv-1",
        role: "assistant",
        content: "You have 1 overdue item.",
      }),
    );
    expect(sendBriefingEmail).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ threadId: "conv-1" }),
    );
    // Order matters: the email carries a link to the thread, so the thread has
    // to exist before it is sent.
    expect(ownerConversationInsert.mock.invocationCallOrder[0]).toBeLessThan(
      sendBriefingEmail.mock.invocationCallOrder[0]!,
    );
  });

  it("still emails — with no thread link — when the thread write fails", async () => {
    getUserAgentById.mockResolvedValue(enabledAgent());
    forceThreadInsertError = { message: "insert refused" };
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(post(slot));

    // A nice-to-have write must never cost the owner their briefing.
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ status: "ran" });
    expect(sendBriefingEmail).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ threadId: null }),
    );
    expect(runUpdates[0]!.patch).toMatchObject({ status: "ran" });
    errSpy.mockRestore();
  });

  // ── error path still finalizes, and reports the real HTTP outcome ──────
  it("finalizes as error and 500s when the run throws after being claimed", async () => {
    getUserAgentById.mockResolvedValue(enabledAgent());
    getAgentOwnerClient.mockRejectedValueOnce(new Error("bridge boom"));

    const res = await POST(post(slot));

    expect(res.status).toBe(500);
    expect(runInserts).toHaveLength(1);
    expect(runUpdates).toHaveLength(1);
    expect(runUpdates[0]!.patch).toMatchObject({
      status: "error",
      error: "bridge boom",
    });
  });

  // ── a run that DIES mid-loop still tells the truth ─────────────────────
  // The model was already told "Recorded for your approval." and may have said
  // so to the owner. Dropping the proposal because a LATER step threw breaks a
  // promise the model already made, and the text that made it is gone too.
  it("still queues proposals when the loop throws after a denial", async () => {
    getUserAgentById.mockResolvedValue(enabledAgent()); // capabilities: []
    nextModel = writeThenThrowModel;

    const res = await POST(post(slot));

    expect(res.status).toBe(500);
    expect(insertProposals).toHaveBeenCalledOnce();
    expect(proposalRows).toHaveLength(1);
    expect(proposalRows[0]).toMatchObject({
      toolName: "create_item",
      toolCallId: "call-1",
      capability: "board.write",
      runId: "run-1",
    });
    // Still a failed run — the proposal survives, the run does not pretend.
    expect(runUpdates[0]!.patch).toMatchObject({ status: "error" });
    expect(sendBriefingEmail).not.toHaveBeenCalled();
  });

  // "What did my agent do to my boards" is the question that matters most on
  // the run that failed. It used to record `{status, error}` and nothing else.
  it("records the PARTIAL audit trail when the loop throws after executing a write", async () => {
    getUserAgentById.mockResolvedValue({
      ...enabledAgent(),
      capabilities: ["board.write"],
    });
    nextModel = writeThenThrowModel;

    const res = await POST(post(slot));

    expect(res.status).toBe(500);
    expect(runUpdates[0]!.patch).toMatchObject({
      status: "error",
      error: expect.stringContaining("provider 503"),
      // The granted write really executed at step 1, before the throw.
      steps: 1,
      tools_used: ["create_item"],
      grants: ["board.write"],
    });
    // No report exists, and inventing one would be worse than an empty column.
    expect(runUpdates[0]!.patch.output).toBeUndefined();
  });

  // The MONEY half of that same partial trail. Step 1 was a real, billed
  // provider round-trip; `runAi` meters only what its callback resolves with,
  // so without this report the tokens that run really spent reach no ledger row
  // at all — managed-mode spend nobody is charged for, and a monthly credit
  // ceiling that under-counts by exactly the runs that failed.
  it("reports the tokens a run spent before it threw, so the gateway can meter them", async () => {
    getUserAgentById.mockResolvedValue({
      ...enabledAgent(),
      capabilities: ["board.write"],
    });
    nextModel = writeThenThrowModel;

    await POST(post(slot));

    expect(reportedUsage).not.toBeNull();
    expect(reportedUsage!.inputTokens).toBeGreaterThan(0);
    expect(reportedUsage!.outputTokens).toBeGreaterThan(0);
  });

  it("records zero steps, not silence, when the run dies before the loop starts", async () => {
    getUserAgentById.mockResolvedValue(enabledAgent());
    getAgentOwnerClient.mockRejectedValueOnce(new Error("bridge boom"));

    await POST(post(slot));

    expect(runUpdates[0]!.patch).toMatchObject({
      status: "error",
      steps: 0,
      tools_used: [],
      grants: [],
    });
  });

  // The owner's ruling: a FAILING insert fails the whole run loudly. The catch
  // must not then retry it — a second attempt cannot succeed and would replace
  // the real cause of death with a bookkeeping error.
  it("fails the run loudly when the proposal insert itself fails, and does not retry it", async () => {
    getUserAgentById.mockResolvedValue(enabledAgent());
    nextModel = writeThenReportModel;
    insertProposals.mockRejectedValueOnce(new Error("insertProposals: boom"));

    const res = await POST(post(slot));

    expect(res.status).toBe(500);
    expect(insertProposals).toHaveBeenCalledOnce(); // not retried
    expect(runUpdates[0]!.patch).toMatchObject({
      status: "error",
      error: expect.stringContaining("insertProposals"),
    });
    expect(sendBriefingEmail).not.toHaveBeenCalled();
  });

  // Already on the failure path: a second failure must be logged, never
  // thrown, or it replaces the real cause of the run's death.
  it("logs rather than throws when the error-path proposal write also fails", async () => {
    getUserAgentById.mockResolvedValue(enabledAgent());
    nextModel = writeThenThrowModel;
    insertProposals.mockRejectedValueOnce(new Error("db down"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(post(slot));

    expect(res.status).toBe(500);
    // The ORIGINAL cause survives — not "db down".
    expect(runUpdates[0]!.patch.error).toMatch(/provider 503/);
    expect(errSpy).toHaveBeenCalledWith(
      "[personal-agent] proposal persist on error path failed:",
      expect.objectContaining({ cause: "db down" }),
    );
    errSpy.mockRestore();
  });

  // ── Finding 2: a finalize write failure must not crash the response ────
  it("still reports the real outcome when the finalize write itself fails after a successful send", async () => {
    getUserAgentById.mockResolvedValue(enabledAgent());
    forceFinalizeError = true;
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(post(slot));

    // The email genuinely sent — the response must say "ran", not crash
    // into an unhandled rejection or a 500, even though the bookkeeping
    // write that would have recorded it failed.
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ status: "ran" });
    expect(sendBriefingEmail).toHaveBeenCalledOnce();
    // The failure was logged, not swallowed silently.
    expect(errSpy).toHaveBeenCalledWith(
      "[personal-agent] finalizeRun failed:",
      expect.objectContaining({ patchStatus: "ran" }),
    );
    errSpy.mockRestore();
  });

  // ── reference documents (Task 6) ────────────────────────────────────────
  // Read inside the runAi callback (the resolved model's contextLength is
  // only known there), budgeted with the SAME arithmetic the attach-time
  // meter uses, and injected into the ONE system message — never a second
  // one, since the Anthropic cache breakpoint lives on that message alone.
  describe("reference documents", () => {
    /** Captures the exact system-message text the model was sent. */
    function capturingModel(sink: { system?: string }) {
      return new MockLanguageModelV4({
        doGenerate: async ({ prompt }) => {
          const system = (prompt as { role: string; content: string }[]).find(
            (m) => m.role === "system",
          );
          sink.system = system?.content;
          return {
            content: [{ type: "text", text: "You have 1 overdue item." }],
            finishReason: { unified: "stop", raw: undefined },
            usage: USAGE,
            warnings: [],
          };
        },
      });
    }

    it("records documents_omitted: false and an unchanged prompt when the agent has no documents", async () => {
      getUserAgentById.mockResolvedValue(enabledAgent());
      const sink: { system?: string } = {};
      nextModel = () => capturingModel(sink);

      const res = await POST(post(slot));

      await expect(res.json()).resolves.toMatchObject({ status: "ran" });
      expect(runUpdates[0]!.patch).toMatchObject({ documents_omitted: false });
      expect(sink.system).not.toContain("REFERENCE DOCUMENTS");
    });

    it("injects an attached document that fits the budget, and records documents_omitted: false", async () => {
      getUserAgentById.mockResolvedValue(enabledAgent());
      docRows = [
        {
          agent_documents: {
            id: "doc-1",
            title: "Standup format",
            body: "Yesterday / Today / Blockers, one line each.",
            token_estimate: 20,
          },
        },
      ];
      const sink: { system?: string } = {};
      nextModel = () => capturingModel(sink);

      const res = await POST(post(slot));

      await expect(res.json()).resolves.toMatchObject({ status: "ran" });
      expect(runUpdates[0]!.patch).toMatchObject({ documents_omitted: false });
      expect(sink.system).toContain("REFERENCE DOCUMENTS");
      expect(sink.system).toContain("Standup format");
      expect(sink.system).toContain(
        "Yesterday / Today / Blockers, one line each.",
      );
      // Owner instructions still come last, even with a document attached.
      expect(sink.system!.trimEnd().endsWith("Be concise.")).toBe(true);
    });

    it("drops an attached document set that does not fit the budget, and records documents_omitted: true — the run still succeeds", async () => {
      getUserAgentById.mockResolvedValue(enabledAgent());
      // fakeResolvedModel's default contextLength (200_000) gives a budget in
      // the tens of thousands of tokens; a single document this large cannot
      // fit no matter how the arithmetic lands, without hand-tuning to the
      // exact budget constant (which would silently drift with it).
      docRows = [
        {
          agent_documents: {
            id: "doc-1",
            title: "Huge policy doc",
            body: "x",
            token_estimate: 10_000_000,
          },
        },
      ];
      const sink: { system?: string } = {};
      nextModel = () => capturingModel(sink);

      const res = await POST(post(slot));

      // A dropped document set is NOT a failure — the run still succeeds and
      // still emails, same as a run with no documents at all.
      await expect(res.json()).resolves.toMatchObject({ status: "ran" });
      expect(runUpdates[0]!.patch).toMatchObject({ documents_omitted: true });
      expect(sink.system).not.toContain("REFERENCE DOCUMENTS");
      expect(sink.system).not.toContain("Huge policy doc");
      expect(sendBriefingEmail).toHaveBeenCalledOnce();
    });

    // A null contextLength (defensive: no active model should ever lack one)
    // must degrade to the NULL_CONTEXT_FALLBACK, never throw or silently
    // include everything.
    it("still runs, budgeting off the null-context fallback, when the resolved model carries no context length", async () => {
      getUserAgentById.mockResolvedValue(enabledAgent());
      resolveWith({ model: fakeResolvedModel({ contextLength: null }) });
      docRows = [
        {
          agent_documents: {
            id: "doc-1",
            title: "Small note",
            body: "Keep it short.",
            token_estimate: 10,
          },
        },
      ];
      const sink: { system?: string } = {};
      nextModel = () => capturingModel(sink);

      const res = await POST(post(slot));

      await expect(res.json()).resolves.toMatchObject({ status: "ran" });
      expect(runUpdates[0]!.patch).toMatchObject({ documents_omitted: false });
      expect(sink.system).toContain("Small note");
    });
  });

  it("still reports 'skipped' when both the gate AND its finalize write fail", async () => {
    getUserAgentById.mockResolvedValue(enabledAgent());
    requireAiEntitlement.mockRejectedValue(new AiDisabledError());
    forceFinalizeError = true;
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(post(slot));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ status: "skipped" });
    errSpy.mockRestore();
  });
});
