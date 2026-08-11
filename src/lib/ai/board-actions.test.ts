import { describe, expect, it, vi, beforeEach } from "vitest";
import { fakeResolvedModel } from "@/test/adapter-fakes";
import {
  AiDisabledError,
  AiQuotaExceededError,
  ByoKeyMissingError,
  AiNotConfiguredError,
} from "@/lib/ai/errors";

const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ rpc })),
}));

const generateBoardProposalLLM = vi.fn();
vi.mock("@/lib/ai/board-generate", () => ({
  generateBoardProposal: (...args: unknown[]) =>
    generateBoardProposalLLM(...args),
}));

const FAKE_RESOLVED = {
  adapter: { kind: "anthropic" },
  apiKey: "k",
  mode: "managed",
  provider: "anthropic",
  baseUrl: null,
  model: fakeResolvedModel(),
};
const runAi = vi.fn(
  async (
    _args: { orgId: string; userId: string; feature: string },
    fn: (r: typeof FAKE_RESOLVED) => Promise<{ result: unknown }>,
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

const invalidateMyBoards = vi.fn();
vi.mock("@/lib/boards/actions/internal", () => ({
  invalidateMyBoards: (...args: unknown[]) => invalidateMyBoards(...args),
}));

const WS = "11111111-1111-4111-8111-111111111111";
const ORG = "55555555-5555-4555-8555-555555555555";
const USER = "66666666-6666-4666-8666-666666666666";

/** A raw model proposal that validates into a usable board. */
const RAW_PROPOSAL = {
  name: "CRM",
  groups: [{ tempId: "g1", name: "Leads" }],
  columns: [
    {
      tempId: "c1",
      name: "Status",
      kind: "status",
      options: [{ label: "New" }, { label: "Won" }],
    },
    { tempId: "c2", name: "Notes", kind: "text" },
  ],
  items: [
    {
      groupTempId: "g1",
      name: "Acme",
      cells: [{ columnTempId: "c1", value: { optionId: "New" } }],
    },
  ],
};

beforeEach(() => {
  rpc.mockReset();
  generateBoardProposalLLM.mockReset();
  generateBoardProposalLLM.mockResolvedValue({
    proposal: RAW_PROPOSAL,
    usage: { inputTokens: 5, outputTokens: 5 },
  });
  requireAiEntitlement.mockReset();
  requireAiEntitlement.mockResolvedValue(undefined);
  getUserOrgs.mockReset();
  getUserOrgs.mockResolvedValue([{ id: ORG, name: "Acme", timezone: "UTC" }]);
  requireUser.mockReset();
  requireUser.mockResolvedValue({ id: USER });
  invalidateMyBoards.mockReset();
  invalidateMyBoards.mockResolvedValue(undefined);
  runAi.mockClear();
  runAi.mockImplementation(async (_args, fn) => {
    const { result } = await fn(FAKE_RESOLVED);
    return result;
  });
});

describe("generateBoardProposal (action)", () => {
  it("gates entitlement before runAi and returns a validated proposal without persisting", async () => {
    const { generateBoardProposal } = await import("@/lib/ai/board-actions");
    const res = await generateBoardProposal({
      workspaceId: WS,
      prompt: "build me a CRM",
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.proposal.templatePayload.columns.length).toBeGreaterThan(
        0,
      );
      expect(res.data.proposal.name).toBe("CRM");
      expect(res.data.proposal.summary.columns.length).toBeGreaterThan(0);
    }
    // Entitlement gated for the right feature, BEFORE any provider work.
    expect(requireAiEntitlement).toHaveBeenCalledWith(ORG, "board_gen");
    expect(requireAiEntitlement.mock.invocationCallOrder[0]).toBeLessThan(
      generateBoardProposalLLM.mock.invocationCallOrder[0],
    );
    expect(runAi.mock.calls[0][0]).toEqual({
      orgId: ORG,
      userId: USER,
      feature: "board_gen",
    });
    // No persistence in the generate step.
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a blank prompt with no LLM call", async () => {
    const { generateBoardProposal } = await import("@/lib/ai/board-actions");
    const res = await generateBoardProposal({ workspaceId: WS, prompt: "" });
    expect(res.ok).toBe(false);
    expect(generateBoardProposalLLM).not.toHaveBeenCalled();
    expect(requireAiEntitlement).not.toHaveBeenCalled();
  });

  it("rejects a too-long prompt with no LLM call", async () => {
    const { generateBoardProposal } = await import("@/lib/ai/board-actions");
    const res = await generateBoardProposal({
      workspaceId: WS,
      prompt: "x".repeat(2001),
    });
    expect(res.ok).toBe(false);
    expect(generateBoardProposalLLM).not.toHaveBeenCalled();
  });

  it("fails with a clear message when the proposal has no usable columns", async () => {
    generateBoardProposalLLM.mockResolvedValueOnce({
      proposal: { name: "Empty", groups: [], columns: [], items: [] },
      usage: { inputTokens: 1, outputTokens: 1 },
    });
    const { generateBoardProposal } = await import("@/lib/ai/board-actions");
    const res = await generateBoardProposal({
      workspaceId: WS,
      prompt: "make something",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/couldn't generate/i);
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
    [
      "AiNotConfiguredError",
      () => new AiNotConfiguredError(),
      "AI generation isn't configured.",
    ],
  ])("maps %s to its exact message", async (_n, make, message) => {
    requireAiEntitlement.mockRejectedValueOnce(make());
    const { generateBoardProposal } = await import("@/lib/ai/board-actions");
    const res = await generateBoardProposal({
      workspaceId: WS,
      prompt: "a crm",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe(message);
  });
});

describe("createBoardFromProposal (action)", () => {
  const validProposal = {
    name: "CRM",
    templatePayload: {
      groups: [
        {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          name: "Leads",
          color: "#0073ea",
          position: 0,
        },
      ],
      columns: [
        {
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          kind: "text",
          name: "Notes",
          settings: {},
          position: 0,
        },
      ],
      items: [
        {
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          groupId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          name: "Acme",
          position: 0,
          cells: [
            {
              columnId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
              value: { text: "hi" },
            },
          ],
        },
      ],
    },
  };

  it("calls create_board_from_template once and returns the boardId", async () => {
    rpc.mockResolvedValueOnce({
      data: { id: "board-1", org_id: "org-9" },
      error: null,
    });
    const { createBoardFromProposal } = await import("@/lib/ai/board-actions");
    const res = await createBoardFromProposal({
      workspaceId: WS,
      proposal: validProposal,
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.boardId).toBe("board-1");
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc.mock.calls[0][0]).toBe("create_board_from_template");
    expect(rpc.mock.calls[0][1]).toMatchObject({
      p_workspace_id: WS,
      p_name: "CRM",
    });
    expect(rpc.mock.calls[0][1].p_template).toBeTruthy();
  });

  it("rejects a proposal whose cell value fails its column kind before persisting", async () => {
    const bad = {
      name: "CRM",
      templatePayload: {
        groups: validProposal.templatePayload.groups,
        columns: [
          {
            id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            kind: "numbers",
            name: "Estimate",
            settings: {},
            position: 0,
          },
        ],
        items: [
          {
            id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            groupId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            name: "Acme",
            position: 0,
            cells: [
              {
                columnId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                value: { n: "not-a-number" },
              },
            ],
          },
        ],
      },
    };
    const { createBoardFromProposal } = await import("@/lib/ai/board-actions");
    const res = await createBoardFromProposal({
      workspaceId: WS,
      proposal: bad,
    });
    expect(res.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns the RPC error message when the write fails", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "nope" } });
    const { createBoardFromProposal } = await import("@/lib/ai/board-actions");
    const res = await createBoardFromProposal({
      workspaceId: WS,
      proposal: validProposal,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("nope");
  });
});
