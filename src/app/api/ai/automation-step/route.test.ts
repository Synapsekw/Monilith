import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeResolvedModel } from "@/test/adapter-fakes";
import { signBody } from "@/lib/ai/agentic/hmac";
import { AiDisabledError } from "@/lib/ai/errors";

const SECRET = "test-hmac-secret-at-least-32-chars-long!!";
const ORG = "00000000-0000-4000-8000-0000000000f1";
const JOB = "00000000-0000-4000-8000-0000000000f2";
const COL = "00000000-0000-4000-8000-0000000000f3";
const OWNER = "00000000-0000-4000-8000-0000000000f4";

// ── module mocks ────────────────────────────────────────────────────────────
const rpcCalls: { fn: string; args: unknown }[] = [];
let jobRow: Record<string, unknown> | null;

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    from(table: string) {
      if (table === "automation_ai_jobs") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: jobRow, error: null }),
            }),
          }),
          update: () => ({ eq: async () => ({ error: null }) }),
        };
      }
      if (table === "automations") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { created_by: OWNER },
                error: null,
              }),
            }),
          }),
        };
      }
      return {};
    },
    rpc: async (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      return { error: null };
    },
  }),
}));

const requireAiEntitlement = vi.fn(async () => {});
vi.mock("@/lib/ai/entitlement", () => ({
  requireAiEntitlement: (...a: unknown[]) => requireAiEntitlement(...(a as [])),
}));

const buildJobContext = vi.fn(async () => ({
  columns: [],
  groups: [],
  members: [],
  item: null,
}));
vi.mock("@/lib/ai/agentic/context", () => ({
  buildJobContext: (...a: unknown[]) => buildJobContext(...(a as [])),
}));

type Decision = {
  action: { type: string; columnId: string; optionId: string } | null;
  warnings: string[];
  usage: { inputTokens: number; outputTokens: number };
};
const decideAction = vi.fn(
  async (): Promise<Decision> => ({
    action: { type: "set_option", columnId: COL, optionId: "opt-done" },
    warnings: [],
    usage: { inputTokens: 1, outputTokens: 1 },
  }),
);
vi.mock("@/lib/ai/agentic/decide", () => ({
  decideAction: (...a: unknown[]) => decideAction(...(a as [])),
}));

// runAi just runs the callback (metering is exercised in the gateway's own test).
vi.mock("@/lib/ai/gateway", () => ({
  runAi: async (
    _args: unknown,
    fn: (r: {
      apiKey: string;
      model: ReturnType<typeof fakeResolvedModel>;
    }) => Promise<{ result: unknown }>,
  ) => (await fn({ apiKey: "k", model: fakeResolvedModel() })).result,
}));

import { POST } from "./route";

function req(body: string, sig: string) {
  return new Request("http://localhost/api/ai/automation-step", {
    method: "POST",
    body,
    headers: { "content-type": "application/json", "x-pulse-signature": sig },
  });
}

const pendingJob = () => ({
  id: JOB,
  automation_id: "00000000-0000-4000-8000-0000000000f9",
  org_id: ORG,
  board_id: "00000000-0000-4000-8000-0000000000fa",
  item_id: "00000000-0000-4000-8000-0000000000fb",
  config: {
    type: "ai_step",
    instruction: "Mark it done",
    allow: ["set_option"],
  },
  status: "pending",
});

beforeEach(() => {
  process.env.AI_PGNET_HMAC_SECRET = SECRET;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "svc-role-key";
  rpcCalls.length = 0;
  jobRow = pendingJob();
  requireAiEntitlement.mockReset();
  requireAiEntitlement.mockResolvedValue(undefined);
  buildJobContext.mockClear();
  decideAction.mockClear();
  decideAction.mockResolvedValue({
    action: { type: "set_option", columnId: COL, optionId: "opt-done" },
    warnings: [],
    usage: { inputTokens: 1, outputTokens: 1 },
  });
});

describe("POST /api/ai/automation-step", () => {
  it("rejects an unsigned body with 401 and does no work", async () => {
    const body = JSON.stringify({ job_id: JOB });
    const res = await POST(req(body, ""));
    expect(res.status).toBe(401);
    expect(decideAction).not.toHaveBeenCalled();
    expect(rpcCalls).toHaveLength(0);
  });

  it("rejects a tampered body with 401", async () => {
    const sig = signBody(JSON.stringify({ job_id: JOB }), SECRET);
    const res = await POST(req(JSON.stringify({ job_id: "tampered" }), sig));
    expect(res.status).toBe(401);
    expect(decideAction).not.toHaveBeenCalled();
  });

  it("applies the chosen action ONLY via the confined RPC on a valid request", async () => {
    const body = JSON.stringify({ job_id: JOB });
    const res = await POST(req(body, signBody(body, SECRET)));
    expect(res.status).toBe(200);
    expect(decideAction).toHaveBeenCalledOnce();
    // The one and only write is the confined definer, with the chosen action.
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]!.fn).toBe("automation_ai_apply");
    expect(rpcCalls[0]!.args).toEqual({
      p_job: JOB,
      p_action: { type: "set_option", columnId: COL, optionId: "opt-done" },
    });
  });

  it("short-circuits to ai_skipped with NO token spend when entitlement is off", async () => {
    requireAiEntitlement.mockRejectedValue(new AiDisabledError());
    const body = JSON.stringify({ job_id: JOB });
    const res = await POST(req(body, signBody(body, SECRET)));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ status: "skipped" });
    // No decision was run (no token spend); the job is marked skipped via the RPC.
    expect(decideAction).not.toHaveBeenCalled();
    expect(rpcCalls).toEqual([
      { fn: "automation_ai_apply", args: { p_job: JOB, p_action: null } },
    ]);
  });

  it("applies null (ai_skipped) when the model declines to act", async () => {
    decideAction.mockResolvedValue({
      action: null,
      warnings: ["no valid choice"],
      usage: { inputTokens: 1, outputTokens: 0 },
    });
    const body = JSON.stringify({ job_id: JOB });
    const res = await POST(req(body, signBody(body, SECRET)));
    expect(res.status).toBe(200);
    expect(rpcCalls[0]!.args).toEqual({ p_job: JOB, p_action: null });
  });

  it("is a no-op on a non-pending job (idempotent redelivery)", async () => {
    jobRow = { ...pendingJob(), status: "done" };
    const body = JSON.stringify({ job_id: JOB });
    const res = await POST(req(body, signBody(body, SECRET)));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ status: "noop" });
    expect(decideAction).not.toHaveBeenCalled();
    expect(rpcCalls).toHaveLength(0);
  });

  it("404s when the job does not exist", async () => {
    jobRow = null;
    const body = JSON.stringify({ job_id: JOB });
    const res = await POST(req(body, signBody(body, SECRET)));
    expect(res.status).toBe(404);
  });
});
