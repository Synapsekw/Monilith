import { describe, it, expect } from "vitest";
import { buildDescribeContext, describeCall } from "./describe";

const BOARD = "b0000000-0000-4000-8000-000000000000";
const G1 = "g1000000-0000-4000-8000-000000000000";
const G2 = "g2000000-0000-4000-8000-000000000000";
const PRESS = "i1000000-0000-4000-8000-000000000000";
const PRICING = "i2000000-0000-4000-8000-000000000000";
const STATUS = "c1000000-0000-4000-8000-000000000000";
const OWNER = "c2000000-0000-4000-8000-000000000000";
const DATE = "c3000000-0000-4000-8000-000000000000";
const BUDGET = "c4000000-0000-4000-8000-000000000000";
const NOTES = "c5000000-0000-4000-8000-000000000000";
const TAGS = "c6000000-0000-4000-8000-000000000000";
const DONE = "c7000000-0000-4000-8000-000000000000";
const FILES = "c8000000-0000-4000-8000-000000000000";
const DANIJEL = "u1000000-0000-4000-8000-000000000000";
const ANA = "u2000000-0000-4000-8000-000000000000";
const UNKNOWN = "ffffffff-ffff-4fff-8fff-ffffffffffff";

function payload(over: { itemName?: string; groupName?: string } = {}) {
  return {
    board: { id: BOARD, org_id: "o-1", name: "Assistant test" },
    groups: [
      { id: G1, name: over.groupName ?? "Group 1" },
      { id: G2, name: "Done" },
    ],
    columns: [
      {
        id: STATUS,
        name: "Status",
        kind: "status",
        settings: {
          options: [
            { id: "opt-wip", label: "Working on it", color: "amber" },
            { id: "opt-done", label: "Done", color: "green" },
          ],
        },
      },
      { id: OWNER, name: "Owner", kind: "people", settings: {} },
      { id: DATE, name: "Date", kind: "date", settings: {} },
      { id: BUDGET, name: "Budget", kind: "numbers", settings: {} },
      { id: NOTES, name: "Notes", kind: "text", settings: {} },
      {
        id: TAGS,
        name: "Tags",
        kind: "dropdown",
        settings: {
          options: [
            { id: "t-a", label: "Launch", color: "blue" },
            { id: "t-b", label: "Web", color: "red" },
          ],
        },
      },
      { id: DONE, name: "Signed off", kind: "checkbox", settings: {} },
      { id: FILES, name: "Files", kind: "files", settings: {} },
    ],
    items: [
      {
        id: PRESS,
        name: over.itemName ?? "Press kit",
        group_id: G1,
        parent_id: null,
      },
      { id: PRICING, name: "Pricing page copy", group_id: G1, parent_id: null },
    ],
    cellValues: [],
  };
}
const members = [
  { userId: DANIJEL, fullName: "Danijel Jovanovic" },
  { userId: ANA, fullName: "Ana" },
];
const ctx = (over?: Parameters<typeof payload>[0]) =>
  buildDescribeContext(payload(over) as never, members);

describe("describeCall · update_item", () => {
  it("names the item and the status option label", () => {
    expect(
      describeCall(
        "update_item",
        {
          itemId: PRESS,
          fields: [{ columnId: STATUS, value: { optionId: "opt-wip" } }],
        },
        ctx(),
      ),
    ).toBe('Press kit: set Status to "Working on it"');
  });

  it("names the person a people column is set to", () => {
    expect(
      describeCall(
        "update_item",
        {
          itemId: PRICING,
          fields: [{ columnId: OWNER, value: { userIds: [DANIJEL] } }],
        },
        ctx(),
      ),
    ).toBe("Pricing page copy: set Owner to Danijel Jovanovic");
  });

  it("joins a rename and several fields with semicolons", () => {
    expect(
      describeCall(
        "update_item",
        {
          itemId: PRESS,
          name: "Press kit v2",
          fields: [
            { columnId: DATE, value: { date: "2026-11-13" } },
            { columnId: BUDGET, value: { n: 1200 } },
            { columnId: NOTES, value: { text: "Ready" } },
            { columnId: TAGS, value: { optionIds: ["t-a", "t-b"] } },
            { columnId: DONE, value: { checked: true } },
            { columnId: OWNER, value: { userIds: [] } },
            { columnId: STATUS, value: { optionId: null } },
          ],
        },
        ctx(),
      ),
    ).toBe(
      'Press kit: rename to "Press kit v2"; set Date to 2026-11-13; set Budget to 1200; set Notes to "Ready"; set Tags to "Launch", "Web"; tick Signed off; clear Owner; clear Status',
    );
  });

  it("falls back when the item, column, option or person is not on the board", () => {
    const field = (columnId: string, value: Record<string, unknown>) => ({
      itemId: PRESS,
      fields: [{ columnId, value }],
    });
    expect(
      describeCall("update_item", { itemId: UNKNOWN, name: "x" }, ctx()),
    ).toBeNull();
    expect(
      describeCall("update_item", field(UNKNOWN, { text: "x" }), ctx()),
    ).toBeNull();
    expect(
      describeCall("update_item", field(STATUS, { optionId: "nope" }), ctx()),
    ).toBeNull();
    expect(
      describeCall("update_item", field(OWNER, { userIds: [UNKNOWN] }), ctx()),
    ).toBeNull();
    // A kind it does not describe.
    expect(describeCall("update_item", field(FILES, {}), ctx())).toBeNull();
    // A value whose shape does not match the column kind.
    expect(
      describeCall("update_item", field(DATE, { n: 3 }), ctx()),
    ).toBeNull();
    // Nothing to change.
    expect(describeCall("update_item", { itemId: PRESS }, ctx())).toBeNull();
  });

  it("sanitises a name containing markup or a newline", () => {
    const label = describeCall(
      "update_item",
      {
        itemId: PRESS,
        fields: [{ columnId: STATUS, value: { optionId: "opt-done" } }],
      },
      ctx({ itemName: "<b>Press</b>\nkit" }),
    );
    expect(label).toBe('bPress/b kit: set Status to "Done"');
    expect(label).not.toMatch(/[<>\n]/);
  });
});

