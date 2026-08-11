import { describe, expect, it, vi, beforeEach } from "vitest";
import { fakeResolvedModel } from "@/test/adapter-fakes";

// The AI gateway is mocked for the WHOLE suite: `runAi` never resolves a real
// provider key and never bills a credit — it just hands the callback a fake
// `{ apiKey }` and returns whatever the callback's `result` is. Combined with
// the `./decide` mock below (the only module that constructs an Anthropic
// client), no test in this file can reach a live model.
// The provider runAi resolves for this call. Overridable per test: the tool
// loops build `new Anthropic()` directly, so a non-Anthropic provider must be
// refused at the boundary rather than POSTed to api.anthropic.com.
let resolvedProvider = "anthropic";

const runAi = vi.fn(
  async (
    _args: { orgId: string; userId: string; feature: string },
    fn: (resolved: {
      apiKey: string;
      provider: string;
      model: ReturnType<typeof fakeResolvedModel>;
    }) => Promise<{ result: unknown }>,
  ) => {
    const { result } = await fn({
      apiKey: "test-key",
      provider: resolvedProvider,
      model: fakeResolvedModel(),
    });
    return result;
  },
);
vi.mock("@/lib/ai/gateway", () => ({
  runAi: (...args: unknown[]) =>
    (runAi as unknown as (...a: unknown[]) => unknown)(...args),
}));

const requireAiEntitlement = vi.fn();
vi.mock("@/lib/ai/entitlement", () => ({
  requireAiEntitlement: (...args: unknown[]) => requireAiEntitlement(...args),
}));

const resolveActiveOrg = vi.fn();
vi.mock("@/lib/org/active", () => ({
  resolveActiveOrg: (...args: unknown[]) => resolveActiveOrg(...args),
}));

const requireUser = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  requireUser: (...args: unknown[]) => requireUser(...args),
}));

// decide.ts owns the Anthropic client. Mocking it is what guarantees the
// decision loop is never actually run against a model.
const decideAction = vi.fn();
vi.mock("./decide", () => ({
  decideAction: (...args: unknown[]) => decideAction(...args),
}));

const buildJobContext = vi.fn();
vi.mock("./context", () => ({
  buildJobContext: (...args: unknown[]) => buildJobContext(...args),
}));

// Minimal chainable fake for the two reads the action issues:
//   .from("boards").select().eq().maybeSingle()
//   .from("items").select().eq().is().order().limit().maybeSingle()
function chain(result: { data: unknown; error: unknown }) {
  const node = {
    eq: () => node,
    is: () => node,
    order: () => node,
    limit: () => node,
    maybeSingle: async () => result,
  };
  return node;
}

let BOARD_RESULT: { data: unknown; error: unknown } = {
  data: null,
  error: null,
};
let ITEM_RESULT: { data: unknown; error: unknown } = {
  data: null,
  error: null,
};

const createServiceClient = vi.fn(() => ({
  from: (table: string) => {
    if (table === "boards") return { select: () => chain(BOARD_RESULT) };
    if (table === "items") return { select: () => chain(ITEM_RESULT) };
    throw new Error(`unexpected table: ${table}`);
  },
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => createServiceClient(),
}));

const ORG_ID = "0e000000-0000-4000-8000-000000000001";
const BOARD_ID = "b0000000-0000-4000-8000-000000000002";
const ITEM_ID = "17000000-0000-4000-8000-000000000003";
const OTHER_ORG_ID = "0e000000-0000-4000-8000-000000000009";

const CONTEXT = { columns: [], groups: [], members: [], item: null };
const CHOSEN = { type: "move_to_group", groupId: "g1" };

const validInput = () => ({
  boardId: BOARD_ID,
  instruction: "  Move stale items to Done  ",
  allow: ["move_to_group", "notify"],
});

beforeEach(() => {
  resolvedProvider = "anthropic";
  runAi.mockClear();
  requireAiEntitlement.mockReset();
  resolveActiveOrg.mockReset();
  requireUser.mockReset();
  decideAction.mockReset();
  buildJobContext.mockReset();
  createServiceClient.mockClear();

  resolveActiveOrg.mockResolvedValue({ id: ORG_ID, name: "Org" });
  requireUser.mockResolvedValue({ id: "user-1" });
  buildJobContext.mockResolvedValue(CONTEXT);
  decideAction.mockResolvedValue({
    action: CHOSEN,
    warnings: [],
    usage: { inputTokens: 10, outputTokens: 5 },
  });

  BOARD_RESULT = { data: { id: BOARD_ID, org_id: ORG_ID }, error: null };
  ITEM_RESULT = { data: { id: ITEM_ID, name: "Widget A" }, error: null };
});

