import { describe, expect, it, vi, beforeEach } from "vitest";

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

// classify.ts (the Anthropic call) is mocked — no network call in the suite.
// validate.ts is left real: it's pure join/cap logic and exercising the real
// implementation verifies actions.ts wires it correctly.
const classifyColumnWithAi = vi.fn();
vi.mock("@/lib/ai/column-fill/classify", () => ({
  classifyColumn: (...args: unknown[]) => classifyColumnWithAi(...args),
}));

const bulkSetCell = vi.fn();
vi.mock("@/lib/boards/bulk-actions", () => ({
  bulkSetCell: (...args: unknown[]) => bulkSetCell(...args),
}));

// Minimal chainable fake for the supabase query shapes the actions issue:
//   .from("columns").select().eq().eq().maybeSingle()   (classify: id + board_id)
//   .from("columns").select().eq().maybeSingle()         (apply: id only)
//   .from("cell_values").select().eq().limit()
//   .from("items").select().in()
function chain(result: { data: unknown; error: unknown }) {
  const node = {
    eq: () => node,
    limit: async () => result,
    in: async () => result,
    maybeSingle: async () => result,
  };
  return node;
}

let COLUMNS_RESULT: { data: unknown; error: unknown } = {
  data: null,
  error: null,
};
let CELLS_RESULT: { data: unknown[]; error: unknown } = {
  data: [],
  error: null,
};
let ITEMS_RESULT: { data: unknown[]; error: unknown } = {
  data: [],
  error: null,
};
const createClient = vi.fn(async () => ({
  from: (table: string) => {
    if (table === "columns") return { select: () => chain(COLUMNS_RESULT) };
    if (table === "cell_values") return { select: () => chain(CELLS_RESULT) };
    if (table === "items") return { select: () => chain(ITEMS_RESULT) };
    throw new Error(`unexpected table: ${table}`);
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClient(),
}));

const BOARD_ID = "b1111111-1111-4111-8111-111111111111";
const SOURCE_COLUMN_ID = "c1111111-1111-4111-8111-111111111111";
const TARGET_COLUMN_ID = "c2222222-1111-4111-8111-111111111111";
const ITEM_1 = "11111111-1111-4111-8111-111111111111";
const ITEM_2 = "22222222-1111-4111-8111-111111111111";
const ITEM_3 = "33333333-1111-4111-8111-111111111111";

const STATUS_OPTIONS = [
  { id: "opt-done", label: "Done", color: "#00c875" },
  { id: "opt-open", label: "Open", color: "#579bfc" },
];

beforeEach(() => {
  runAi.mockClear();
  requireAiEntitlement.mockReset();
  getUserOrgs.mockReset();
  requireUser.mockReset();
  classifyColumnWithAi.mockReset();
  bulkSetCell.mockReset();
  createClient.mockClear();

  FAKE_RESOLVED = {
    adapter: { id: "anthropic", supportsTools: true },
    apiKey: "k",
    mode: "managed",
    provider: "anthropic",
  };

  requireUser.mockResolvedValue({ id: "user-1" });
  getUserOrgs.mockResolvedValue([{ id: "org-1", name: "Org" }]);

  COLUMNS_RESULT = {
    data: {
      id: TARGET_COLUMN_ID,
      kind: "status",
      settings: { options: STATUS_OPTIONS },
    },
    error: null,
  };
  CELLS_RESULT = {
    data: [{ item_id: ITEM_1, value: { text: "needs review" } }],
    error: null,
  };
  ITEMS_RESULT = { data: [{ id: ITEM_1, name: "Widget A" }], error: null };

  classifyColumnWithAi.mockResolvedValue({
    classifications: [{ itemId: ITEM_1, optionId: "opt-open" }],
    usage: { inputTokens: 10, outputTokens: 5 },
  });

  bulkSetCell.mockImplementation(
    async (args: { itemIds: string[]; columnId: string; value: unknown }) => ({
      ok: true,
      data: { succeeded: args.itemIds, failed: [] },
    }),
  );
});

describe("classifyColumn action", () => {
  it("rejects invalid input before any work", async () => {
    const { classifyColumn } = await import("@/lib/ai/column-fill/actions");
    const res = await classifyColumn({
      boardId: "not-a-uuid",
      sourceColumnId: SOURCE_COLUMN_ID,
      targetColumnId: TARGET_COLUMN_ID,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("Invalid input.");
    expect(requireUser).not.toHaveBeenCalled();
  });

  it("gates on entitlement before invoking runAi", async () => {
    const { classifyColumn } = await import("@/lib/ai/column-fill/actions");
    await classifyColumn({
      boardId: BOARD_ID,
      sourceColumnId: SOURCE_COLUMN_ID,
      targetColumnId: TARGET_COLUMN_ID,
    });
    expect(requireAiEntitlement).toHaveBeenCalledWith("org-1", "column_fill");
    expect(requireAiEntitlement.mock.invocationCallOrder[0]).toBeLessThan(
      runAi.mock.invocationCallOrder[0],
    );
  });

  it("fails when the target column isn't status/dropdown", async () => {
    COLUMNS_RESULT = {
      data: { id: TARGET_COLUMN_ID, kind: "text", settings: {} },
      error: null,
    };
    const { classifyColumn } = await import("@/lib/ai/column-fill/actions");
    const res = await classifyColumn({
      boardId: BOARD_ID,
      sourceColumnId: SOURCE_COLUMN_ID,
      targetColumnId: TARGET_COLUMN_ID,
    });
    expect(res.ok).toBe(false);
    if (!res.ok)
      expect(res.error).toBe("Pick a status or dropdown column to fill.");
    expect(runAi).not.toHaveBeenCalled();
  });

  it("fails with no runAi call when the source column has no text", async () => {
    CELLS_RESULT = { data: [], error: null };
    const { classifyColumn } = await import("@/lib/ai/column-fill/actions");
    const res = await classifyColumn({
      boardId: BOARD_ID,
      sourceColumnId: SOURCE_COLUMN_ID,
      targetColumnId: TARGET_COLUMN_ID,
    });
    expect(res.ok).toBe(false);
    if (!res.ok)
      expect(res.error).toBe("This column has no text to classify yet.");
    expect(runAi).not.toHaveBeenCalled();
    expect(classifyColumnWithAi).not.toHaveBeenCalled();
  });

  it("drops blank-text rows before classifying", async () => {
    CELLS_RESULT = {
      data: [
        { item_id: ITEM_1, value: { text: "needs review" } },
        { item_id: ITEM_2, value: { text: "   " } },
      ],
      error: null,
    };
    const { classifyColumn } = await import("@/lib/ai/column-fill/actions");
    await classifyColumn({
      boardId: BOARD_ID,
      sourceColumnId: SOURCE_COLUMN_ID,
      targetColumnId: TARGET_COLUMN_ID,
    });
    expect(classifyColumnWithAi).toHaveBeenCalledWith(
      expect.objectContaining({
        rows: [{ itemId: ITEM_1, text: "needs review" }],
      }),
    );
  });

  it("returns the preview joined to item names on the happy path", async () => {
    const { classifyColumn } = await import("@/lib/ai/column-fill/actions");
    const res = await classifyColumn({
      boardId: BOARD_ID,
      sourceColumnId: SOURCE_COLUMN_ID,
      targetColumnId: TARGET_COLUMN_ID,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.preview).toEqual([
        {
          itemId: ITEM_1,
          itemName: "Widget A",
          sourceText: "needs review",
          proposedOptionId: "opt-open",
        },
      ]);
      expect(res.data.warnings).toEqual([]);
    }
    expect(classifyColumnWithAi).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "k",
        targetOptions: [
          { id: "opt-done", label: "Done" },
          { id: "opt-open", label: "Open" },
        ],
      }),
    );
  });

  it("nulls out and warns on an unknown optionId from the model", async () => {
    classifyColumnWithAi.mockResolvedValue({
      classifications: [{ itemId: ITEM_1, optionId: "opt-does-not-exist" }],
      usage: { inputTokens: 10, outputTokens: 5 },
    });
    const { classifyColumn } = await import("@/lib/ai/column-fill/actions");
    const res = await classifyColumn({
      boardId: BOARD_ID,
      sourceColumnId: SOURCE_COLUMN_ID,
      targetColumnId: TARGET_COLUMN_ID,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.preview[0]?.proposedOptionId).toBeNull();
      expect(res.data.warnings).toHaveLength(1);
    }
  });

  it("maps a not-capable provider to the Anthropic-specific copy and never calls the lib", async () => {
    FAKE_RESOLVED = {
      adapter: { id: "openai", supportsTools: false },
      apiKey: "k",
      mode: "managed",
      provider: "openai",
    };
    const { classifyColumn } = await import("@/lib/ai/column-fill/actions");
    const res = await classifyColumn({
      boardId: BOARD_ID,
      sourceColumnId: SOURCE_COLUMN_ID,
      targetColumnId: TARGET_COLUMN_ID,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("Smart Fill needs an Anthropic key.");
    expect(classifyColumnWithAi).not.toHaveBeenCalled();
  });

  it("maps a typed AiDisabledError from requireAiEntitlement to its copy", async () => {
    const { AiDisabledError } = await import("@/lib/ai/errors");
    requireAiEntitlement.mockRejectedValue(new AiDisabledError());
    const { classifyColumn } = await import("@/lib/ai/column-fill/actions");
    const res = await classifyColumn({
      boardId: BOARD_ID,
      sourceColumnId: SOURCE_COLUMN_ID,
      targetColumnId: TARGET_COLUMN_ID,
    });
    expect(res.ok).toBe(false);
    if (!res.ok)
      expect(res.error).toBe("AI is turned off for your organization.");
    expect(runAi).not.toHaveBeenCalled();
  });
});

describe("applyColumnFill action", () => {
  it("rejects invalid input before any work", async () => {
    const { applyColumnFill } = await import("@/lib/ai/column-fill/actions");
    const res = await applyColumnFill({
      targetColumnId: "not-a-uuid",
      assignments: [{ itemId: ITEM_1, optionId: "opt-done" }],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("Invalid input.");
    expect(requireUser).not.toHaveBeenCalled();
  });

  it("re-validates, batches bulkSetCell once per distinct option id, and drops unknown option ids", async () => {
    const { applyColumnFill } = await import("@/lib/ai/column-fill/actions");
    const res = await applyColumnFill({
      targetColumnId: TARGET_COLUMN_ID,
      assignments: [
        { itemId: ITEM_1, optionId: "opt-done" },
        { itemId: ITEM_2, optionId: "opt-open" },
        { itemId: ITEM_3, optionId: "opt-does-not-exist" },
      ],
    });
    expect(res.ok).toBe(true);
    expect(bulkSetCell).toHaveBeenCalledTimes(2);
    expect(bulkSetCell).toHaveBeenCalledWith({
      itemIds: [ITEM_1],
      columnId: TARGET_COLUMN_ID,
      value: { optionId: "opt-done" },
    });
    expect(bulkSetCell).toHaveBeenCalledWith({
      itemIds: [ITEM_2],
      columnId: TARGET_COLUMN_ID,
      value: { optionId: "opt-open" },
    });
    if (res.ok) {
      expect(res.data.succeeded.sort()).toEqual([ITEM_1, ITEM_2].sort());
    }
  });

  it("writes dropdown columns as a one-element optionIds array", async () => {
    COLUMNS_RESULT = {
      data: {
        id: TARGET_COLUMN_ID,
        kind: "dropdown",
        settings: { options: STATUS_OPTIONS },
      },
      error: null,
    };
    const { applyColumnFill } = await import("@/lib/ai/column-fill/actions");
    await applyColumnFill({
      targetColumnId: TARGET_COLUMN_ID,
      assignments: [{ itemId: ITEM_1, optionId: "opt-done" }],
    });
    expect(bulkSetCell).toHaveBeenCalledWith({
      itemIds: [ITEM_1],
      columnId: TARGET_COLUMN_ID,
      value: { optionIds: ["opt-done"] },
    });
  });

  it("fails with no bulkSetCell call when every assignment is an unknown option", async () => {
    const { applyColumnFill } = await import("@/lib/ai/column-fill/actions");
    const res = await applyColumnFill({
      targetColumnId: TARGET_COLUMN_ID,
      assignments: [{ itemId: ITEM_1, optionId: "opt-does-not-exist" }],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("No rows to apply.");
    expect(bulkSetCell).not.toHaveBeenCalled();
  });

  it("fails when the target column isn't status/dropdown", async () => {
    COLUMNS_RESULT = {
      data: { id: TARGET_COLUMN_ID, kind: "text", settings: {} },
      error: null,
    };
    const { applyColumnFill } = await import("@/lib/ai/column-fill/actions");
    const res = await applyColumnFill({
      targetColumnId: TARGET_COLUMN_ID,
      assignments: [{ itemId: ITEM_1, optionId: "opt-done" }],
    });
    expect(res.ok).toBe(false);
    if (!res.ok)
      expect(res.error).toBe("Pick a status or dropdown column to fill.");
    expect(bulkSetCell).not.toHaveBeenCalled();
  });
});
