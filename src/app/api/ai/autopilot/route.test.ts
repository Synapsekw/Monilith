import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeResolvedModel } from "@/test/adapter-fakes";
import { signBody } from "@/lib/ai/agentic/hmac";
import { AiDisabledError } from "@/lib/ai/errors";

const SECRET = "test-hmac-secret-at-least-32-chars-long!!";
const ORG = "00000000-0000-4000-8000-0000000000f1";
const AGENT = "00000000-0000-4000-8000-0000000000f2";
const BOARD = "00000000-0000-4000-8000-0000000000fa";
const ITEM = "00000000-0000-4000-8000-0000000000fb";
const GRP = "00000000-0000-4000-8000-0000000000fc";
const BOT = "00000000-0000-4000-8000-0000000000b0";
const FIRE_DATE = "2026-07-20";
const FIRE_HOUR = 8;

// ── module mocks ────────────────────────────────────────────────────────────
const rpcCalls: { fn: string; args: unknown }[] = [];
const runInserts: unknown[] = [];
let agentRow: Record<string, unknown> | null;
let existingRun: { id: string } | null;

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    // Only board_agent_runs reads/writes go through `.from(...)`; the loose cast
    // in board-agents-db routes here.
    from(table: string) {
      if (table === "board_agents") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: agentRow }) }),
          }),
        };
      }
      if (table === "board_agent_runs") {
        const eqLeaf = { maybeSingle: async () => ({ data: existingRun }) };
        const eq3 = { eq: () => eqLeaf };
        const eq2 = { eq: () => eq3 };
        return {
          select: () => ({ eq: () => eq2 }),
          insert: async (row: unknown) => {
            runInserts.push(row);
            return { error: null };
          },
        };
      }
      return {};
    },
    rpc: async (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      if (fn === "platform_agent_user_id") return { data: BOT, error: null };
      if (fn === "board_agent_apply")
        return { data: "ai_decided", error: null };
      return { data: null, error: null };
    },
  }),
}));

const requireAiEntitlement = vi.fn(async () => {});
vi.mock("@/lib/ai/entitlement", () => ({
  requireAiEntitlement: (...a: unknown[]) => requireAiEntitlement(...(a as [])),
}));

const buildAgentContext = vi.fn(async () => ({
  boardId: BOARD,
  columns: [],
  groups: [{ id: GRP, name: "Backlog" }],
  members: [],
  items: [{ id: ITEM, name: "Untriaged", groupId: null }],
}));
vi.mock("@/lib/ai/agentic/context", () => ({
  buildAgentContext: (...a: unknown[]) => buildAgentContext(...(a as [])),
}));

const autopilotRun = vi.fn(async () => ({
  actions: [{ itemId: ITEM, action: { type: "move_to_group", groupId: GRP } }],
  warnings: [] as string[],
  usage: { inputTokens: 5, outputTokens: 2 },
}));
vi.mock("@/lib/ai/agentic/autopilot", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/ai/agentic/autopilot")>();
  return {
    ...actual,
    autopilotRun: (...a: unknown[]) => autopilotRun(...(a as [])),
  };
});

// The provider runAi resolves for this call. Overridable per test: the tool
// loops build `new Anthropic()` directly, so a non-Anthropic provider must be
// refused at the boundary rather than POSTed to api.anthropic.com.
let resolvedProvider = "anthropic";

// runAi just runs the callback (metering exercised in the gateway's own test).
vi.mock("@/lib/ai/gateway", () => ({
  runAi: async (
    _args: unknown,
    fn: (r: {
      apiKey: string;
      provider: string;
      model: ReturnType<typeof fakeResolvedModel>;
    }) => Promise<{ result: unknown }>,
  ) =>
    (
      await fn({
        apiKey: "k",
        provider: resolvedProvider,
        model: fakeResolvedModel(),
      })
    ).result,
}));

import { POST } from "./route";

function req(body: string, sig: string) {
  return new Request("http://localhost/api/ai/autopilot", {
    method: "POST",
    body,
    headers: { "content-type": "application/json", "x-pulse-signature": sig },
  });
}

const enabledAgent = () => ({
  id: AGENT,
  org_id: ORG,
  board_id: BOARD,
  enabled: true,
  cadence: "daily",
  run_at_local_hour: 8,
  config: { tasks: ["triage"] },
  created_by: "00000000-0000-4000-8000-0000000000f9",
});

const signed = () => {
  const body = JSON.stringify({
    agent_id: AGENT,
    fire_date: FIRE_DATE,
    fire_hour: FIRE_HOUR,
  });
  return { body, sig: signBody(body, SECRET) };
};

