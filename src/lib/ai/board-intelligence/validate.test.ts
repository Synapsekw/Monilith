import { describe, expect, it } from "vitest";
import { buildBoardContext } from "./board-context";
import { payloadSchema } from "./schema";
import { toAction, validateIntelligenceOutput } from "./validate";
import type { BoardPayload } from "@/lib/boards/queries";
import type { Signal } from "@/lib/boards/intelligence/types";

// Minimal payload: one group, a status column with two options, a date column,
// a people column, two items, one member. Cast through unknown — only the
// fields buildBoardContext reads are present.
const payload = {
  board: { id: "b1", org_id: "o1", name: "Launch" },
  groups: [{ id: "g1", name: "Sprint", position: 0 }],
  columns: [
    {
      id: "c-status",
      name: "Status",
      kind: "status",
      settings: {
        options: [
          { id: "o-done", label: "Done", color: "green" },
          { id: "o-stuck", label: "Stuck", color: "red" },
        ],
      },
    },
    { id: "c-date", name: "Due", kind: "date", settings: {} },
    { id: "c-people", name: "Owner", kind: "people", settings: {} },
  ],
  items: [
    { id: "i1", name: "Ship", group_id: "g1", parent_id: null },
    { id: "i2", name: "Test", group_id: "g1", parent_id: null },
  ],
  cellValues: [],
  dependencies: [],
  views: [],
  attachments: [],
  timeEntries: [],
  relationLinks: [],
  mirrorTargetCells: [],
  mirrorTargetColumns: [],
} as unknown as BoardPayload;
const members = [
  { userId: "u-ana", fullName: "Ana Lima" },
  { userId: "u-bo", fullName: null },
];
const ctx = buildBoardContext(payload, members);
/** The same board, with the run's signals attached — an `overloaded` signal is
 *  ONE PER PERSON, so `toAction` needs them to name the subject. */
const overloaded: Signal = {
  kind: "overloaded",
  count: 7,
  label: "overloaded · Ana",
  tone: "yellow",
  itemIds: ["i1", "i2"],
  subjectUserId: "u-ana",
};
const overdueSignal: Signal = {
  kind: "overdue",
  count: 1,
  label: "overdue",
  tone: "red",
  itemIds: ["i1"],
};
const signalCtx = buildBoardContext(payload, members, [
  overdueSignal,
  overloaded,
]);
const base = {
  itemIds: null,
  itemId: null,
  columnId: null,
  toUserId: null,
  date: null,
  optionId: null,
  userId: null,
  message: null,
  signalKind: null,
};

// A second board whose item/column/member names are unrealistically long
// (200 chars), to prove a label built from real board data can never exceed
// the closed union's `label ≤ 60` cap.
const longName = "L".repeat(200);
const longPayload = {
  board: { id: "b2", org_id: "o1", name: "Launch" },
  groups: [{ id: "g1", name: "Sprint", position: 0 }],
  columns: [
    { id: "c-date", name: longName, kind: "date", settings: {} },
    { id: "c-people", name: "Owner", kind: "people", settings: {} },
    {
      id: "c-status",
      name: "Status",
      kind: "status",
      settings: {
        options: [{ id: "o-long", label: longName, color: "green" }],
      },
    },
  ],
  items: [{ id: "i-long", name: longName, group_id: "g1", parent_id: null }],
  cellValues: [],
  dependencies: [],
  views: [],
  attachments: [],
  timeEntries: [],
  relationLinks: [],
  mirrorTargetCells: [],
  mirrorTargetColumns: [],
} as unknown as BoardPayload;
const longMembers = [{ userId: "u-long", fullName: longName }];
const longCtx = buildBoardContext(longPayload, longMembers);

describe("buildBoardContext", () => {
  it("indexes items, columns with option labels, and member names", () => {
    expect(ctx.items.get("i1")?.name).toBe("Ship");
    expect(ctx.columns.get("c-status")?.options.get("o-stuck")).toBe("Stuck");
    expect(ctx.members.get("u-ana")).toBe("Ana Lima");
    expect(ctx.members.get("u-bo")).toBe("Someone");
  });
});

