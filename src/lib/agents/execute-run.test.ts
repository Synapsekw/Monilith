import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeResolvedModel } from "@/test/adapter-fakes";
import { PersonalAiKeyMissingError } from "@/lib/ai/errors";
import type { AgentCapability } from "./capabilities";
import type { ProposedCall } from "./grant-gate";
import type { UserAgentRow } from "./agents-db";

/**
 * The seam this suite pins is `executeAgentRun`'s CONTRACT with its callers,
 * not the loop it drives: what lands on `progress` (the object a caller's catch
 * reads for a run that never returned), when proposals are written, and which
 * errors travel back untouched for the caller to classify. The end-to-end
 * behaviour of the assembled tool set + grant gate stays where it already is —
 * `route.test.ts` drives the REAL `buildAgentRuntime`/`runAgentLoop`, and this
 * extraction deliberately left that file untouched.
 */

// ── the gateway ─────────────────────────────────────────────────────────
const resolved = () => ({
  adapter: { kind: "anthropic" },
  provider: "anthropic",
  apiKey: "k",
  baseUrl: null,
  model: fakeResolvedModel(),
});
type Resolved = ReturnType<typeof resolved>;
type ReportUsage = (u: { inputTokens: number; outputTokens: number }) => void;
let nextResolved: () => Resolved = resolved;
const runAi = vi.fn(
  async (
    _args: unknown,
    fn: (r: Resolved, report: ReportUsage) => Promise<{ result: unknown }>,
  ) => (await fn(nextResolved(), () => {})).result,
);
vi.mock("@/lib/ai/gateway", () => ({
  runAi: (...a: Parameters<typeof runAi>) => runAi(...a),
}));

vi.mock("@/lib/ai/providers/language-model", () => ({
  languageModelFor: () => ({ modelId: "fake" }),
}));

// ── the loop ────────────────────────────────────────────────────────────
// Mocked HERE (unlike route.test.ts, which drives the real one) because what
// this suite asserts is what the executor does AROUND the loop.
const LOOP_RESULT = {
  text: "Done.",
  usage: { inputTokens: 5, outputTokens: 2 },
  steps: 3,
  toolsUsed: ["create_item"],
  documentsOmitted: false,
  memoryNotesDropped: 0,
};
type RuntimeArgs = {
  onPropose: (c: ProposedCall) => void;
  extra: { name: string }[];
};
let runtimeArgs: RuntimeArgs | null = null;
type LoopArgs = {
  task?: string;
  onStep?: (p: {
    steps: number;
    toolsUsed: string[];
    usage: { inputTokens: number; outputTokens: number };
  }) => void;
};
const buildAgentRuntime = vi.fn((a: RuntimeArgs) => {
  runtimeArgs = a;
  return { tools: {}, gate: () => ({ behavior: "approve" }) };
});
const runAgentLoop = vi.fn(async (a: LoopArgs) => {
  a.onStep?.({
    steps: 3,
    toolsUsed: ["create_item"],
    usage: LOOP_RESULT.usage,
  });
  return LOOP_RESULT;
});
vi.mock("./run-loop", async (importOriginal) => ({
  // The error CLASS is real: the caller's `instanceof` branch is the whole
  // reason a config state is a "skipped" run and not an "error" one.
  ...(await importOriginal<typeof import("./run-loop")>()),
  buildAgentRuntime: (a: unknown) => buildAgentRuntime(a as RuntimeArgs),
  runAgentLoop: (a: unknown) => runAgentLoop(a as LoopArgs),
}));

// ── delegation ──────────────────────────────────────────────────────────
// Mocked so this suite asserts the WIRING (is the tool offered, and with whose
// run id as the parent) rather than re-testing delegate-tool.test.ts.
type DelegateArgs = { parentRunId: string; ceiling: AgentCapability[] };
const makeDelegateDescriptors = vi.fn((_a: DelegateArgs) => [
  { name: "delegate" },
]);
const listDelegateRoster = vi.fn(async (_client: unknown, _agent: unknown) => [
  { id: "b1", handle: "ops", name: "Ops", instructions: "watch" },
]);
vi.mock("./delegate-tool", () => ({
  makeDelegateDescriptors: (a: unknown) =>
    makeDelegateDescriptors(a as DelegateArgs),
  listDelegateRoster: (c: unknown, a: unknown) => listDelegateRoster(c, a),
}));

vi.mock("./documents-db", () => ({ listDocumentsForAgent: async () => [] }));
vi.mock("./memory-db", () => ({ listMemoryForAgent: async () => [] }));

const insertProposals = vi.fn(async () => {});
let proposalRows: Record<string, unknown>[] = [];
vi.mock("./proposals-db", () => ({
  insertProposals: (_svc: unknown, rows: Record<string, unknown>[]) => {
    proposalRows = rows;
    return insertProposals();
  },
}));

