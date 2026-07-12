import { describe, expect, it } from "vitest";
import {
  BOARD_PROPOSAL_JSON_SCHEMA,
  validateBoardProposal,
  type BoardProposal,
} from "@/lib/ai/board-gen-schema";

/** Deterministic id minter so tests can assert exact remapped references. */
function counter() {
  let n = 0;
  return () => `id-${++n}`;
}

const VALID: BoardProposal = {
  name: "Sprint Board",
  groups: [
    { tempId: "g1", name: "To Do" },
    { tempId: "g2", name: "Done" },
  ],
  columns: [
    {
      tempId: "c1",
      name: "Status",
      kind: "status",
      options: [{ label: "Open" }, { label: "Closed" }],
    },
    { tempId: "c2", name: "Notes", kind: "text" },
    { tempId: "c3", name: "Estimate", kind: "numbers" },
  ],
  items: [
    {
      groupTempId: "g1",
      name: "Item A",
      cells: [
        { columnTempId: "c1", value: { optionId: "Open" } },
        { columnTempId: "c2", value: { text: "hello" } },
        { columnTempId: "c3", value: { n: 3 } },
      ],
    },
    {
      groupTempId: "g2",
      name: "Item B",
      cells: [{ columnTempId: "c1", value: { optionId: "Closed" } }],
    },
    { groupTempId: "g1", name: "Item C", cells: [] },
  ],
};

describe("BOARD_PROPOSAL_JSON_SCHEMA", () => {
  it("requires discriminating fields so the model can't emit empties", () => {
    const s = BOARD_PROPOSAL_JSON_SCHEMA as unknown as {
      required: string[];
      properties: Record<string, unknown>;
    };
    expect(s.required).toEqual(expect.arrayContaining(["name", "columns"]));
    // The kind enum carries all 18 column kinds.
    const colItems = (
      s.properties.columns as { items: { properties: Record<string, unknown> } }
    ).items;
    const kindEnum = (colItems.properties.kind as { enum: string[] }).enum;
    expect(kindEnum).toContain("status");
    expect(kindEnum).toContain("text");
    expect(kindEnum.length).toBe(18);
  });
});

