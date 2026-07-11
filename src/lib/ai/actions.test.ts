import { describe, expect, it, vi, beforeEach } from "vitest";

import {
  AiNotConfiguredError,
  AiDisabledError,
  AiQuotaExceededError,
  ByoKeyMissingError,
} from "@/lib/ai/errors";

const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ rpc })),
}));

const getBoardPayload = vi.fn();
const listMyBoards = vi.fn();
vi.mock("@/lib/boards/queries", () => ({
  getBoardPayload: (...args: unknown[]) => getBoardPayload(...args),
  listMyBoards: (...args: unknown[]) => listMyBoards(...args),
}));

const generateProposal = vi.fn();
vi.mock("@/lib/ai/generate", () => ({
  generateProposal: (...args: unknown[]) => generateProposal(...args),
}));

// The gateway resolver is faked: runAi invokes its callback with a resolved
// adapter+key (as the real gateway would) and returns the callback's result,
// so the action's proposal still flows through the metered path in tests.
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
const requireUser = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  getUserOrgs: (...args: unknown[]) => getUserOrgs(...args),
  requireUser: (...args: unknown[]) => requireUser(...args),
}));

const updateTag = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  updateTag: (tag: string) => updateTag(tag),
}));

const BOARD_ID = "33333333-3333-4333-8333-333333333333";
const STATUS_COL = "44444444-4444-4444-8444-444444444444";
const ORG_ID = "55555555-5555-4555-8555-555555555555";
const USER_ID = "66666666-6666-4666-8666-666666666666";

/** A board payload with one status column. `items`/`cells` are caller-supplied. */
function payload(
  items: { id: string }[],
  cells: { item_id: string; column_id: string; value: unknown }[] = [],
) {
  return {
    board: { id: BOARD_ID, name: "Sprint Board" },
    columns: [
      {
        id: STATUS_COL,
        name: "Status",
        kind: "status",
        settings: {
          options: [
            { id: "opt-done", label: "Done", color: "green" },
            { id: "opt-wip", label: "WIP", color: "orange" },
          ],
        },
      },
    ],
    items,
    cellValues: cells,
  };
}

beforeEach(() => {
  rpc.mockReset();
  getBoardPayload.mockReset();
  listMyBoards.mockReset();
  generateProposal.mockReset();
  updateTag.mockReset();
  requireAiEntitlement.mockReset();
  requireAiEntitlement.mockResolvedValue(undefined);
  getUserOrgs.mockReset();
  getUserOrgs.mockResolvedValue([
    { id: ORG_ID, name: "Acme", timezone: "UTC" },
  ]);
  requireUser.mockReset();
  requireUser.mockResolvedValue({ id: USER_ID });
  runAi.mockClear();
  runAi.mockImplementation(async (_args, fn) => {
    const { result } = await fn(FAKE_RESOLVED);
    return result;
  });
});

