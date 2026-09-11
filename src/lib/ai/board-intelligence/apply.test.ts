import { beforeEach, describe, expect, it, vi } from "vitest";

const RUN_ID = "11111111-1111-4111-8111-111111111111";
const ITEM_1 = "22222222-2222-4222-8222-222222222222";
const COL_STATUS = "33333333-3333-4333-8333-333333333333";
const USER_ZED = "44444444-4444-4444-8444-444444444444";
const ACTOR = "55555555-5555-4555-8555-555555555555";
const UPDATE_ID = "66666666-6666-4666-8666-666666666666";
const COL_DATE = "77777777-7777-4777-8777-777777777777";
const COL_PEOPLE = "88888888-8888-4888-8888-888888888888";

const setStatusSuggestion = {
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

const reassignSuggestion = {
  id: "s2",
  kind: "overloaded" as const,
  title: "Reassign Ship",
  evidence: "1 item",
  body: "Ship is stuck with the wrong owner.",
  evidenceRows: [],
  actions: [
    {
      type: "reassign" as const,
      itemIds: [ITEM_1],
      columnId: COL_PEOPLE,
      toUserId: USER_ZED,
      label: "Reassign Ship to Zed",
    },
  ],
};

const filterSuggestion = {
  id: "s3",
  kind: "overdue" as const,
  title: "Overdue rows",
  evidence: "1 item",
  body: "See the overdue items.",
  evidenceRows: [],
  actions: [
    { type: "filter" as const, signalKind: "overdue" as const, label: "x" },
  ],
};

const runRow = (applied: string[] = []) => ({
  id: RUN_ID,
  org_id: "org-1",
  board_id: "board-1",
  user_id: ACTOR,
  generated_at: "2026-09-11T10:00:00.000Z",
  input_hash: "h",
  payload: {
    brief: "b",
    suggestions: [setStatusSuggestion, reassignSuggestion, filterSuggestion],
    signals: [],
  },
  dismissed: [],
  applied,
  model: "m",
  tokens_in: 1,
  tokens_out: 2,
});

let RUN_ROW: ReturnType<typeof runRow> = runRow();
/** `applied` as the row stands when `setApplied` re-reads it, if that differs
 *  from what `loadRun` saw at the top of the action. */
let FRESH_APPLIED: string[] | null = null;
let UPDATE_ROW: ReturnType<typeof runRow> | null = null;
let DELETE_RESULT: { error: unknown } = { error: null };

const updateSpy = vi.fn();
const deleteSpy = vi.fn();

function makeClient() {
  return {
    from: (table: string) => {
      if (table === "board_intelligence_runs") {
        return {
          select: (cols?: string) => ({
            eq: () => ({
              maybeSingle: async () => ({
                data:
                  cols === "applied" && FRESH_APPLIED
                    ? { applied: FRESH_APPLIED }
                    : RUN_ROW,
                error: null,
              }),
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
              eq: (boardCol: string, boardVal: string) => ({
                eq: async (authorCol: string, authorVal: string) => {
                  deleteSpy({
                    ids,
                    boardCol,
                    boardVal,
                    authorCol,
                    authorVal,
                  });
                  return DELETE_RESULT;
                },
              }),
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
    { id: COL_PEOPLE, name: "Owner", kind: "people", settings: {} },
  ],
  cellValues: [],
});

beforeEach(() => {
  RUN_ROW = runRow();
  FRESH_APPLIED = null;
  UPDATE_ROW = null;
  DELETE_RESULT = { error: null };
  updateSpy.mockReset();
  deleteSpy.mockReset();
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

  it("keeps a mark another write added between the load and the update", async () => {
    // `applied` is one jsonb array shared by apply, undo and dismiss — writing
    // the copy read at the top of the action drops whatever landed in between.
    FRESH_APPLIED = ["s9"];
    const { applySuggestion } = await import("./apply");
    const res = await applySuggestion({
      runId: RUN_ID,
      suggestionId: "s1",
      actionIndex: 0,
    });
    expect(res.ok).toBe(true);
    expect(updateSpy).toHaveBeenCalledWith({ applied: ["s9", "s1"] });
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

  it("reassign replays notifyNewAssignees per before-row with the prior owners and the new target", async () => {
    applyCellWrites.mockResolvedValue({
      before: [
        { itemId: ITEM_1, columnId: COL_PEOPLE, value: { userIds: ["u-old"] } },
      ],
      effects: [],
    });
    const { applySuggestion } = await import("./apply");
    const res = await applySuggestion({
      runId: RUN_ID,
      suggestionId: "s2",
      actionIndex: 0,
    });
    expect(res.ok).toBe(true);
    expect(notifyNewAssignees).toHaveBeenCalledTimes(1);
    expect(notifyNewAssignees).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: "org-1",
        boardId: "board-1",
        itemId: ITEM_1,
        actorId: ACTOR,
        prior: ["u-old"],
        next: [USER_ZED],
      }),
    );
  });

  it("refuses a filter action server-side without touching the board", async () => {
    const { applySuggestion } = await import("./apply");
    const res = await applySuggestion({
      runId: RUN_ID,
      suggestionId: "s3",
      actionIndex: 0,
    });
    expect(res).toEqual({
      ok: false,
      error: "This action runs in the browser.",
    });
    expect(applyCellWrites).not.toHaveBeenCalled();
    expect(applyNudge).not.toHaveBeenCalled();
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

  it("maps a 42501 (no edit access) write failure to the editor-only copy and logs the raw message", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    applyCellWrites.mockRejectedValue(
      new Error("apply_intelligence_cells: no edit access to this board"),
    );
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
    expect(spy).toHaveBeenCalledWith(
      "[intelligence] write failed",
      expect.objectContaining({
        error: "apply_intelligence_cells: no edit access to this board",
      }),
    );
  });

  it("maps any other write failure to the generic copy", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    applyCellWrites.mockRejectedValue(new Error("connection reset"));
    const { applySuggestion } = await import("./apply");
    const res = await applySuggestion({
      runId: RUN_ID,
      suggestionId: "s1",
      actionIndex: 0,
    });
    expect(res).toEqual({
      ok: false,
      error: "Couldn't apply the suggestion.",
    });
  });
});

describe("revertSuggestion", () => {
  it("fails with 'Suggestion was not applied.' when s1 isn't in run.applied", async () => {
    const { revertSuggestion } = await import("./apply");
    const res = await revertSuggestion({
      runId: RUN_ID,
      suggestionId: "s1",
      before: [{ itemId: ITEM_1, columnId: COL_STATUS, value: null }],
      updateIds: [],
    });
    expect(res).toEqual({ ok: false, error: "Suggestion was not applied." });
    expect(applyCellWrites).not.toHaveBeenCalled();
  });

  it("fails with 'Invalid undo data.' when a before value fails the column schema", async () => {
    RUN_ROW = runRow(["s1"]);
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

  it("applies a valid before value (null becomes a clear), unmarks s1, and scopes the update delete to this board+author", async () => {
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
    expect(deleteSpy).toHaveBeenCalledWith({
      ids: [UPDATE_ID],
      boardCol: "board_id",
      boardVal: "board-1",
      authorCol: "author_id",
      authorVal: ACTOR,
    });
    if (!res.ok) return;
    expect(res.data.run.applied).not.toContain("s1");
  });

  it("maps a 42501 (no edit access) write failure to the editor-only copy", async () => {
    RUN_ROW = runRow(["s1"]);
    vi.spyOn(console, "error").mockImplementation(() => {});
    applyCellWrites.mockRejectedValue(
      new Error("apply_intelligence_cells: no edit access to this board"),
    );
    const { revertSuggestion } = await import("./apply");
    const res = await revertSuggestion({
      runId: RUN_ID,
      suggestionId: "s1",
      before: [{ itemId: ITEM_1, columnId: COL_STATUS, value: null }],
      updateIds: [],
    });
    expect(res).toEqual({
      ok: false,
      error: "Only editors can apply suggestions.",
    });
  });

  it("maps any other write failure to the generic undo copy", async () => {
    RUN_ROW = runRow(["s1"]);
    vi.spyOn(console, "error").mockImplementation(() => {});
    applyCellWrites.mockRejectedValue(new Error("connection reset"));
    const { revertSuggestion } = await import("./apply");
    const res = await revertSuggestion({
      runId: RUN_ID,
      suggestionId: "s1",
      before: [{ itemId: ITEM_1, columnId: COL_STATUS, value: null }],
      updateIds: [],
    });
    expect(res).toEqual({ ok: false, error: "Couldn't undo." });
  });
});
