import { describe, expect, it, vi, beforeEach } from "vitest";

import {
  AiDisabledError,
  AiQuotaExceededError,
  ByoKeyMissingError,
  AiNotConfiguredError,
} from "@/lib/ai/errors";

const getBoardPayload = vi.fn();
vi.mock("@/lib/boards/queries", () => ({
  getBoardPayload: (...args: unknown[]) => getBoardPayload(...args),
}));

const listOrgMembersCached = vi.fn();
vi.mock("@/lib/org/queries-cached", () => ({
  listOrgMembersCached: (...args: unknown[]) => listOrgMembersCached(...args),
}));

const generateAutomationDraftLLM = vi.fn();
vi.mock("@/lib/ai/automation-generate", () => ({
  generateAutomationDraft: (...args: unknown[]) =>
    generateAutomationDraftLLM(...args),
}));

const FAKE_RESOLVED = {
  adapter: { defaultModel: "claude-opus-4-8", supportsTools: true },
  apiKey: "k",
  mode: "per_user",
  provider: "anthropic",
};
const runAi = vi.fn(
  async (
    _args: { orgId: string; userId: string; feature: string },
    fn: (resolved: typeof FAKE_RESOLVED) => Promise<{ result: unknown }>,
  ) => {
    const { result } = await fn(FAKE_RESOLVED);
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

const getUserOrgs = vi.fn();
vi.mock("@/lib/org/active", () => ({
  resolveActiveOrg: async () => (await getUserOrgs())[0] ?? null,
}));
const requireUser = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  getUserOrgs: (...args: unknown[]) => getUserOrgs(...args),
  requireUser: (...args: unknown[]) => requireUser(...args),
}));

const BOARD_ID = "33333333-3333-4333-8333-333333333333";
const ORG_ID = "55555555-5555-4555-8555-555555555555";
const USER_ID = "66666666-6666-4666-8666-666666666666";
const STATUS_COL = "44444444-4444-4444-8444-444444444444";
const PEOPLE_COL = "77777777-7777-4777-8777-777777777777";

function payload() {
  return {
    board: { id: BOARD_ID, name: "Sprint", org_id: ORG_ID },
    groups: [{ id: "88888888-8888-4888-8888-888888888888", name: "Done" }],
    columns: [
      {
        id: STATUS_COL,
        name: "Status",
        kind: "status",
        settings: {
          options: [{ id: "opt-done", label: "Done", color: "green" }],
        },
      },
      { id: PEOPLE_COL, name: "Owner", kind: "people", settings: {} },
    ],
  };
}

const goodRawDraft = {
  trigger: {
    type: "status_changed",
    columnId: STATUS_COL,
    toOptionId: "opt-done",
  },
  actions: [
    {
      type: "notify",
      recipient: { kind: "owner", peopleColumnId: PEOPLE_COL },
    },
  ],
};

beforeEach(() => {
  getBoardPayload.mockReset();
  getBoardPayload.mockResolvedValue(payload());
  listOrgMembersCached.mockReset();
  listOrgMembersCached.mockResolvedValue([]);
  generateAutomationDraftLLM.mockReset();
  generateAutomationDraftLLM.mockResolvedValue({
    draft: goodRawDraft,
    usage: { inputTokens: 10, outputTokens: 5 },
  });
  requireAiEntitlement.mockReset();
  requireAiEntitlement.mockResolvedValue(undefined);
  getUserOrgs.mockReset();
  getUserOrgs.mockResolvedValue([{ id: ORG_ID, name: "Acme" }]);
  requireUser.mockReset();
  requireUser.mockResolvedValue({ id: USER_ID });
  runAi.mockClear();
  runAi.mockImplementation(async (_args, fn) => {
    const { result } = await fn(FAKE_RESOLVED);
    return result;
  });
});