describe("generateDashboardProposal", () => {
  it("fails with the empty-board message when there are 0 rows (no LLM call)", async () => {
    getBoardPayload.mockResolvedValueOnce(payload([]));
    const { generateDashboardProposal } = await import("@/lib/ai/actions");
    const res = await generateDashboardProposal({ boardId: BOARD_ID });
    expect(res.ok).toBe(false);
    if (!res.ok)
      expect(res.error).toBe(
        "This board has no data to build a dashboard from yet.",
      );
    expect(generateProposal).not.toHaveBeenCalled();
  });

  it("maps a good generated proposal through validateProposal and returns it", async () => {
    getBoardPayload.mockResolvedValueOnce(
      payload(
        [{ id: "item-1" }, { id: "item-2" }],
        [
          {
            item_id: "item-1",
            column_id: STATUS_COL,
            value: { optionId: "opt-done" },
          },
          {
            item_id: "item-2",
            column_id: STATUS_COL,
            value: { optionId: "opt-wip" },
          },
        ],
      ),
    );
    generateProposal.mockResolvedValueOnce({
      proposal: {
        name: "Sprint Overview",
        widgets: [
          {
            kind: "battery",
            title: "Status",
            config: { groupColumnId: STATUS_COL },
            layout: { x: 0, y: 0, w: 4, h: 4 },
          },
        ],
      },
      usage: { inputTokens: 10, outputTokens: 5 },
    });
    const { generateDashboardProposal } = await import("@/lib/ai/actions");
    const res = await generateDashboardProposal({ boardId: BOARD_ID });
    expect(generateProposal).toHaveBeenCalledOnce();
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.proposal.name).toBe("Sprint Overview");
      expect(res.data.proposal.widgets).toHaveLength(1);
      expect(res.data.proposal.widgets[0].kind).toBe("battery");
    }
    // Entitlement is checked for the active org + feature...
    expect(requireAiEntitlement).toHaveBeenCalledWith(ORG_ID, "dashboard_gen");
    // ...BEFORE any provider work runs.
    expect(requireAiEntitlement.mock.invocationCallOrder[0]).toBeLessThan(
      generateProposal.mock.invocationCallOrder[0],
    );
    // The proposal flows through the metered gateway, scoped to org+user+feature.
    expect(runAi).toHaveBeenCalledOnce();
    expect(runAi.mock.calls[0][0]).toEqual({
      orgId: ORG_ID,
      userId: USER_ID,
      feature: "dashboard_gen",
    });
  });

  it("fails when the user has no organization (no entitlement / LLM call)", async () => {
    getBoardPayload.mockResolvedValueOnce(
      payload(
        [{ id: "item-1" }],
        [
          {
            item_id: "item-1",
            column_id: STATUS_COL,
            value: { optionId: "opt-done" },
          },
        ],
      ),
    );
    getUserOrgs.mockResolvedValueOnce([]);
    const { generateDashboardProposal } = await import("@/lib/ai/actions");
    const res = await generateDashboardProposal({ boardId: BOARD_ID });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("No organization.");
    expect(requireAiEntitlement).not.toHaveBeenCalled();
    expect(generateProposal).not.toHaveBeenCalled();
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
    "maps %s from requireAiEntitlement to its exact message",
    async (_name, makeError, message) => {
      getBoardPayload.mockResolvedValueOnce(
        payload(
          [{ id: "item-1" }],
          [
            {
              item_id: "item-1",
              column_id: STATUS_COL,
              value: { optionId: "opt-done" },
            },
          ],
        ),
      );
      requireAiEntitlement.mockRejectedValueOnce(makeError());
      const { generateDashboardProposal } = await import("@/lib/ai/actions");
      const res = await generateDashboardProposal({ boardId: BOARD_ID });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toBe(message);
      // Entitlement failed closed — no provider call.
      expect(runAi).not.toHaveBeenCalled();
    },
  );

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
  ])(
    "maps %s thrown from runAi to its exact message",
    async (_name, makeError, message) => {
      getBoardPayload.mockResolvedValueOnce(
        payload(
          [{ id: "item-1" }],
          [
            {
              item_id: "item-1",
              column_id: STATUS_COL,
              value: { optionId: "opt-done" },
            },
          ],
        ),
      );
      runAi.mockRejectedValueOnce(makeError());
      const { generateDashboardProposal } = await import("@/lib/ai/actions");
      const res = await generateDashboardProposal({ boardId: BOARD_ID });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toBe(message);
    },
  );

  it("returns the not-configured message when generateProposal throws AiNotConfiguredError", async () => {
    getBoardPayload.mockResolvedValueOnce(
      payload(
        [{ id: "item-1" }],
        [
          {
            item_id: "item-1",
            column_id: STATUS_COL,
            value: { optionId: "opt-done" },
          },
        ],
      ),
    );
    generateProposal.mockRejectedValueOnce(new AiNotConfiguredError());
    const { generateDashboardProposal } = await import("@/lib/ai/actions");
    const res = await generateDashboardProposal({ boardId: BOARD_ID });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("AI generation isn't configured.");
  });

  it("fails when the board is not found", async () => {
    getBoardPayload.mockResolvedValueOnce(null);
    const { generateDashboardProposal } = await import("@/lib/ai/actions");
    const res = await generateDashboardProposal({ boardId: BOARD_ID });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("Board not found.");
  });
});