describe("toAction", () => {
  it("builds a labelled reassign when items, column kind and member all check out", () => {
    expect(
      toAction(
        {
          ...base,
          type: "reassign",
          itemIds: ["i1", "i2"],
          columnId: "c-people",
          toUserId: "u-ana",
        },
        ctx,
      ),
    ).toEqual({
      type: "reassign",
      itemIds: ["i1", "i2"],
      columnId: "c-people",
      toUserId: "u-ana",
      label: "Reassign 2 items to Ana Lima",
    });
  });
  it("drops a reassign whose column is not a people column or whose user is off-board", () => {
    expect(
      toAction(
        {
          ...base,
          type: "reassign",
          itemIds: ["i1"],
          columnId: "c-status",
          toUserId: "u-ana",
        },
        ctx,
      ),
    ).toBeNull();
    expect(
      toAction(
        {
          ...base,
          type: "reassign",
          itemIds: ["i1"],
          columnId: "c-people",
          toUserId: "u-zed",
        },
        ctx,
      ),
    ).toBeNull();
  });
  it("drops an item id that is not on the board", () => {
    expect(
      toAction(
        {
          ...base,
          type: "set_due",
          itemId: "i9",
          columnId: "c-date",
          date: "2026-09-20",
        },
        ctx,
      ),
    ).toBeNull();
  });
  it("checks status options against the column", () => {
    expect(
      toAction(
        {
          ...base,
          type: "set_status",
          itemId: "i1",
          columnId: "c-status",
          optionId: "o-done",
        },
        ctx,
      ),
    ).toEqual({
      type: "set_status",
      itemId: "i1",
      columnId: "c-status",
      optionId: "o-done",
      label: "Mark Ship as Done",
    });
    expect(
      toAction(
        {
          ...base,
          type: "set_status",
          itemId: "i1",
          columnId: "c-status",
          optionId: "o-nope",
        },
        ctx,
      ),
    ).toBeNull();
  });
  it("rejects a malformed date and an unknown signal kind", () => {
    expect(
      toAction(
        {
          ...base,
          type: "set_due",
          itemId: "i1",
          columnId: "c-date",
          date: "next week",
        },
        ctx,
      ),
    ).toBeNull();
    expect(
      toAction({ ...base, type: "filter", signalKind: "urgent" }, ctx),
    ).toBeNull();
    expect(
      toAction({ ...base, type: "filter", signalKind: "overdue" }, ctx),
    ).toEqual({
      type: "filter",
      signalKind: "overdue",
      label: "Show overdue rows",
    });
  });
  it("resolves an overloaded filter to the person the signal is about", () => {
    // Without the subject the chip selects nothing: `overloaded` is one signal
    // per person, so the kind alone matches no rows and the button is dead.
    expect(
      toAction(
        { ...base, type: "filter", signalKind: "overloaded" },
        signalCtx,
      ),
    ).toEqual({
      type: "filter",
      signalKind: "overloaded",
      subject: "u-ana",
      label: "Show overloaded rows · Ana Lima",
    });
  });
  it("drops an overloaded filter when the run has no overloaded signal", () => {
    expect(
      toAction({ ...base, type: "filter", signalKind: "overloaded" }, ctx),
    ).toBeNull();
    expect(
      toAction(
        { ...base, type: "filter", signalKind: "overloaded" },
        buildBoardContext(payload, members, [overdueSignal]),
      ),
    ).toBeNull();
  });
  it("sanitizes the nudge message and names the recipient", () => {
    expect(
      toAction(
        {
          ...base,
          type: "nudge",
          itemId: "i2",
          userId: "u-ana",
          message: "Ping <b>now</b>\nplease",
        },
        ctx,
      ),
    ).toEqual({
      type: "nudge",
      itemId: "i2",
      userId: "u-ana",
      message: "Ping bnow/b please",
      label: "Nudge Ana Lima",
    });
  });
  it("caps a label built from a 200-char item/column/member name at 60 chars", () => {
    const setDue = toAction(
      {
        ...base,
        type: "set_due",
        itemId: "i-long",
        columnId: "c-date",
        date: "2026-09-20",
      },
      longCtx,
    );
    expect(setDue?.label.length).toBeLessThanOrEqual(60);
    expect(setDue?.label.endsWith("…")).toBe(true);

    const setStatus = toAction(
      {
        ...base,
        type: "set_status",
        itemId: "i-long",
        columnId: "c-status",
        optionId: "o-long",
      },
      longCtx,
    );
    expect(setStatus?.label.length).toBeLessThanOrEqual(60);

    const reassign = toAction(
      {
        ...base,
        type: "reassign",
        itemIds: ["i-long"],
        columnId: "c-people",
        toUserId: "u-long",
      },
      longCtx,
    );
    expect(reassign?.label.length).toBeLessThanOrEqual(60);

    const nudge = toAction(
      {
        ...base,
        type: "nudge",
        itemId: "i-long",
        userId: "u-long",
        message: "Ping",
      },
      longCtx,
    );
    expect(nudge?.label.length).toBeLessThanOrEqual(60);
  });
});