beforeEach(() => {
  resolvedProvider = "anthropic";
  process.env.AI_PGNET_HMAC_SECRET = SECRET;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "svc-role-key";
  rpcCalls.length = 0;
  runInserts.length = 0;
  agentRow = enabledAgent();
  existingRun = null;
  requireAiEntitlement.mockReset();
  requireAiEntitlement.mockResolvedValue(undefined);
  buildAgentContext.mockClear();
  autopilotRun.mockClear();
  autopilotRun.mockResolvedValue({
    actions: [
      { itemId: ITEM, action: { type: "move_to_group", groupId: GRP } },
    ],
    warnings: [],
    usage: { inputTokens: 5, outputTokens: 2 },
  });
});

describe("POST /api/ai/autopilot", () => {
  it("rejects an unsigned body with 401 and does no work", async () => {
    const { body } = signed();
    const res = await POST(req(body, ""));
    expect(res.status).toBe(401);
    expect(autopilotRun).not.toHaveBeenCalled();
    expect(rpcCalls).toHaveLength(0);
  });

  it("rejects a tampered body with 401", async () => {
    const { sig } = signed();
    const res = await POST(
      req(JSON.stringify({ agent_id: AGENT, fire_date: "2026-01-01" }), sig),
    );
    expect(res.status).toBe(401);
    expect(autopilotRun).not.toHaveBeenCalled();
  });

  it("applies each chosen action ONLY via board_agent_apply and writes ONE run row", async () => {
    const { body, sig } = signed();
    const res = await POST(req(body, sig));
    expect(res.status).toBe(200);
    expect(autopilotRun).toHaveBeenCalledOnce();
    const applies = rpcCalls.filter((c) => c.fn === "board_agent_apply");
    expect(applies).toHaveLength(1);
    expect(applies[0]!.args).toEqual({
      p_agent: AGENT,
      p_item: ITEM,
      p_action: { type: "move_to_group", groupId: GRP },
    });
    expect(runInserts).toHaveLength(1);
    expect(runInserts[0]).toMatchObject({
      board_agent_id: AGENT,
      fire_date: FIRE_DATE,
      status: "ran",
    });
  });

  it("attributes model usage + comment authorship to the platform bot", async () => {
    const { body, sig } = signed();
    await POST(req(body, sig));
    // The bot id is resolved for truthful attribution (runAi userId + authorship).
    expect(rpcCalls.some((c) => c.fn === "platform_agent_user_id")).toBe(true);
  });

  // ── the tool-loop capability boundary ─────────────────────────────────
  // These loops build `new Anthropic({ apiKey })` directly and ignore baseUrl,
  // so a non-Anthropic key must be refused HERE. Since per_user mode resolves
  // `provider ?? org default ?? anthropic`, an org that sets a non-Anthropic
  // default would otherwise POST that provider's key and model id to
  // api.anthropic.com.
  it("refuses a non-Anthropic provider before the loop spends the key", async () => {
    resolvedProvider = "moonshotai";
    const { body, sig } = signed();
    const res = await POST(req(body, sig));
    expect(res.status).toBe(500);
    expect(autopilotRun).not.toHaveBeenCalled();
    expect(rpcCalls.some((c) => c.fn === "board_agent_apply")).toBe(false);
    expect(runInserts[0]).toMatchObject({
      status: "error",
      error: "The configured AI provider can't run autopilot_run.",
    });
  });

  it("short-circuits to a skipped run with NO token spend when entitlement is off", async () => {
    requireAiEntitlement.mockRejectedValue(new AiDisabledError());
    const { body, sig } = signed();
    const res = await POST(req(body, sig));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ status: "skipped" });
    expect(autopilotRun).not.toHaveBeenCalled();
    expect(rpcCalls.some((c) => c.fn === "board_agent_apply")).toBe(false);
    expect(runInserts[0]).toMatchObject({ status: "skipped" });
  });

  it("is a no-op on redelivery (a run already exists for this fire date)", async () => {
    existingRun = { id: "run-1" };
    const { body, sig } = signed();
    const res = await POST(req(body, sig));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ status: "noop" });
    expect(autopilotRun).not.toHaveBeenCalled();
    expect(runInserts).toHaveLength(0);
  });

  it("skips a disabled agent (kill switch) without spending tokens", async () => {
    agentRow = { ...enabledAgent(), enabled: false };
    const { body, sig } = signed();
    const res = await POST(req(body, sig));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ status: "skipped" });
    expect(autopilotRun).not.toHaveBeenCalled();
  });

  it("404s when the agent does not exist", async () => {
    agentRow = null;
    const { body, sig } = signed();
    const res = await POST(req(body, sig));
    expect(res.status).toBe(404);
  });
});