describe("createDashboardFromProposal", () => {
  it("composes the three RPCs and returns the new id", async () => {
    rpc
      .mockResolvedValueOnce({
        data: { id: "dash-1", org_id: "org-9" },
        error: null,
      }) // create_dashboard
      .mockResolvedValueOnce({ data: { id: "w-1" }, error: null }) // create_dashboard_widget
      .mockResolvedValueOnce({ data: null, error: null }); // set_widget_layouts
    const { createDashboardFromProposal } = await import("@/lib/ai/actions");
    const res = await createDashboardFromProposal({
      workspaceId: "11111111-1111-4111-8111-111111111111",
      proposal: {
        name: "Sprint",
        sourceBoardId: "22222222-2222-4222-8222-222222222222",
        widgets: [
          {
            kind: "number",
            title: "Total",
            config: { agg: "count" },
            layout: { x: 0, y: 0, w: 3, h: 2 },
          },
        ],
      },
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.dashboardId).toBe("dash-1");
    expect(rpc.mock.calls[0][0]).toBe("create_dashboard");
    expect(rpc.mock.calls[1][0]).toBe("create_dashboard_widget");
    expect(rpc.mock.calls[2][0]).toBe("set_widget_layouts");
    // one create_dashboard_widget call per widget
    expect(
      rpc.mock.calls.filter((c) => c[0] === "create_dashboard_widget"),
    ).toHaveLength(1);
    // read-your-own-writes: invalidates the created dashboard's org list
    expect(updateTag).toHaveBeenCalledWith("dashboards:org:org-9");
  });

  it("fails with the RPC error message when create_dashboard errors", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "nope" } });
    const { createDashboardFromProposal } = await import("@/lib/ai/actions");
    const res = await createDashboardFromProposal({
      workspaceId: "11111111-1111-4111-8111-111111111111",
      proposal: {
        name: "Sprint",
        sourceBoardId: "22222222-2222-4222-8222-222222222222",
        widgets: [
          {
            kind: "number",
            title: "Total",
            config: { agg: "count" },
            layout: { x: 0, y: 0, w: 3, h: 2 },
          },
        ],
      },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("nope");
  });
});

describe("input validation (Zod at the boundary)", () => {
  it("getBoardSnapshotSummary rejects a non-uuid boardId before any query", async () => {
    const { getBoardSnapshotSummary } = await import("@/lib/ai/actions");
    const res = await getBoardSnapshotSummary({ boardId: "not-a-uuid" });
    expect(res.ok).toBe(false);
    expect(getBoardPayload).not.toHaveBeenCalled();
  });

  it("generateDashboardProposal rejects a non-uuid boardId", async () => {
    const { generateDashboardProposal } = await import("@/lib/ai/actions");
    const res = await generateDashboardProposal({ boardId: "nope" });
    expect(res.ok).toBe(false);
    expect(getBoardPayload).not.toHaveBeenCalled();
  });

  it("generateDashboardProposal rejects feedback longer than 2000 chars", async () => {
    const { generateDashboardProposal } = await import("@/lib/ai/actions");
    const res = await generateDashboardProposal({
      boardId: BOARD_ID,
      feedback: "x".repeat(2001),
    });
    expect(res.ok).toBe(false);
    // Never reaches the board fetch or the LLM.
    expect(getBoardPayload).not.toHaveBeenCalled();
    expect(generateProposal).not.toHaveBeenCalled();
  });

  it("createDashboardFromProposal rejects a widget whose config fails its kind schema", async () => {
    const { createDashboardFromProposal } = await import("@/lib/ai/actions");
    const res = await createDashboardFromProposal({
      workspaceId: "11111111-1111-4111-8111-111111111111",
      proposal: {
        name: "Sprint",
        sourceBoardId: "22222222-2222-4222-8222-222222222222",
        widgets: [
          {
            kind: "battery", // requires config.groupColumnId (uuid)
            title: "Broken",
            config: {}, // passes the generic record schema, fails the kind schema
            layout: { x: 0, y: 0, w: 3, h: 2 },
          },
        ],
      },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("Invalid widget config");
    // Nothing persisted.
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("listAiBoards", () => {
  it("maps workspace_id to workspaceId", async () => {
    listMyBoards.mockResolvedValueOnce([
      {
        id: "b-1",
        name: "Board",
        workspace_id: "ws-1",
        position: 0,
        shared_out: false,
      },
    ]);
    const { listAiBoards } = await import("@/lib/ai/actions");
    const res = await listAiBoards();
    expect(res.ok).toBe(true);
    if (res.ok)
      expect(res.data.boards).toEqual([
        { id: "b-1", name: "Board", workspaceId: "ws-1" },
      ]);
  });
});