describe("describeCall · create_item", () => {
  it("lists a batch with the group name and each item's fields", () => {
    expect(
      describeCall(
        "create_item",
        {
          groupId: G1,
          items: [
            {
              name: "Draft launch email",
              fields: [{ columnId: DATE, value: { date: "2026-11-13" } }],
            },
            { name: "Book venue" },
            { name: "Send invites to partners" },
          ],
        },
        ctx(),
      ),
    ).toBe(
      "Add 3 items to Group 1: Draft launch email (Date 2026-11-13), Book venue, Send invites to partners",
    );
  });

  it("describes the single-item form", () => {
    expect(
      describeCall(
        "create_item",
        {
          groupId: G2,
          name: "Ship it",
          fields: [
            { columnId: STATUS, value: { optionId: "opt-done" } },
            { columnId: OWNER, value: { userIds: [ANA, DANIJEL] } },
          ],
        },
        ctx(),
      ),
    ).toBe(
      'Add 1 item to Done: Ship it (Status "Done"; Owner Ana, Danijel Jovanovic)',
    );
  });

  it("falls back for an unknown group or field", () => {
    expect(
      describeCall("create_item", { groupId: UNKNOWN, name: "x" }, ctx()),
    ).toBeNull();
    expect(
      describeCall(
        "create_item",
        {
          groupId: G1,
          name: "x",
          fields: [{ columnId: UNKNOWN, value: { text: "y" } }],
        },
        ctx(),
      ),
    ).toBeNull();
  });

  it("sanitises a group name containing markup or a newline", () => {
    expect(
      describeCall(
        "create_item",
        { groupId: G1, name: "x" },
        ctx({ groupName: "<i>Q4</i>\r\nplan" }),
      ),
    ).toBe("Add 1 item to iQ4/i plan: x");
  });
});

describe("describeCall · manage_item", () => {
  it("describes archive, restore, move and add_subitem", () => {
    expect(
      describeCall("manage_item", { action: "archive", itemId: PRESS }, ctx()),
    ).toBe('Archive the item "Press kit"');
    expect(
      describeCall("manage_item", { action: "restore", itemId: PRESS }, ctx()),
    ).toBe('Restore the item "Press kit"');
    expect(
      describeCall(
        "manage_item",
        { action: "move", itemId: PRESS, groupId: G2 },
        ctx(),
      ),
    ).toBe('Move "Press kit" to Done');
    expect(
      describeCall(
        "manage_item",
        { action: "add_subitem", itemId: PRESS, name: "Logo files" },
        ctx(),
      ),
    ).toBe('Add the subitem "Logo files" under "Press kit"');
  });

  it("falls back for reorder, an unknown item or an unknown group", () => {
    expect(
      describeCall(
        "manage_item",
        { action: "reorder", itemId: PRESS, position: 2 },
        ctx(),
      ),
    ).toBeNull();
    expect(
      describeCall(
        "manage_item",
        { action: "archive", itemId: UNKNOWN },
        ctx(),
      ),
    ).toBeNull();
    expect(
      describeCall(
        "manage_item",
        { action: "move", itemId: PRESS, groupId: UNKNOWN },
        ctx(),
      ),
    ).toBeNull();
  });
});

describe("describeCall · manage_board", () => {
  it("describes archive, rename, duplicate and restore of the focused board", () => {
    expect(
      describeCall(
        "manage_board",
        { action: "archive", boardId: BOARD },
        ctx(),
      ),
    ).toBe('Archive the board "Assistant test"');
    expect(
      describeCall(
        "manage_board",
        { action: "rename", boardId: BOARD, name: "Launch" },
        ctx(),
      ),
    ).toBe('Rename the board "Assistant test" to "Launch"');
    expect(
      describeCall(
        "manage_board",
        { action: "duplicate", boardId: BOARD },
        ctx(),
      ),
    ).toBe('Duplicate the board "Assistant test"');
    expect(
      describeCall(
        "manage_board",
        { action: "restore", boardId: BOARD },
        ctx(),
      ),
    ).toBe('Restore the board "Assistant test"');
  });

  it("falls back for another board or a create", () => {
    expect(
      describeCall(
        "manage_board",
        { action: "archive", boardId: UNKNOWN },
        ctx(),
      ),
    ).toBeNull();
    expect(
      describeCall(
        "manage_board",
        { action: "create", workspaceId: UNKNOWN, name: "New" },
        ctx(),
      ),
    ).toBeNull();
  });
});

describe("describeCall · fallbacks and limits", () => {
  it("returns null without a context or for an unknown tool", () => {
    expect(
      describeCall("update_item", { itemId: PRESS, name: "x" }, null),
    ).toBeNull();
    expect(describeCall("manage_goal", { action: "update" }, ctx())).toBeNull();
  });

  it("clips to 500 characters with an ellipsis", () => {
    const label = describeCall(
      "create_item",
      {
        groupId: G1,
        items: Array.from({ length: 50 }, (_, i) => ({
          name: `A fairly long item name number ${i}`,
        })),
      },
      ctx(),
    )!;
    expect(label).toHaveLength(500);
    expect(label.endsWith("…")).toBe(true);
  });
});
