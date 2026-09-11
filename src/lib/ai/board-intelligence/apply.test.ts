import { beforeEach, describe, expect, it, vi } from "vitest";

const RUN_ID = "11111111-1111-4111-8111-111111111111";
const ITEM_1 = "22222222-2222-4222-8222-222222222222";
const COL_STATUS = "33333333-3333-4333-8333-333333333333";
const USER_ZED = "44444444-4444-4444-8444-444444444444";
const ACTOR = "55555555-5555-4555-8555-555555555555";
const UPDATE_ID = "66666666-6666-4666-8666-666666666666";
const COL_DATE = "77777777-7777-4777-8777-777777777777";

const suggestion = {
  id: "s1",
  kind: "overdue" as const,
  title: "Overdue item",
  evidence: "1 item",
  body: "Ship is overdue.",
  evidenceRows: [],
  actions: [
    {
      type: "set_status" as const,
      itemId: ITEM_1,
      columnId: COL_STATUS,
      optionId: "o-done",
      label: "Mark Ship as Done",
    },
    {
      type: "nudge" as const,
      itemId: ITEM_1,
      userId: USER_ZED,
      message: "Please update this.",
      label: "Nudge Zed",
    },
  ],
};

const runRow = (applied: string[] = []) => ({
  id: RUN_ID,
  org_id: "org-1",
  board_id: "board-1",
  user_id: ACTOR,
  generated_at: "2026-09-11T10:00:00.000Z",
  input_hash: "h",
  payload: { brief: "b", suggestions: [suggestion], signals: [] },
  dismissed: [],
  applied,
  model: "m",
  tokens_in: 1,
  tokens_out: 2,
});

let RUN_ROW: ReturnType<typeof runRow> = runRow();
let UPDATE_ROW: ReturnType<typeof runRow> | null = null;
let DELETE_RESULT: { error: unknown } = { error: null };

const updateSpy = vi.fn();
const deleteInSpy = vi.fn();

function makeClient() {
  return {
    from: (table: string) => {
      if (table === "board_intelligence_runs") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: RUN_ROW, error: null }),
            }),
          }),
          update: (data: { applied: string[] }) => {
            updateSpy(data);
            return {
              eq: () => ({
                select: () => ({
                  single: async () => ({
                    data: UPDATE_ROW ?? runRow(data.applied),
                    error: null,
                  }),
                }),
              }),
            };
          },
        };
      }
      if (table === "item_updates") {
        return {
          delete: () => ({
            in: (_col: string, ids: string[]) => ({
              eq: async () => {
                deleteInSpy(ids);
                return DELETE_RESULT;
              },
            }),
          }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };
}

const createClient = vi.fn(async () => makeClient());
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClient(),
}));

const requireUser = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  requireUser: (...a: unknown[]) => requireUser(...a),
}));

const getBoardAccess = vi.fn();
const getBoardPayload = vi.fn();
vi.mock("@/lib/boards/queries", () => ({
  getBoardAccess: (...a: unknown[]) => getBoardAccess(...a),
  getBoardPayload: (...a: unknown[]) => getBoardPayload(...a),
}));

const listOrgMembersCached = vi.fn();
vi.mock("@/lib/org/queries-cached", () => ({
  listOrgMembersCached: (...a: unknown[]) => listOrgMembersCached(...a),
}));

const notifyNewAssignees = vi.fn();
vi.mock("@/lib/boards/actions/assign-notify", () => ({
  notifyNewAssignees: (...a: unknown[]) => notifyNewAssignees(...a),
}));

const applyCellWrites = vi.fn();
const applyNudge = vi.fn();
vi.mock("./apply-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./apply-core")>();
  return {
    ...actual,
    applyCellWrites: (...a: unknown[]) => applyCellWrites(...a),
    applyNudge: (...a: unknown[]) => applyNudge(...a),
  };
});

const boardPayload = () => ({
  board: { id: "board-1", org_id: "org-1" },
  items: [{ id: ITEM_1, name: "Ship", group_id: "g", parent_id: null }],
  columns: [
    {
      id: COL_STATUS,
      name: "Status",
      kind: "status",
      settings: {
        options: [{ id: "o-done", label: "Done", color: "green" }],
      },
    },
    { id: COL_DATE, name: "Due", kind: "date", settings: {} },
  ],
  cellValues: [],
});