describe("validateIntelligenceOutput", () => {
  const signals: Signal[] = [overdueSignal];
  /** What the payload stores: the triple, not the whole signal. */
  const stored = [{ kind: "overdue", count: 1, label: "overdue" }];
  it("keeps the brief, drops suggestions with no valid action, mints ids, resolves evidence rows", () => {
    const { payload: out, warnings } = validateIntelligenceOutput(
      {
        brief: "One item is late.",
        suggestions: [
          {
            kind: "overdue",
            title: "Push Ship",
            evidence: "1 overdue",
            body: "b",
            evidenceItemIds: ["i1", "i9"],
            actions: [
              {
                ...base,
                type: "set_due",
                itemId: "i1",
                columnId: "c-date",
                date: "2026-09-20",
              },
              {
                ...base,
                type: "set_due",
                itemId: "i9",
                columnId: "c-date",
                date: "2026-09-20",
              },
            ],
          },
          {
            kind: "other",
            title: "Nonsense",
            evidence: "",
            body: "",
            evidenceItemIds: [],
            actions: [
              {
                ...base,
                type: "reassign",
                itemIds: ["i9"],
                columnId: "c-people",
                toUserId: "u-ana",
              },
            ],
          },
        ],
      },
      ctx,
      signals,
    );
    expect(out.brief).toBe("One item is late.");
    expect(out.suggestions).toHaveLength(1);
    expect(out.suggestions[0]).toMatchObject({
      id: "s1",
      actions: [{ type: "set_due", itemId: "i1" }],
      evidenceRows: [{ itemId: "i1", name: "Ship" }],
    });
    expect(out.signals).toEqual(stored);
    expect(warnings.length).toBeGreaterThan(0);
  });
  it("stores an overloaded filter with its subject, and drops it without one", () => {
    const raw = {
      brief: "Ana is carrying the board.",
      suggestions: [
        {
          kind: "overloaded",
          title: "Ana is overloaded",
          evidence: "7 items",
          body: "b",
          evidenceItemIds: ["i1"],
          actions: [{ ...base, type: "filter", signalKind: "overloaded" }],
        },
      ],
    };
    const { payload: out } = validateIntelligenceOutput(raw, signalCtx, [
      overdueSignal,
      overloaded,
    ]);
    expect(out.suggestions[0]?.actions[0]).toEqual({
      type: "filter",
      signalKind: "overloaded",
      subject: "u-ana",
      label: "Show overloaded rows · Ana Lima",
    });
    expect(payloadSchema.safeParse(out).success).toBe(true);

    // No overloaded signal → no subject to filter by → the action, and with it
    // the only-action suggestion, is dropped rather than shipped inert.
    const { payload: none, warnings } = validateIntelligenceOutput(
      raw,
      ctx,
      signals,
    );
    expect(none.suggestions).toEqual([]);
    expect(warnings.length).toBeGreaterThan(0);
  });
  it("throws on a shape the raw schema rejects", () => {
    expect(() =>
      validateIntelligenceOutput({ brief: 1 }, ctx, signals),
    ).toThrow();
  });
  it("always builds a payload that round-trips through payloadSchema, even with 200-char board names", () => {
    const { payload: out } = validateIntelligenceOutput(
      {
        brief: "One item is late.",
        suggestions: [
          {
            kind: "overdue",
            title: "Push it",
            evidence: "1 overdue",
            body: "b",
            evidenceItemIds: ["i-long"],
            actions: [
              {
                ...base,
                type: "set_due",
                itemId: "i-long",
                columnId: "c-date",
                date: "2026-09-20",
              },
            ],
          },
        ],
      },
      longCtx,
      signals,
    );
    expect(out.suggestions[0]?.actions[0]?.label.length).toBeLessThanOrEqual(
      60,
    );
    expect(payloadSchema.safeParse(out).success).toBe(true);
  });
});
