import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ItemAssistWant } from "@/lib/ai/item-assist/schema";

// A resolved adapter+key, as the real gateway hands to runAi's callback.
// `id` is per-test so the not-capable branch is exercisable.
let FAKE_RESOLVED = {
  adapter: { id: "anthropic", supportsTools: true },
  apiKey: "k",
  mode: "managed",
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

const getBoardPayload = vi.fn();
vi.mock("@/lib/boards/queries", () => ({
  getBoardPayload: (...args: unknown[]) => getBoardPayload(...args),
}));

const generateItemAssistWithAi = vi.fn();
vi.mock("@/lib/ai/item-assist/assist", () => ({
  generateItemAssist: (...args: unknown[]) => generateItemAssistWithAi(...args),
}));

const validateItemAssist = vi.fn();
vi.mock("@/lib/ai/item-assist/validate", () => ({
  validateItemAssist: (...args: unknown[]) => validateItemAssist(...args),
}));

// The action must never touch these — it returns a proposal only, applying
// it is the client's job via the existing mutation actions.
const upsertCell = vi.fn();
vi.mock("@/lib/boards/actions/cell", () => ({
  upsertCell: (...args: unknown[]) => upsertCell(...args),
}));
const addSubitem = vi.fn();
vi.mock("@/lib/boards/actions/item", () => ({
  addSubitem: (...args: unknown[]) => addSubitem(...args),
}));

// Minimal chainable fake for the one query shape the action issues:
//   .from("items").select().eq().maybeSingle()
// Any other table/method throws, so an accidental write is a loud test
// failure rather than a silent no-op.
let ITEM_RESULT: { data: unknown; error: unknown } = {
  data: { id: "item-1", board_id: "board-1", name: "Ship it", parent_id: null },
  error: null,
};
const createClient = vi.fn(async () => ({
  from: (table: string) => {
    if (table === "items") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ITEM_RESULT,
          }),
        }),
      };
    }
    throw new Error(`unexpected table: ${table}`);
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClient(),
}));

const ITEM_ID = "11111111-1111-4111-8111-111111111111";
const TEXT_COL = "22222222-2222-4222-8222-222222222222";
const STATUS_COL = "33333333-3333-4333-8333-333333333333";

const BASE_PAYLOAD = {
  board: { id: "board-1", org_id: "org-1" },
  columns: [
    { id: TEXT_COL, kind: "text", settings: {} },
    {
      id: STATUS_COL,
      kind: "status",
      settings: {
        options: [
          { id: "opt-done", label: "Done", color: "#00c875" },
          { id: "opt-wip", label: "Working on it", color: "#fdab3d" },
        ],
      },
    },
  ],
  cellValues: [
    {
      item_id: ITEM_ID,
      column_id: TEXT_COL,
      board_id: "board-1",
      org_id: "org-1",
      value: { text: "Some notes about this item." },
      updated_at: "2026-01-01T00:00:00Z",
    },
  ],
};

beforeEach(() => {
  runAi.mockClear();
  requireAiEntitlement.mockReset();
  getUserOrgs.mockReset();
  requireUser.mockReset();
  getBoardPayload.mockReset();
  generateItemAssistWithAi.mockReset();
  validateItemAssist.mockReset();
  upsertCell.mockReset();
  addSubitem.mockReset();
  createClient.mockClear();

  FAKE_RESOLVED = {
    adapter: { id: "anthropic", supportsTools: true },
    apiKey: "k",
    mode: "managed",
    provider: "anthropic",
  };
  ITEM_RESULT = {
    data: {
      id: "item-1",
      board_id: "board-1",
      name: "Ship it",
      parent_id: null,
    },
    error: null,
  };

  requireUser.mockResolvedValue({ id: "user-1" });
  getUserOrgs.mockResolvedValue([{ id: "org-1", name: "Org" }]);
  getBoardPayload.mockResolvedValue(BASE_PAYLOAD);
  generateItemAssistWithAi.mockResolvedValue({
    proposal: { description: "A drafted description." },
    usage: { inputTokens: 10, outputTokens: 5 },
  });
  validateItemAssist.mockImplementation((proposal: unknown) => ({
    proposal,
    warnings: [],
  }));
});

