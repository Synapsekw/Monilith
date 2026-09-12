import { describe, expect, it } from "vitest";
import { buildBoardContext } from "./board-context";
import { payloadSchema } from "./schema";
import {
  toAction,
  toActionParse,
  validateIntelligenceOutput,
} from "./validate";
import type { ActionRejection } from "./validate";
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
  /* The caps are the model's to miss — it is never told them — so busting one
     must cost a truncation, never the whole (already metered) run. */
  it("saves a run whose every field busts a cap, truncated", () => {
    const { payload: out } = validateIntelligenceOutput(
      {
        brief: `${"word ".repeat(300)}end`,
        suggestions: Array.from({ length: 7 }, () => ({
          kind: "overdue",
          title: "T".repeat(200),
          evidence: "E".repeat(100),
          body: "B".repeat(500),
          evidenceItemIds: Array.from({ length: 12 }, () => "i1"),
          actions: [
            {
              ...base,
              type: "set_due",
              itemId: "i1",
              columnId: "c-date",
              date: "2026-09-20",
            },
            { ...base, type: "filter", signalKind: "overdue" },
            { ...base, type: "filter", signalKind: "overdue" },
          ],
        })),
      },
      ctx,
      signals,
    );
    expect(out.brief.length).toBeLessThanOrEqual(700);
    expect(out.suggestions).toHaveLength(5);
    expect(out.suggestions[0]?.actions).toHaveLength(2);
    expect(payloadSchema.safeParse(out).success).toBe(true);
  });

  it("drops a suggestion the model left untitled, keeping the ids contiguous", () => {
    const suggestion = (title: string) => ({
      kind: "overdue" as const,
      title,
      evidence: "1 overdue",
      body: "b",
      evidenceItemIds: ["i1"],
      actions: [
        {
          ...base,
          type: "set_due",
          itemId: "i1",
          columnId: "c-date",
          date: "2026-09-20",
        },
      ],
    });
    const { payload: out, warnings } = validateIntelligenceOutput(
      {
        brief: "One item is late.",
        suggestions: [suggestion("  "), suggestion("Push it")],
      },
      ctx,
      signals,
    );
    expect(out.suggestions).toHaveLength(1);
    expect(out.suggestions[0]?.id).toBe("s1");
    expect(out.suggestions[0]?.title).toBe("Push it");
    expect(warnings.length).toBeGreaterThan(0);
    expect(payloadSchema.safeParse(out).success).toBe(true);
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

// Each case changes exactly ONE field away from a valid action, so the reason
// names the check that actually fired and not an earlier one. Shared by both
// tests below: the second drives the SAME table through `toAction`, which is
// what would catch the two implementations being re-forked.
//
// Keyed by `ActionRejection`, which makes the table EXHAUSTIVE AT COMPILE TIME:
// adding a member to the union without adding its case here fails typecheck. A
// runtime "the table has 17 entries" assertion looked like the same guarantee
// and was not — it passed happily against a hardcoded count while an 18th
// reason went unexercised.
const rejectionCases: Record<ActionRejection, Record<string, unknown>> = {
  "reassign: no itemIds on this board": {
    type: "reassign",
    itemIds: ["ghost"],
    columnId: "c-people",
    toUserId: "u-ana",
  },
  "reassign: columnId is not a people column on this board": {
    type: "reassign",
    itemIds: ["i1"],
    columnId: "c-date",
    toUserId: "u-ana",
  },
  // MISSING, not invented: every action field is required-and-nullable in the
  // model-facing schema, so a null id is a structured-output failure while a
  // wrong one is a grounding failure. Opposite fixes, separate reasons —
  // collapsing them would answer the wrong question.
  "reassign: toUserId is missing": {
    type: "reassign",
    itemIds: ["i1"],
    columnId: "c-people",
    toUserId: null,
  },
  "reassign: toUserId is not a member of this org": {
    type: "reassign",
    itemIds: ["i1"],
    columnId: "c-people",
    toUserId: "u-ghost",
  },
  "set_due: itemId is not on this board": {
    type: "set_due",
    itemId: "nope",
    columnId: "c-date",
    date: "2026-09-20",
  },
  // A real column, but the wrong KIND — the mistake a model actually makes,
  // and the one a bare null could never tell apart from a hallucinated id.
  "set_due: columnId is not a date column on this board": {
    type: "set_due",
    itemId: "i1",
    columnId: "c-status",
    date: "2026-09-20",
  },
  "set_due: date is missing or not YYYY-MM-DD": {
    type: "set_due",
    itemId: "i1",
    columnId: "c-date",
    date: "20 Sep 2026",
  },
  "set_status: itemId is not on this board": {
    type: "set_status",
    itemId: "ghost",
    columnId: "c-status",
    optionId: "o-done",
  },
  "set_status: columnId is not a status column on this board": {
    type: "set_status",
    itemId: "i1",
    columnId: "c-date",
    optionId: "o-done",
  },
  "set_status: optionId is missing": {
    type: "set_status",
    itemId: "i1",
    columnId: "c-status",
    optionId: null,
  },
  "set_status: optionId is not an option on that column": {
    type: "set_status",
    itemId: "i1",
    columnId: "c-status",
    optionId: "o-ghost",
  },
  "nudge: itemId is not on this board": {
    type: "nudge",
    itemId: "ghost",
    userId: "u-ana",
    message: "hi",
  },
  "nudge: userId is missing": {
    type: "nudge",
    itemId: "i1",
    userId: null,
    message: "hi",
  },
  "nudge: userId is not a member of this org": {
    type: "nudge",
    itemId: "i1",
    userId: "u-ghost",
    message: "hi",
  },
  "nudge: message is empty after sanitising": {
    type: "nudge",
    itemId: "i1",
    userId: "u-ana",
    message: "   ",
  },
  "filter: signalKind is not a known signal": {
    type: "filter",
    signalKind: "urgent",
  },
  // `ctx` (not `signalCtx`) carries no signals, so an overloaded filter has no
  // subject to name and would render a button that does nothing.
  "filter: overloaded, but this run has no overloaded signal": {
    type: "filter",
    signalKind: "overloaded",
  },
};

describe("toActionParse — why an action was refused", () => {
  it("names the failing check rather than returning a bare null", () => {
    // Exhaustiveness is the TYPE's job (see the table): if a reason existed
    // with no case, this file would not compile. What this asserts is that each
    // case actually produces the reason it is filed under — a table keyed by
    // the union still permits every entry pointing at the wrong scenario.
    for (const [reason, raw] of Object.entries(rejectionCases)) {
      const parsed = toActionParse({ ...base, ...raw } as never, ctx);
      expect(parsed.ok, `expected ${reason}`).toBe(false);
      expect(parsed.ok ? null : parsed.reason).toBe(reason);
    }
  });

  it("agrees with toAction on every rejection case, so the two cannot be re-forked", () => {
    // Drives the SAME table through both entry points. Today `toAction` is a
    // thin unwrap so this holds trivially; it exists for the day someone
    // reintroduces a second implementation, which is exactly how the null-only
    // version drifted out of usefulness in the first place.
    for (const [reason, raw] of Object.entries(rejectionCases)) {
      const args = { ...base, ...raw } as never;
      expect(toAction(args, ctx), `expected null for ${reason}`).toBeNull();
      expect(toActionParse(args, ctx).ok).toBe(false);
    }
    // And the success path still agrees, so "always null" cannot pass this.
    const valid = {
      ...base,
      type: "set_due",
      itemId: "i1",
      columnId: "c-date",
      date: "2026-09-20",
    } as never;
    const okParse = toActionParse(valid, ctx);
    expect(okParse.ok).toBe(true);
    expect(toAction(valid, ctx)).toEqual(okParse.ok ? okParse.action : null);
  });
});

describe("validateIntelligenceOutput warnings", () => {
  const suggestion = (title: string, actions: unknown[]) => ({
    kind: "overdue",
    title,
    evidence: "1 overdue",
    body: "b",
    evidenceItemIds: ["i1"],
    actions,
  });

  it("sanitises the model's title before it reaches the log", () => {
    // The defect this guards: the warning interpolated the RAW title while only
    // the STORED one was sanitised, so a title carrying a carriage return made
    // two separate warnings render as a single mangled line — in the log whose
    // whole job is to explain a bad run.
    const { warnings } = validateIntelligenceOutput(
      {
        brief: "b",
        suggestions: [
          suggestion("10 items\r\noverdue <script>", [
            {
              ...base,
              type: "set_due",
              itemId: "ghost",
              columnId: "c-date",
              date: "2026-09-20",
            },
          ]),
        ],
      },
      ctx,
      [overdueSignal],
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).not.toMatch(/[\r\n<>]/);
    expect(warnings[0]).toContain("10 items overdue script");
  });

  it("reports which checks failed, not just how many actions died", () => {
    const { warnings, payload: out } = validateIntelligenceOutput(
      {
        brief: "b",
        suggestions: [
          // Two actions, not three: `rawOutputSchema` caps the list at
          // MAX_ACTIONS and TRUNCATES rather than throwing (gotcha-103), so a
          // third would never reach validation and the count would lie.
          suggestion("Partly wrong", [
            { ...base, type: "filter", signalKind: "overdue" },
            {
              ...base,
              type: "set_status",
              itemId: "i1",
              columnId: "c-date",
              optionId: "o-done",
            },
          ]),
        ],
      },
      ctx,
      [overdueSignal],
    );
    // The surviving action keeps the card; the failure is still explained.
    expect(out.suggestions).toHaveLength(1);
    expect(out.suggestions[0]?.actions).toHaveLength(1);
    expect(warnings[0]).toContain("kept 1 of 2 action(s)");
    expect(warnings[0]).toContain(
      "set_status: columnId is not a status column on this board",
    );
  });

  it("explains a suggestion dropped for having no valid action at all", () => {
    const { warnings, payload: out } = validateIntelligenceOutput(
      {
        brief: "b",
        suggestions: [
          // Both fail, for DIFFERENT reasons — which is what proves the log
          // reports every rejection rather than only the first.
          suggestion("All wrong", [
            {
              ...base,
              type: "nudge",
              itemId: "i1",
              userId: "u-ghost",
              message: "hi",
            },
            {
              ...base,
              type: "set_due",
              itemId: "i1",
              columnId: "c-date",
              date: "20 Sep 2026",
            },
          ]),
        ],
      },
      ctx,
      [overdueSignal],
    );
    expect(out.suggestions).toHaveLength(0);
    expect(warnings[0]).toBe(
      'Dropped "All wrong": no valid action — nudge: userId is not a member of this org; set_due: date is missing or not YYYY-MM-DD',
    );
  });

  it("reports how many suggestions the model proposed, so a drop RATE is readable", () => {
    // `warnings.length` cannot stand in for this: the first card below keeps
    // its place with one action gone (one warning, still counted as kept), the
    // second is dropped outright (one warning, not kept). Same warning count,
    // different outcomes — the rate needs the denominator.
    const {
      warnings,
      proposed,
      payload: out,
    } = validateIntelligenceOutput(
      {
        brief: "b",
        suggestions: [
          suggestion("Survives", [
            { ...base, type: "filter", signalKind: "overdue" },
            {
              ...base,
              type: "set_due",
              itemId: "ghost",
              columnId: "c-date",
              date: "2026-09-20",
            },
          ]),
          suggestion("Dies", [
            {
              ...base,
              type: "set_due",
              itemId: "ghost",
              columnId: "c-date",
              date: "2026-09-20",
            },
          ]),
        ],
      },
      ctx,
      [overdueSignal],
    );
    expect(proposed).toBe(2);
    expect(out.suggestions).toHaveLength(1);
    expect(warnings).toHaveLength(2);
  });

  it("counts what the MODEL sent, not what survived the schema's own cap", () => {
    // The blind spot this closes: `cappedArray` truncates silently, so a count
    // taken after the parse can never exceed the cap. A model returning nine
    // suggestions would have been logged as proposing five — and if those five
    // were all valid, the run emitted NO warning at all and the four lost cards
    // left no trace anywhere.
    const valid = { ...base, type: "filter", signalKind: "overdue" };
    const {
      warnings,
      proposed,
      payload: out,
    } = validateIntelligenceOutput(
      {
        brief: "b",
        suggestions: Array.from({ length: 9 }, (_, n) =>
          suggestion(`Card ${n}`, [valid]),
        ),
      },
      ctx,
      [overdueSignal],
    );
    expect(proposed).toBe(9);
    expect(out.suggestions).toHaveLength(5); // MAX_SUGGESTIONS
    // Every surviving card is clean, so the ONLY reason anything is logged is
    // the truncation itself.
    expect(warnings).toEqual([
      "Model proposed 9 suggestions; the schema kept the first 5",
    ]);
  });

  it("quotes the model's own action count when the action cap truncated too", () => {
    const { warnings } = validateIntelligenceOutput(
      {
        brief: "b",
        suggestions: [
          suggestion("Too many actions", [
            { ...base, type: "filter", signalKind: "overdue" },
            {
              ...base,
              type: "set_due",
              itemId: "ghost",
              columnId: "c-date",
              date: "2026-09-20",
            },
            { ...base, type: "filter", signalKind: "overdue" },
            { ...base, type: "filter", signalKind: "overdue" },
          ]),
        ],
      },
      ctx,
      [overdueSignal],
    );
    // 4 sent, 2 kept by the cap, 1 of those rejected — the denominator is the
    // model's 4, and the cap's share is stated rather than hidden.
    expect(warnings[0]).toContain("kept 1 of 4 action(s)");
    expect(warnings[0]).toContain("2 more dropped by the schema cap");
  });

  it("counts the cap as a loss, so the two numbers cover the same population", () => {
    // 3 valid actions, cap keeps 2, none rejected. Reporting "dropped 0 of 3"
    // was true of rejections and false of the card: one action WAS lost. "kept
    // 2 of 3" cannot be read that way.
    const valid = { ...base, type: "filter", signalKind: "overdue" };
    const { warnings } = validateIntelligenceOutput(
      {
        brief: "b",
        suggestions: [suggestion("Capped", [valid, valid, valid])],
      },
      ctx,
      [overdueSignal],
    );
    expect(warnings[0]).toContain("kept 2 of 3 action(s)");
    expect(warnings[0]).toContain("1 more dropped by the schema cap");
    expect(warnings[0]).not.toContain("dropped 0");
  });

  it("attributes an untitled card once, not twice", () => {
    // The card is dropped for having no title; it previously ALSO emitted an
    // action-level warning first, naming the card `""` as though it survived.
    const { warnings, payload: out } = validateIntelligenceOutput(
      {
        brief: "b",
        suggestions: [
          suggestion("   ", [
            { ...base, type: "filter", signalKind: "overdue" },
            {
              ...base,
              type: "set_due",
              itemId: "ghost",
              columnId: "c-date",
              date: "2026-09-20",
            },
          ]),
        ],
      },
      ctx,
      [overdueSignal],
    );
    expect(out.suggestions).toHaveLength(0);
    expect(warnings).toEqual(["Dropped an untitled suggestion"]);
  });
});