const { DEFAULT_RUN_TASK } = await import("./run-loop");
const { executeAgentRun, newRunProgress } = await import("./execute-run");

const AGENT_ID = "00000000-0000-4000-8000-0000000000aa";
const agentFixture: UserAgentRow = {
  id: AGENT_ID,
  org_id: "00000000-0000-4000-8000-0000000000f1",
  owner_id: "00000000-0000-4000-8000-0000000000f2",
  name: "Morning Brief",
  template_id: "morning-brief",
  instructions: "Be concise.",
  board_scope: { mode: "all" },
  cadence: "daily",
  run_at_local_hour: 7,
  run_on_weekday: null,
  run_on_day_of_month: null,
  enabled: true,
  capabilities: [],
  bridge_secret_id: null,
  provider: null,
  model_id: null,
  doc_nonce: "fixture-agent-nonce",
};

const client = {} as never;
const baseArgs = () => ({
  svc: client,
  ownerClient: client,
  agent: agentFixture,
  runId: "run-1",
  ceiling: [] as AgentCapability[],
  allowDelegation: false,
  progress: newRunProgress(),
});

const denial: ProposedCall = {
  toolCallId: "call-1",
  toolName: "create_item",
  capability: "board.write",
  input: { name: "Draft" },
};

beforeEach(() => {
  nextResolved = resolved;
  runAi.mockClear();
  buildAgentRuntime.mockClear();
  runtimeArgs = null;
  runAgentLoop.mockReset();
  runAgentLoop.mockImplementation(async (a: LoopArgs) => {
    a.onStep?.({
      steps: 3,
      toolsUsed: ["create_item"],
      usage: LOOP_RESULT.usage,
    });
    return LOOP_RESULT;
  });
  insertProposals.mockReset();
  insertProposals.mockResolvedValue(undefined);
  proposalRows = [];
  makeDelegateDescriptors.mockClear();
  listDelegateRoster.mockClear();
});