describe("generateItemAssist action", () => {
  it("rejects a non-uuid itemId before any work", async () => {
    const { generateItemAssist } = await import("@/lib/ai/item-assist/actions");
    const res = await generateItemAssist({
      itemId: "not-a-uuid",
      want: { subtasks: true },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("Invalid request.");
    expect(requireUser).not.toHaveBeenCalled();
    expect(requireAiEntitlement).not.toHaveBeenCalled();
  });

  it("rejects an empty want before any work", async () => {
    const { generateItemAssist } = await import("@/lib/ai/item-assist/actions");
    const res = await generateItemAssist({ itemId: ITEM_ID, want: {} });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("Invalid request.");
    expect(requireUser).not.toHaveBeenCalled();
  });

  it("gates on entitlement before invoking runAi or reading the item", async () => {
    const { generateItemAssist } = await import("@/lib/ai/item-assist/actions");
    await generateItemAssist({ itemId: ITEM_ID, want: { subtasks: true } });
    expect(requireAiEntitlement).toHaveBeenCalledWith("org-1", "item_assist");
    expect(requireAiEntitlement.mock.invocationCallOrder[0]).toBeLessThan(
      runAi.mock.invocationCallOrder[0],
    );
    expect(requireAiEntitlement.mock.invocationCallOrder[0]).toBeLessThan(
      createClient.mock.invocationCallOrder[0],
    );
  });

  it("returns 'Item not found.' when the item row is missing, and never calls runAi", async () => {
    ITEM_RESULT = { data: null, error: null };
    const { generateItemAssist } = await import("@/lib/ai/item-assist/actions");
    const res = await generateItemAssist({
      itemId: ITEM_ID,
      want: { subtasks: true },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("Item not found.");
    expect(runAi).not.toHaveBeenCalled();
  });

  it("rejects subtasks requested on a subitem, and never calls runAi", async () => {
    ITEM_RESULT = {
      data: {
        id: "item-1",
        board_id: "board-1",
        name: "Sub thing",
        parent_id: "parent-item-1",
      },
      error: null,
    };
    const { generateItemAssist } = await import("@/lib/ai/item-assist/actions");
    const res = await generateItemAssist({
      itemId: ITEM_ID,
      want: { subtasks: true },
    });
    expect(res.ok).toBe(false);
    if (!res.ok)
      expect(res.error).toBe("Subtasks can't be added to a subitem.");
    expect(runAi).not.toHaveBeenCalled();
  });

  it("rejects a description target that isn't a text column, and never calls runAi", async () => {
    const { generateItemAssist } = await import("@/lib/ai/item-assist/actions");
    const res = await generateItemAssist({
      itemId: ITEM_ID,
      want: { description: { columnId: STATUS_COL } },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("Pick a text column to draft into.");
    expect(runAi).not.toHaveBeenCalled();
  });

  it("rejects a status target that isn't a status/dropdown column, and never calls runAi", async () => {
    const { generateItemAssist } = await import("@/lib/ai/item-assist/actions");
    const res = await generateItemAssist({
      itemId: ITEM_ID,
      want: { status: { columnId: TEXT_COL } },
    });
    expect(res.ok).toBe(false);
    if (!res.ok)
      expect(res.error).toBe("Pick a status column to propose into.");
    expect(runAi).not.toHaveBeenCalled();
  });

  it("maps a not-capable provider to the Anthropic-specific copy and never calls the lib", async () => {
    FAKE_RESOLVED = {
      adapter: { id: "openai", supportsTools: false },
      apiKey: "k",
      mode: "managed",
      provider: "openai",
    };
    const { generateItemAssist } = await import("@/lib/ai/item-assist/actions");
    const res = await generateItemAssist({
      itemId: ITEM_ID,
      want: { subtasks: true },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("AI assist needs an Anthropic key.");
    expect(generateItemAssistWithAi).not.toHaveBeenCalled();
  });

  it("maps a typed AiQuotaExceededError to its copy", async () => {
    const { AiQuotaExceededError } = await import("@/lib/ai/errors");
    requireAiEntitlement.mockRejectedValue(new AiQuotaExceededError());
    const { generateItemAssist } = await import("@/lib/ai/item-assist/actions");
    const res = await generateItemAssist({
      itemId: ITEM_ID,
      want: { subtasks: true },
    });
    expect(res.ok).toBe(false);
    if (!res.ok)
      expect(res.error).toBe("You've used this month's AI allowance.");
    expect(runAi).not.toHaveBeenCalled();
  });

  it("returns a proposal + warnings on the happy path, using the resolved text column and status options, and never touches upsertCell/addSubitem", async () => {
    validateItemAssist.mockReturnValue({
      proposal: { description: "A drafted description." },
      warnings: ["Dropped status: option not valid"],
    });
    const { generateItemAssist } = await import("@/lib/ai/item-assist/actions");
    const res = await generateItemAssist({
      itemId: ITEM_ID,
      want: { description: { columnId: TEXT_COL } },
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.proposal).toEqual({
        description: "A drafted description.",
      });
      expect(res.data.warnings).toEqual(["Dropped status: option not valid"]);
    }
    expect(generateItemAssistWithAi).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "k",
        item: {
          name: "Ship it",
          textContext: "Some notes about this item.",
        },
        want: { description: { columnId: TEXT_COL } },
      }),
    );
    expect(upsertCell).not.toHaveBeenCalled();
    expect(addSubitem).not.toHaveBeenCalled();
  });

  it("resolves the description/status column via the top-level targetColumnId convenience alias", async () => {
    const { generateItemAssist } = await import("@/lib/ai/item-assist/actions");
    // A caller that omits the nested columnId (e.g. untyped/JS boundary) is
    // still valid at the runtime (Zod) boundary — cast past the stricter
    // compile-time ItemAssistWant to exercise that fallback deliberately.
    const want = { description: {} } as unknown as ItemAssistWant;
    const res = await generateItemAssist({
      itemId: ITEM_ID,
      want,
      targetColumnId: TEXT_COL,
    });
    expect(res.ok).toBe(true);
    expect(generateItemAssistWithAi).toHaveBeenCalledWith(
      expect.objectContaining({
        want: { description: { columnId: TEXT_COL } },
      }),
    );
  });

  it("passes statusOptions and statusOptionIds through to generation and validation for a status want", async () => {
    const { generateItemAssist } = await import("@/lib/ai/item-assist/actions");
    generateItemAssistWithAi.mockResolvedValue({
      proposal: { status: { columnId: STATUS_COL, optionId: "opt-done" } },
      usage: { inputTokens: 10, outputTokens: 5 },
    });
    await generateItemAssist({
      itemId: ITEM_ID,
      want: { status: { columnId: STATUS_COL } },
    });
    expect(generateItemAssistWithAi).toHaveBeenCalledWith(
      expect.objectContaining({
        statusOptions: [
          { id: "opt-done", label: "Done" },
          { id: "opt-wip", label: "Working on it" },
        ],
      }),
    );
    expect(validateItemAssist).toHaveBeenCalledWith(
      { status: { columnId: STATUS_COL, optionId: "opt-done" } },
      { statusOptionIds: new Set(["opt-done", "opt-wip"]) },
    );
  });
});