describe("previewAiStep — input validation", () => {
  it("rejects a malformed board id before any org, DB or model work", async () => {
    const { previewAiStep } = await import("./actions");
    const res = await previewAiStep({ ...validInput(), boardId: "not-a-uuid" });
    expect(res.ok).toBe(false);
    if (!res.ok)
      expect(res.error).toBe(
        "Add an instruction (3-500 chars) and at least one allowed action.",
      );
    expect(resolveActiveOrg).not.toHaveBeenCalled();
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(runAi).not.toHaveBeenCalled();
    expect(decideAction).not.toHaveBeenCalled();
  });

  it("rejects a too-short instruction", async () => {
    const { previewAiStep } = await import("./actions");
    const res = await previewAiStep({ ...validInput(), instruction: "hi" });
    expect(res.ok).toBe(false);
    expect(runAi).not.toHaveBeenCalled();
  });

  it("rejects an empty allow set", async () => {
    const { previewAiStep } = await import("./actions");
    const res = await previewAiStep({ ...validInput(), allow: [] });
    expect(res.ok).toBe(false);
    expect(runAi).not.toHaveBeenCalled();
  });

  it("rejects an action outside the reversible vocabulary", async () => {
    const { previewAiStep } = await import("./actions");
    const res = await previewAiStep({
      ...validInput(),
      allow: ["call_webhook"],
    });
    expect(res.ok).toBe(false);
    expect(runAi).not.toHaveBeenCalled();
    expect(decideAction).not.toHaveBeenCalled();
  });
});

describe("previewAiStep — gating", () => {
  it("fails with no DB read when there is no active org", async () => {
    resolveActiveOrg.mockResolvedValue(null);
    const { previewAiStep } = await import("./actions");
    const res = await previewAiStep(validInput());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("No organization.");
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(runAi).not.toHaveBeenCalled();
  });

  it("gates on entitlement before any token spend", async () => {
    const { previewAiStep } = await import("./actions");
    await previewAiStep(validInput());
    expect(requireAiEntitlement).toHaveBeenCalledWith(
      ORG_ID,
      "automation_ai_step",
    );
    expect(requireAiEntitlement.mock.invocationCallOrder[0]).toBeLessThan(
      runAi.mock.invocationCallOrder[0]!,
    );
  });

  it("fails when the board belongs to another org", async () => {
    BOARD_RESULT = {
      data: { id: BOARD_ID, org_id: OTHER_ORG_ID },
      error: null,
    };
    const { previewAiStep } = await import("./actions");
    const res = await previewAiStep(validInput());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("Board not found.");
    expect(runAi).not.toHaveBeenCalled();
    expect(decideAction).not.toHaveBeenCalled();
  });

  it("fails when the board does not exist", async () => {
    BOARD_RESULT = { data: null, error: null };
    const { previewAiStep } = await import("./actions");
    const res = await previewAiStep(validInput());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("Board not found.");
    expect(runAi).not.toHaveBeenCalled();
  });

  it("returns an empty preview without calling the model on an empty board", async () => {
    ITEM_RESULT = { data: null, error: null };
    const { previewAiStep } = await import("./actions");
    const res = await previewAiStep(validInput());
    expect(res).toEqual({
      ok: true,
      data: { action: null, warnings: [], sampleItem: null },
    });
    expect(buildJobContext).not.toHaveBeenCalled();
    expect(runAi).not.toHaveBeenCalled();
    expect(decideAction).not.toHaveBeenCalled();
  });
});