describe("executeAgentRun", () => {
  // The USER turn, not the system message — a delegated child is handed its
  // parent's task here, and the cached prefix is unchanged either way.
  it("uses the default task when none is given", async () => {
    await executeAgentRun(baseArgs());
    expect(runAgentLoop.mock.calls[0]![0].task).toBe(DEFAULT_RUN_TASK);
  });

  it("passes an explicit task straight through", async () => {
    await executeAgentRun({ ...baseArgs(), task: "Summarise board Ops." });
    expect(runAgentLoop.mock.calls[0]![0].task).toBe("Summarise board Ops.");
  });

  it("records the effective grants on progress before the loop runs", async () => {
    const progress = newRunProgress();
    await executeAgentRun({
      ...baseArgs(),
      progress,
      agent: { ...agentFixture, capabilities: ["board.write", "time.log"] },
      ceiling: ["board.write"],
    });
    expect(progress.grants).toEqual(["board.write"]);
  });

  // The catch's whole purpose: a run that dies at step 1 must still be able to
  // say what it was permitted to do.
  it("records the grants even when the loop never returns", async () => {
    const progress = newRunProgress();
    runAgentLoop.mockRejectedValueOnce(new Error("provider 503"));
    await expect(
      executeAgentRun({
        ...baseArgs(),
        progress,
        agent: { ...agentFixture, capabilities: ["board.write"] },
        ceiling: ["board.write"],
      }),
    ).rejects.toThrow("provider 503");
    expect(progress.grants).toEqual(["board.write"]);
  });

  it("hands the loop only the grants the ceiling still allows", async () => {
    await executeAgentRun({
      ...baseArgs(),
      agent: { ...agentFixture, capabilities: ["board.write", "time.log"] },
      ceiling: ["time.log"],
    });
    expect(buildAgentRuntime.mock.calls[0]![0]).toMatchObject({
      granted: ["time.log"],
      ceiling: ["time.log"],
    });
  });

  it("carries the loop's high-water marks onto progress via onStep", async () => {
    const progress = newRunProgress();
    await executeAgentRun({ ...baseArgs(), progress });
    expect(progress.steps).toBe(3);
    expect(progress.toolsUsed).toEqual(["create_item"]);
  });

  it("records a substituted model on progress, not as an error", async () => {
    const progress = newRunProgress();
    nextResolved = () => ({
      ...resolved(),
      model: fakeResolvedModel({ substituted: true }),
    });
    await executeAgentRun({ ...baseArgs(), progress });
    expect(progress.modelSubstituted).toBe(true);
  });

  it("returns the loop's result plus the count of queued proposals", async () => {
    runAgentLoop.mockImplementationOnce(async () => {
      runtimeArgs!.onPropose(denial);
      return LOOP_RESULT;
    });
    const r = await executeAgentRun(baseArgs());
    expect(r).toMatchObject({ ...LOOP_RESULT, proposalCount: 1 });
  });

  it("queues the run's proposals once, before returning", async () => {
    runAgentLoop.mockImplementationOnce(async () => {
      runtimeArgs!.onPropose(denial);
      return LOOP_RESULT;
    });
    await executeAgentRun(baseArgs());
    expect(insertProposals).toHaveBeenCalledOnce();
    expect(proposalRows[0]).toMatchObject({
      userAgentId: AGENT_ID,
      runId: "run-1",
      toolName: "create_item",
      // SERVER-derived, never model text.
      summary: expect.any(String),
    });
  });

  // The model was told "Recorded for your approval." before the run died.
  it("still queues proposals when the loop throws, and rethrows the original", async () => {
    runAgentLoop.mockImplementationOnce(async () => {
      runtimeArgs!.onPropose(denial);
      throw new Error("provider 503");
    });
    await expect(executeAgentRun(baseArgs())).rejects.toThrow("provider 503");
    expect(insertProposals).toHaveBeenCalledOnce();
    expect(proposalRows).toHaveLength(1);
  });

  it("fails the run loudly when the proposal insert itself fails, and does not retry it", async () => {
    insertProposals.mockRejectedValueOnce(new Error("insertProposals: boom"));
    await expect(executeAgentRun(baseArgs())).rejects.toThrow(
      "insertProposals",
    );
    expect(insertProposals).toHaveBeenCalledOnce();
  });

  // Already on the failure path: a second failure must be logged, never
  // thrown, or it replaces the real cause of the run's death.
  it("logs rather than throws when the error-path proposal write also fails", async () => {
    runAgentLoop.mockImplementationOnce(async () => {
      runtimeArgs!.onPropose(denial);
      throw new Error("provider 503");
    });
    insertProposals.mockRejectedValueOnce(new Error("db down"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(executeAgentRun(baseArgs())).rejects.toThrow("provider 503");

    expect(errSpy).toHaveBeenCalledWith(
      "[personal-agent] proposal persist on error path failed:",
      expect.objectContaining({ cause: "db down" }),
    );
    errSpy.mockRestore();
  });

  // A configuration state is raised before there is a loop, so there is
  // nothing queued — and the CALLER, which alone knows how to record a
  // "skipped" run, sees the error untouched.
  it("rethrows a configuration state without writing an empty proposal batch", async () => {
    runAi.mockRejectedValueOnce(new PersonalAiKeyMissingError("no key"));
    await expect(executeAgentRun(baseArgs())).rejects.toBeInstanceOf(
      PersonalAiKeyMissingError,
    );
    expect(insertProposals).not.toHaveBeenCalled();
  });

  it("meters under the personal_agent_run feature and forwards the agent's pin", async () => {
    await executeAgentRun({
      ...baseArgs(),
      agent: { ...agentFixture, provider: "openai", model_id: "gpt-5" },
    });
    expect(runAi.mock.calls[0]![0]).toMatchObject({
      feature: "personal_agent_run",
      provider: "openai",
      requestedModel: "gpt-5",
    });
  });
});

describe("executeAgentRun — delegation", () => {
  it("offers no delegate tool when delegation is off", async () => {
    await executeAgentRun({ ...baseArgs(), allowDelegation: false });
    expect(makeDelegateDescriptors).not.toHaveBeenCalled();
    expect(listDelegateRoster).not.toHaveBeenCalled();
    const names = buildAgentRuntime.mock.calls[0]![0].extra.map((d) => d.name);
    expect(names).not.toContain("delegate");
  });

  it("offers the delegate tool when delegation is on", async () => {
    await executeAgentRun({ ...baseArgs(), allowDelegation: true });
    const names = buildAgentRuntime.mock.calls[0]![0].extra.map((d) => d.name);
    expect(names).toContain("delegate");
  });

  // The descriptor closes over THIS run as the parent — that is the edge the
  // claim RPC counts fan-out and depth along.
  it("names its own run as the parent and hands over the org ceiling", async () => {
    await executeAgentRun({
      ...baseArgs(),
      allowDelegation: true,
      ceiling: ["agent.delegate"],
    });
    expect(makeDelegateDescriptors.mock.calls[0]![0]).toMatchObject({
      parentRunId: "run-1",
      ceiling: ["agent.delegate"],
    });
  });

  // The roster is read through the OWNER's client, so RLS decides what is on
  // it — not a service-role read that could see another owner's agents.
  it("reads the roster through the owner client", async () => {
    await executeAgentRun({ ...baseArgs(), allowDelegation: true });
    expect(listDelegateRoster.mock.calls[0]![0]).toBe(client);
  });
});

describe("executeAgentRun — metering correlation", () => {
  // Without this the parent and all three of its children collapse into one
  // undifferentiated `personal_agent_run` bucket for the org.
  it("meters under this run's own id", async () => {
    await executeAgentRun(baseArgs());
    expect(runAi.mock.calls[0]![0]).toMatchObject({ runId: "run-1" });
  });
});
