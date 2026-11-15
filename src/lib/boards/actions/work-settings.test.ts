import { describe, it, expect, vi, beforeEach } from "vitest";

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (...a: unknown[]) => revalidatePath(...a),
}));

const B1 = "11111111-1111-4111-8111-111111111111";
const B2 = "22222222-2222-4222-8222-222222222222";
const S1 = "33333333-3333-4333-8333-333333333333";
const D1 = "44444444-4444-4444-8444-444444444444";
const T1 = "55555555-5555-4555-8555-555555555555";
const X9 = "66666666-6666-4666-8666-666666666666";

type Col = {
  id: string;
  board_id: string;
  kind: string;
  settings: unknown;
};
// Board b1: status s1 (o1 "Working", o2 "Done"), date d1, text t1.
// Column x9 is a status column that belongs to board b2.
const COLUMNS: Col[] = [
  {
    id: S1,
    board_id: B1,
    kind: "status",
    settings: {
      options: [
        { id: "o1", label: "Working" },
        { id: "o2", label: "Done" },
      ],
    },
  },
  { id: D1, board_id: B1, kind: "date", settings: {} },
  { id: T1, board_id: B1, kind: "text", settings: {} },
  {
    id: X9,
    board_id: B2,
    kind: "status",
    settings: { options: [{ id: "o2", label: "Done" }] },
  },
];

const update = vi.fn();
let editableBoards: string[] = [];

/** Models `.eq()` / `.in()` filtering so a wrong board id returns nothing. */
const from = vi.fn((table: string) => {
  if (table === "columns") {
    return {
      select: () => {
        const filters: ((c: Col) => boolean)[] = [];
        const q = {
          eq: (k: keyof Col, v: string) => {
            filters.push((c) => c[k] === v);
            return q;
          },
          in: (k: keyof Col, vs: string[]) => {
            filters.push((c) => vs.includes(c[k] as string));
            return Promise.resolve({
              data: COLUMNS.filter((c) => filters.every((f) => f(c))),
              error: null,
            });
          },
        };
        return q;
      },
    };
  }
  if (table === "boards") {
    return {
      update: (patch: unknown) => {
        update(patch);
        return {
          eq: (_k: string, id: string) => ({
            select: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: editableBoards.includes(id) ? { id } : null,
                  error: null,
                }),
            }),
          }),
        };
      },
    };
  }
  throw new Error(`unexpected table ${table}`);
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from }),
}));

import { updateBoardWorkSettings } from "./work-settings";

beforeEach(() => {
  vi.clearAllMocks();
  editableBoards = [B1];
});

describe("updateBoardWorkSettings", () => {
  it("saves a valid selection", async () => {
    const res = await updateBoardWorkSettings({
      boardId: B1,
      statusColumnId: S1,
      doneOptionIds: ["o2"],
      dueColumnId: D1,
    });
    expect(res).toEqual({ ok: true, data: undefined });
    expect(update).toHaveBeenCalledWith({
      work_status_column_id: S1,
      work_done_option_ids: ["o2"],
      work_due_column_id: D1,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/my-work");
  });

  it("clears everything back to the guess", async () => {
    const res = await updateBoardWorkSettings({
      boardId: B1,
      statusColumnId: null,
      doneOptionIds: null,
      dueColumnId: null,
    });
    expect(res.ok).toBe(true);
    expect(update).toHaveBeenCalledWith({
      work_status_column_id: null,
      work_done_option_ids: null,
      work_due_column_id: null,
    });
  });

  it("rejects a status column from another board", async () => {
    const res = await updateBoardWorkSettings({
      boardId: B1,
      statusColumnId: X9,
      doneOptionIds: null,
      dueColumnId: null,
    });
    expect(res).toEqual({
      ok: false,
      error: "That status column is not on this board.",
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects a column of the wrong kind as the status column", async () => {
    const res = await updateBoardWorkSettings({
      boardId: B1,
      statusColumnId: T1,
      doneOptionIds: null,
      dueColumnId: null,
    });
    expect(res).toEqual({
      ok: false,
      error: "That status column is not on this board.",
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects a due date column from another board", async () => {
    const res = await updateBoardWorkSettings({
      boardId: B2,
      statusColumnId: null,
      doneOptionIds: null,
      dueColumnId: D1,
    });
    expect(res).toEqual({
      ok: false,
      error: "The due date must be a date column on this board.",
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects a column of the wrong kind as the due date", async () => {
    const res = await updateBoardWorkSettings({
      boardId: B1,
      statusColumnId: null,
      doneOptionIds: null,
      dueColumnId: T1,
    });
    expect(res).toEqual({
      ok: false,
      error: "The due date must be a date column on this board.",
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects done options without a status column", async () => {
    const res = await updateBoardWorkSettings({
      boardId: B1,
      statusColumnId: null,
      doneOptionIds: ["o2"],
      dueColumnId: null,
    });
    expect(res).toEqual({
      ok: false,
      error: "Choose the status column before its done options.",
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects a done option the status column does not have", async () => {
    const res = await updateBoardWorkSettings({
      boardId: B1,
      statusColumnId: S1,
      doneOptionIds: ["nope"],
      dueColumnId: null,
    });
    expect(res).toEqual({
      ok: false,
      error: "A done option is not an option of that status column.",
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects an empty done list", async () => {
    const res = await updateBoardWorkSettings({
      boardId: B1,
      statusColumnId: S1,
      doneOptionIds: [],
      dueColumnId: null,
    });
    expect(res.ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects a malformed board id", async () => {
    const res = await updateBoardWorkSettings({
      boardId: "not-a-uuid",
      statusColumnId: null,
      doneOptionIds: null,
      dueColumnId: null,
    });
    expect(res.ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it("reports a board the caller cannot edit", async () => {
    editableBoards = []; // RLS filters the row out of the update
    const res = await updateBoardWorkSettings({
      boardId: B1,
      statusColumnId: null,
      doneOptionIds: null,
      dueColumnId: null,
    });
    expect(res).toEqual({
      ok: false,
      error: "Board not found, or you cannot edit it.",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