describe("previewAiStep — happy path", () => {
  it("delegates to decideAction with the PARSED values and the gateway key", async () => {
    const { previewAiStep } = await import("./actions");
    const res = await previewAiStep(validInput());

    expect(runAi).toHaveBeenCalledWith(
      { orgId: ORG_ID, userId: "user-1", feature: "automation_ai_step" },
      expect.any(Function),
    );
    expect(buildJobContext).toHaveBeenCalledWith(expect.anything(), {
      orgId: ORG_ID,
      boardId: BOARD_ID,
      itemId: ITEM_ID,
    });
    expect(decideAction).toHaveBeenCalledWith({
      apiKey: "test-key",
      // The WIRE id runAi resolved — never the catalog key.
      model: "claude-sonnet-5-20260101",
      context: CONTEXT,
      // Zod `.trim()` ran: the padded instruction is passed trimmed.
      instruction: "Move stale items to Done",
      allow: ["move_to_group", "notify"],
    });
    expect(res).toEqual({
      ok: true,
      data: {
        action: CHOSEN,
        warnings: [],
        sampleItem: { id: ITEM_ID, name: "Widget A" },
      },
    });
  });

  // ── the tool-loop capability boundary ─────────────────────────────────
  // These loops build `new Anthropic({ apiKey })` directly and ignore baseUrl,
  // so a non-Anthropic key must be refused HERE. Since per_user mode resolves
  // `provider ?? org default ?? anthropic`, an org that sets a non-Anthropic
  // default would otherwise POST that provider's key and model id to
  // api.anthropic.com.
  it("refuses a non-Anthropic provider before the loop spends the key", async () => {
    resolvedProvider = "google";
    const { previewAiStep } = await import("./actions");
    const res = await previewAiStep(validInput());
    expect(res).toEqual({
      ok: false,
      error: "This step needs an Anthropic key — see Settings → AI.",
    });
    expect(decideAction).not.toHaveBeenCalled();
  });

  it("surfaces the decision loop's warnings and a null action", async () => {
    decideAction.mockResolvedValue({
      action: null,
      warnings: ['group "g9" is not on this board'],
      usage: { inputTokens: 1, outputTokens: 1 },
    });
    const { previewAiStep } = await import("./actions");
    const res = await previewAiStep(validInput());
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.action).toBeNull();
      expect(res.data.warnings).toEqual(['group "g9" is not on this board']);
      expect(res.data.sampleItem).toEqual({ id: ITEM_ID, name: "Widget A" });
    }
  });
});

describe("previewAiStep — collaborator failures", () => {
  it("surfaces a decideAction throw as a generic ok:false", async () => {
    decideAction.mockRejectedValue(new Error("model exploded"));
    const { previewAiStep } = await import("./actions");
    const res = await previewAiStep(validInput());
    expect(res).toEqual({
      ok: false,
      error: "Couldn't test the step. Please try again.",
    });
  });

  it("surfaces a buildJobContext throw as a generic ok:false", async () => {
    buildJobContext.mockRejectedValue(new Error("db down"));
    const { previewAiStep } = await import("./actions");
    const res = await previewAiStep(validInput());
    expect(res.ok).toBe(false);
    if (!res.ok)
      expect(res.error).toBe("Couldn't test the step. Please try again.");
    expect(decideAction).not.toHaveBeenCalled();
  });

  it("maps AiDisabledError to its copy without invoking the gateway", async () => {
    const { AiDisabledError } = await import("@/lib/ai/errors");
    requireAiEntitlement.mockRejectedValue(new AiDisabledError());
    const { previewAiStep } = await import("./actions");
    const res = await previewAiStep(validInput());
    expect(res.ok).toBe(false);
    if (!res.ok)
      expect(res.error).toBe("AI is turned off for your organization.");
    expect(runAi).not.toHaveBeenCalled();
  });

  it("maps AiQuotaExceededError to its copy", async () => {
    const { AiQuotaExceededError } = await import("@/lib/ai/errors");
    requireAiEntitlement.mockRejectedValue(new AiQuotaExceededError());
    const { previewAiStep } = await import("./actions");
    const res = await previewAiStep(validInput());
    expect(res.ok).toBe(false);
    if (!res.ok)
      expect(res.error).toBe("You've used this month's AI allowance.");
  });

  it("maps ByoKeyMissingError raised by the gateway to its copy", async () => {
    const { ByoKeyMissingError } = await import("@/lib/ai/errors");
    runAi.mockRejectedValueOnce(new ByoKeyMissingError());
    const { previewAiStep } = await import("./actions");
    const res = await previewAiStep(validInput());
    expect(res.ok).toBe(false);
    if (!res.ok)
      expect(res.error).toBe(
        "Your organization's AI key is missing — ask an admin.",
      );
  });

  it("maps AiNotConfiguredError raised by the gateway to its copy", async () => {
    const { AiNotConfiguredError } = await import("@/lib/ai/errors");
    runAi.mockRejectedValueOnce(new AiNotConfiguredError());
    const { previewAiStep } = await import("./actions");
    const res = await previewAiStep(validInput());
    expect(res.ok).toBe(false);
    if (!res.ok)
      expect(res.error).toBe("Add an AI provider key in Settings to use AI.");
  });
});