describe("generateAutomationDraft action", () => {
  it("gates entitlement BEFORE runAi and returns a validated draft (no persistence)", async () => {
    const { generateAutomationDraft } =
      await import("@/lib/ai/automation-gen-actions");
    const res = await generateAutomationDraft({
      boardId: BOARD_ID,
      prompt: "when status is done notify the owner",
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.draft.trigger).toEqual({
        type: "status_changed",
        columnId: STATUS_COL,
        toOptionId: "opt-done",
      });
      expect(res.data.draft.actions).toEqual([
        {
          type: "notify",
          recipient: { kind: "owner", peopleColumnId: PEOPLE_COL },
        },
      ]);
      expect(res.data.warnings).toEqual([]);
    }

    expect(requireAiEntitlement).toHaveBeenCalledWith(ORG_ID, "automation_gen");
    expect(requireAiEntitlement.mock.invocationCallOrder[0]).toBeLessThan(
      runAi.mock.invocationCallOrder[0],
    );
    expect(runAi).toHaveBeenCalledOnce();
    expect(runAi.mock.calls[0][0]).toEqual({
      orgId: ORG_ID,
      userId: USER_ID,
      feature: "automation_gen",
    });
  });

  it("returns the rephrase message when the draft validates to null", async () => {
    // Reference an unknown people column so the sole action drops → 0 actions.
    generateAutomationDraftLLM.mockResolvedValueOnce({
      draft: {
        trigger: { type: "item_created" },
        actions: [
          {
            type: "notify",
            recipient: {
              kind: "owner",
              peopleColumnId: "99999999-9999-4999-8999-999999999999",
            },
          },
        ],
      },
      usage: { inputTokens: 1, outputTokens: 1 },
    });
    const { generateAutomationDraft } =
      await import("@/lib/ai/automation-gen-actions");
    const res = await generateAutomationDraft({
      boardId: BOARD_ID,
      prompt: "do something impossible",
    });
    expect(res.ok).toBe(false);
    if (!res.ok)
      expect(res.error).toBe(
        "Couldn't turn that into an automation — try rephrasing.",
      );
  });

  it("rejects a too-short prompt before any work", async () => {
    const { generateAutomationDraft } =
      await import("@/lib/ai/automation-gen-actions");
    const res = await generateAutomationDraft({
      boardId: BOARD_ID,
      prompt: "x",
    });
    expect(res.ok).toBe(false);
    expect(requireAiEntitlement).not.toHaveBeenCalled();
    expect(runAi).not.toHaveBeenCalled();
  });

  it("rejects a non-uuid boardId before any work", async () => {
    const { generateAutomationDraft } =
      await import("@/lib/ai/automation-gen-actions");
    const res = await generateAutomationDraft({
      boardId: "nope",
      prompt: "notify the owner on done",
    });
    expect(res.ok).toBe(false);
    expect(getBoardPayload).not.toHaveBeenCalled();
  });

  it("fails when the user has no organization (no entitlement / LLM call)", async () => {
    getUserOrgs.mockResolvedValueOnce([]);
    const { generateAutomationDraft } =
      await import("@/lib/ai/automation-gen-actions");
    const res = await generateAutomationDraft({
      boardId: BOARD_ID,
      prompt: "notify the owner on done",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("No organization.");
    expect(requireAiEntitlement).not.toHaveBeenCalled();
    expect(runAi).not.toHaveBeenCalled();
  });

  it("fails when the board is not found", async () => {
    getBoardPayload.mockResolvedValueOnce(null);
    const { generateAutomationDraft } =
      await import("@/lib/ai/automation-gen-actions");
    const res = await generateAutomationDraft({
      boardId: BOARD_ID,
      prompt: "notify the owner on done",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("Board not found.");
    expect(runAi).not.toHaveBeenCalled();
  });

  it.each([
    [
      "AiDisabledError",
      () => new AiDisabledError(),
      "AI is turned off for your organization.",
    ],
    [
      "AiQuotaExceededError",
      () => new AiQuotaExceededError(),
      "You've used this month's AI allowance.",
    ],
    [
      "ByoKeyMissingError",
      () => new ByoKeyMissingError(),
      "Your organization's AI key is missing — ask an admin to update Settings.",
    ],
  ])(
    "maps %s from requireAiEntitlement to its exact message (fails closed)",
    async (_name, makeError, message) => {
      requireAiEntitlement.mockRejectedValueOnce(makeError());
      const { generateAutomationDraft } =
        await import("@/lib/ai/automation-gen-actions");
      const res = await generateAutomationDraft({
        boardId: BOARD_ID,
        prompt: "notify the owner on done",
      });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toBe(message);
      expect(runAi).not.toHaveBeenCalled();
    },
  );

  it("maps AiNotConfiguredError thrown from runAi to its message", async () => {
    runAi.mockRejectedValueOnce(new AiNotConfiguredError());
    const { generateAutomationDraft } =
      await import("@/lib/ai/automation-gen-actions");
    const res = await generateAutomationDraft({
      boardId: BOARD_ID,
      prompt: "notify the owner on done",
    });
    expect(res.ok).toBe(false);
    if (!res.ok)
      expect(res.error).toBe("Add an AI provider key in Settings to use AI.");
  });
});