beforeEach(() => {
  RUN_ROW = runRow();
  UPDATE_ROW = null;
  DELETE_RESULT = { error: null };
  updateSpy.mockReset();
  deleteInSpy.mockReset();
  createClient.mockClear();
  requireUser.mockReset().mockResolvedValue({ id: ACTOR });
  getBoardAccess.mockReset().mockResolvedValue("editor");
  getBoardPayload.mockReset().mockResolvedValue(boardPayload());
  listOrgMembersCached.mockReset().mockResolvedValue([
    { userId: ACTOR, fullName: "Actor" },
    { userId: USER_ZED, fullName: "Zed" },
  ]);
  notifyNewAssignees.mockReset().mockResolvedValue(undefined);
  applyCellWrites.mockReset().mockResolvedValue({
    before: [{ itemId: ITEM_1, columnId: COL_STATUS, value: null }],
    effects: [{ kind: "item_fields_set", boardId: "board-1", cells: [] }],
  });
  applyNudge.mockReset().mockResolvedValue({ updateId: UPDATE_ID });
});

describe("applySuggestion", () => {
  it("a viewer is rejected before any write", async () => {
    getBoardAccess.mockResolvedValue("viewer");
    const { applySuggestion } = await import("./apply");
    const res = await applySuggestion({
      runId: RUN_ID,
      suggestionId: "s1",
      actionIndex: 0,
    });
    expect(res).toEqual({
      ok: false,
      error: "Only editors can apply suggestions.",
    });
    expect(applyCellWrites).not.toHaveBeenCalled();
  });

  it("an editor applying actionIndex 0 (set_status) writes the planned cell and marks s1 applied", async () => {
    const { applySuggestion } = await import("./apply");
    const res = await applySuggestion({
      runId: RUN_ID,
      suggestionId: "s1",
      actionIndex: 0,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(applyCellWrites).toHaveBeenCalledTimes(1);
    expect(applyCellWrites).toHaveBeenCalledWith(expect.anything(), "board-1", [
      { item_id: ITEM_1, column_id: COL_STATUS, value: { optionId: "o-done" } },
    ]);
    expect(res.data.run.applied).toContain("s1");
    expect(res.data.before).toEqual([
      { itemId: ITEM_1, columnId: COL_STATUS, value: null },
    ]);
    expect(res.data.effects).toEqual([
      { kind: "item_fields_set", boardId: "board-1", cells: [] },
    ]);
  });

  it("actionIndex 1 (nudge) posts as the current user and returns the update id", async () => {
    const { applySuggestion } = await import("./apply");
    const res = await applySuggestion({
      runId: RUN_ID,
      suggestionId: "s1",
      actionIndex: 1,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(applyNudge).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: "org-1",
        boardId: "board-1",
        itemId: ITEM_1,
        actorId: ACTOR,
        userId: USER_ZED,
        message: "Please update this.",
      }),
    );
    expect(res.data.updateIds).toEqual([UPDATE_ID]);
    expect(applyCellWrites).not.toHaveBeenCalled();
  });

  it("fails closed when the action no longer matches the board", async () => {
    getBoardPayload.mockResolvedValue({
      ...boardPayload(),
      items: [],
    });
    const { applySuggestion } = await import("./apply");
    const res = await applySuggestion({
      runId: RUN_ID,
      suggestionId: "s1",
      actionIndex: 0,
    });
    expect(res).toEqual({
      ok: false,
      error: "This suggestion no longer matches the board.",
    });
    expect(applyCellWrites).not.toHaveBeenCalled();
  });
});

describe("revertSuggestion", () => {
  it("fails with 'Invalid undo data.' when a before value fails the column schema", async () => {
    const { revertSuggestion } = await import("./apply");
    const res = await revertSuggestion({
      runId: RUN_ID,
      suggestionId: "s1",
      before: [{ itemId: ITEM_1, columnId: COL_DATE, value: { date: "nope" } }],
      updateIds: [],
    });
    expect(res).toEqual({ ok: false, error: "Invalid undo data." });
    expect(applyCellWrites).not.toHaveBeenCalled();
  });

  it("applies a valid before value (null becomes a clear) and unmarks s1", async () => {
    RUN_ROW = runRow(["s1"]);
    const { revertSuggestion } = await import("./apply");
    const res = await revertSuggestion({
      runId: RUN_ID,
      suggestionId: "s1",
      before: [{ itemId: ITEM_1, columnId: COL_STATUS, value: null }],
      updateIds: [UPDATE_ID],
    });
    expect(res.ok).toBe(true);
    expect(applyCellWrites).toHaveBeenCalledWith(expect.anything(), "board-1", [
      { item_id: ITEM_1, column_id: COL_STATUS, value: null },
    ]);
    expect(deleteInSpy).toHaveBeenCalledWith([UPDATE_ID]);
    if (!res.ok) return;
    expect(res.data.run.applied).not.toContain("s1");
  });
});