describe("validateBoardProposal", () => {
  it("(a) remaps temp ids to minted ids and confines every reference", () => {
    const res = validateBoardProposal(VALID, { newId: counter() });
    const tp = res.templatePayload;

    expect(tp.groups).toHaveLength(2);
    expect(tp.columns).toHaveLength(3);
    expect(tp.items).toHaveLength(3);

    const groupIds = new Set(tp.groups.map((g) => g.id));
    const columnIds = new Set(tp.columns.map((c) => c.id));

    // Every minted id is a fresh (minted) id, never the temp id.
    expect(groupIds.has("g1")).toBe(false);
    expect(columnIds.has("c1")).toBe(false);
    for (const g of tp.groups) expect(g.id).toMatch(/^id-\d+$/);
    for (const c of tp.columns) expect(c.id).toMatch(/^id-\d+$/);
    for (const it of tp.items) expect(it.id).toMatch(/^id-\d+$/);

    // Confinement: item.groupId ∈ minted groups; cell.columnId ∈ minted columns.
    for (const it of tp.items) {
      expect(groupIds.has(it.groupId)).toBe(true);
      for (const cell of it.cells)
        expect(columnIds.has(cell.columnId)).toBe(true);
    }

    // Status settings carry minted option ids; the cell optionId is re-keyed to one.
    const statusCol = tp.columns.find((c) => c.kind === "status")!;
    const opts = (
      statusCol.settings as { options: { id: string; label: string }[] }
    ).options;
    expect(opts).toHaveLength(2);
    const openId = opts.find((o) => o.label === "Open")!.id;

    const itemA = tp.items[0];
    const statusCell = itemA.cells.find((c) => c.columnId === statusCol.id)!;
    expect((statusCell.value as { optionId: string }).optionId).toBe(openId);

    // positions assigned 0..n
    expect(tp.groups.map((g) => g.position)).toEqual([0, 1]);
    expect(tp.columns.map((c) => c.position)).toEqual([0, 1, 2]);
    expect(tp.items.map((i) => i.position)).toEqual([0, 1, 2]);

    expect(res.name).toBe("Sprint Board");
    expect(res.summary.groups).toBe(2);
    expect(res.summary.columns).toEqual([
      { name: "Status", kind: "status" },
      { name: "Notes", kind: "text" },
      { name: "Estimate", kind: "numbers" },
    ]);
    expect(res.summary.items).toBe(3);
    expect(res.warnings).toEqual([]);
  });

  it("(b) drops a column with an unknown kind and warns", () => {
    const proposal: BoardProposal = {
      name: "X",
      groups: [{ tempId: "g1", name: "G" }],
      columns: [
        { tempId: "c1", name: "Good", kind: "text" },
        { tempId: "c2", name: "Bad", kind: "wormhole" as never },
      ],
      items: [],
    };
    const res = validateBoardProposal(proposal, { newId: counter() });
    expect(res.templatePayload.columns).toHaveLength(1);
    expect(res.templatePayload.columns[0].name).toBe("Good");
    expect(res.warnings.some((w) => /wormhole/i.test(w))).toBe(true);
  });

  it("(c) drops a cell whose value fails cellValueSchema but keeps the item", () => {
    const proposal: BoardProposal = {
      name: "X",
      groups: [{ tempId: "g1", name: "G" }],
      columns: [{ tempId: "c1", name: "Estimate", kind: "numbers" }],
      items: [
        {
          groupTempId: "g1",
          name: "Item",
          cells: [
            { columnTempId: "c1", value: { n: "not a number" } as never },
          ],
        },
      ],
    };
    const res = validateBoardProposal(proposal, { newId: counter() });
    expect(res.templatePayload.items).toHaveLength(1);
    expect(res.templatePayload.items[0].cells).toHaveLength(0);
    expect(res.warnings.length).toBeGreaterThan(0);
  });

  it("(d) reassigns an item with an unknown groupTempId to the first group and warns", () => {
    const proposal: BoardProposal = {
      name: "X",
      groups: [
        { tempId: "g1", name: "First" },
        { tempId: "g2", name: "Second" },
      ],
      columns: [{ tempId: "c1", name: "Notes", kind: "text" }],
      items: [{ groupTempId: "ghost", name: "Orphan", cells: [] }],
    };
    const res = validateBoardProposal(proposal, { newId: counter() });
    expect(res.templatePayload.items).toHaveLength(1);
    expect(res.templatePayload.items[0].groupId).toBe(
      res.templatePayload.groups[0].id,
    );
    expect(res.warnings.some((w) => /group/i.test(w))).toBe(true);
  });

  it("(e) synthesizes a default group when the model emits none", () => {
    const proposal: BoardProposal = {
      name: "X",
      groups: [],
      columns: [{ tempId: "c1", name: "Notes", kind: "text" }],
      items: [{ groupTempId: "whatever", name: "Item", cells: [] }],
    };
    const res = validateBoardProposal(proposal, { newId: counter() });
    expect(res.templatePayload.groups.length).toBeGreaterThanOrEqual(1);
    expect(res.templatePayload.items[0].groupId).toBe(
      res.templatePayload.groups[0].id,
    );
  });

  it("(f) falls back to a default name when blank", () => {
    const proposal: BoardProposal = {
      name: "   ",
      groups: [{ tempId: "g1", name: "G" }],
      columns: [{ tempId: "c1", name: "Notes", kind: "text" }],
      items: [],
    };
    const res = validateBoardProposal(proposal, { newId: counter() });
    expect(res.name.length).toBeGreaterThan(0);
    expect(res.name.trim()).toBe(res.name);
  });

  it("drops relation/mirror columns that can't reference a fresh board", () => {
    const proposal: BoardProposal = {
      name: "X",
      groups: [{ tempId: "g1", name: "G" }],
      columns: [
        { tempId: "c1", name: "Link", kind: "relation" },
        { tempId: "c2", name: "Roll", kind: "mirror" },
        { tempId: "c3", name: "Notes", kind: "text" },
      ],
      items: [],
    };
    const res = validateBoardProposal(proposal, { newId: counter() });
    expect(res.templatePayload.columns.map((c) => c.kind)).toEqual(["text"]);
    expect(res.warnings.length).toBeGreaterThanOrEqual(2);
  });
});
