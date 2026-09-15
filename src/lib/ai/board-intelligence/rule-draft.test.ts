import { describe, expect, it } from "vitest";
import { ruleDraftFor, type RuleBoardMeta } from "./rule-draft";

const DATE = "aaaaaaaa-0000-4000-8000-000000000001";
const PEOPLE = "aaaaaaaa-0000-4000-8000-000000000002";
const STATUS = "aaaaaaaa-0000-4000-8000-000000000003";
const USER = "bbbbbbbb-0000-4000-8000-000000000001";

function meta(kinds: Record<string, string>): RuleBoardMeta {
  return {
    columns: Object.entries(kinds).map(([id, kind]) => ({ id, kind })),
    memberIds: [USER],
  };
}

describe("ruleDraftFor", () => {
  it("maps reassign onto item_created + assign_person", () => {
    const draft = ruleDraftFor(
      {
        type: "reassign",
        itemIds: ["i1"],
        columnId: PEOPLE,
        toUserId: USER,
        label: "Reassign",
      },
      meta({ [PEOPLE]: "people" }),
    );
    expect(draft).toEqual({
      trigger: { type: "item_created" },
      actions: [{ type: "assign_person", columnId: PEOPLE, userId: USER }],
    });
  });

  it("maps set_status onto date_reached + set_option", () => {
    const draft = ruleDraftFor(
      {
        type: "set_status",
        itemId: "i1",
        columnId: STATUS,
        optionId: "o1",
        label: "Set status",
      },
      meta({ [DATE]: "date", [STATUS]: "status" }),
    );
    expect(draft).toEqual({
      trigger: { type: "date_reached", columnId: DATE, offsetDays: 0 },
      actions: [{ type: "set_option", columnId: STATUS, optionId: "o1" }],
    });
  });

  it("maps set_status onto date_reached + set_option for dropdown columns too", () => {
    const DROPDOWN = "cccccccc-0000-4000-8000-000000000004";
    const draft = ruleDraftFor(
      {
        type: "set_status",
        itemId: "i1",
        columnId: DROPDOWN,
        optionId: "o1",
        label: "Set status",
      },
      meta({ [DATE]: "date", [DROPDOWN]: "dropdown" }),
    );
    expect(draft).toEqual({
      trigger: { type: "date_reached", columnId: DATE, offsetDays: 0 },
      actions: [{ type: "set_option", columnId: DROPDOWN, optionId: "o1" }],
    });
  });

  it("maps nudge onto date_reached + notify the owner", () => {
    const draft = ruleDraftFor(
      {
        type: "nudge",
        itemId: "i1",
        userId: USER,
        message: "ping",
        label: "Nudge",
      },
      meta({ [DATE]: "date", [PEOPLE]: "people" }),
    );
    // The engine's notify carries a recipient and NO message, so the card's
    // message text cannot survive into a rule (spec §2.2).
    expect(draft).toEqual({
      trigger: { type: "date_reached", columnId: DATE, offsetDays: 0 },
      actions: [
        {
          type: "notify",
          recipient: { kind: "owner", peopleColumnId: PEOPLE },
        },
      ],
    });
  });

  it("returns null for nudge with no people column", () => {
    expect(
      ruleDraftFor(
        {
          type: "nudge",
          itemId: "i1",
          userId: USER,
          message: "ping",
          label: "Nudge",
        },
        meta({ [DATE]: "date" }),
      ),
    ).toBeNull();
  });

  it("returns null for set_status with no date column", () => {
    expect(
      ruleDraftFor(
        {
          type: "set_status",
          itemId: "i1",
          columnId: STATUS,
          optionId: "o1",
          label: "Set status",
        },
        meta({ [STATUS]: "status" }),
      ),
    ).toBeNull();
  });

  it("returns null for set_status when target column is absent", () => {
    const ABSENT = "cccccccc-0000-4000-8000-000000000005";
    expect(
      ruleDraftFor(
        {
          type: "set_status",
          itemId: "i1",
          columnId: ABSENT,
          optionId: "o1",
          label: "Set status",
        },
        meta({ [DATE]: "date", [STATUS]: "status" }),
      ),
    ).toBeNull();
  });

  it("returns null for set_status when target column is not status or dropdown", () => {
    const TEXT = "cccccccc-0000-4000-8000-000000000006";
    expect(
      ruleDraftFor(
        {
          type: "set_status",
          itemId: "i1",
          columnId: TEXT,
          optionId: "o1",
          label: "Set status",
        },
        meta({ [DATE]: "date", [TEXT]: "text" }),
      ),
    ).toBeNull();
  });

  it("returns null when reassign names a column that is not a people column here", () => {
    expect(
      ruleDraftFor(
        {
          type: "reassign",
          itemIds: ["i1"],
          columnId: STATUS,
          toUserId: USER,
          label: "Reassign",
        },
        meta({ [STATUS]: "status" }),
      ),
    ).toBeNull();
  });

  it("returns null when reassign names someone who is not a member", () => {
    expect(
      ruleDraftFor(
        {
          type: "reassign",
          itemIds: ["i1"],
          columnId: PEOPLE,
          toUserId: "cccccccc-0000-4000-8000-000000000009",
          label: "Reassign",
        },
        meta({ [PEOPLE]: "people" }),
      ),
    ).toBeNull();
  });

  it("returns null for set_due and filter — neither maps onto a primitive", () => {
    expect(
      ruleDraftFor(
        {
          type: "set_due",
          itemId: "i1",
          columnId: DATE,
          date: "2026-09-20",
          label: "Set due",
        },
        meta({ [DATE]: "date" }),
      ),
    ).toBeNull();
    expect(
      ruleDraftFor(
        { type: "filter", signalKind: "overdue", label: "Show" },
        meta({ [DATE]: "date" }),
      ),
    ).toBeNull();
  });
});
