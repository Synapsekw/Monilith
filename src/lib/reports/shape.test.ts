import { describe, expect, it } from "vitest";
import { computeKpis, shapeReport } from "@/lib/reports/shape";
import type { BoardPayload } from "@/lib/boards/queries";

function fixture(): BoardPayload {
  return {
    board: { id: "b1", name: "Board", org_id: "o1" } as BoardPayload["board"],
    groups: [
      {
        id: "g1",
        board_id: "b1",
        name: "Design",
        color: "#8ea2eb",
        position: 1,
      } as BoardPayload["groups"][number],
    ],
    columns: [
      {
        id: "c1",
        board_id: "b1",
        kind: "status",
        name: "Status",
        settings: { options: [{ id: "s1", label: "Done", color: "#22c55e" }] },
        position: 1,
      } as unknown as BoardPayload["columns"][number],
    ],
    items: [
      {
        id: "i1",
        board_id: "b1",
        group_id: "g1",
        parent_id: null,
        name: "Item A",
        position: 1,
      } as BoardPayload["items"][number],
      {
        id: "i2",
        board_id: "b1",
        group_id: "g1",
        parent_id: null,
        name: "Item B",
        position: 2,
      } as BoardPayload["items"][number],
    ],
    cellValues: [
      {
        item_id: "i1",
        column_id: "c1",
        value: { optionId: "s1" },
      } as unknown as BoardPayload["cellValues"][number],
    ],
    views: [],
    dependencies: [],
    attachments: [],
    timeEntries: [],
    relationLinks: [],
    mirrorTargetCells: [],
    mirrorTargetColumns: [],
  };
}

describe("shapeReport", () => {
  it("groups items and resolves a status cell to display text + option color", () => {
    const model = shapeReport(fixture(), new Map());
    expect(model.groups).toHaveLength(1);
    expect(model.groups[0].rows).toHaveLength(2);
    const cell = model.groups[0].rows[0].cells.get("c1");
    expect(cell?.text).toBe("Done");
    expect(cell?.color).toBe("#22c55e");
  });

  it("computeKpis counts items and % complete off the status column", () => {
    const kpis = computeKpis(fixture(), new Map());
    expect(kpis.itemCount).toBe(2);
    expect(kpis.percentComplete).toBe(50); // 1 of 2 is "Done"
  });

  it("counts LEAF items — a status-less parent header doesn't dilute completion", () => {
    // Board shape like QCC: a header parent (no status) with two subitems that
    // carry the status. KPIs should count the 2 leaves, not the header.
    const base = fixture();
    const parent = {
      id: "p1",
      board_id: "b1",
      group_id: "g1",
      parent_id: null,
      name: "Phase 1",
      position: 1,
    } as unknown as BoardPayload["items"][number];
    const sub1 = {
      id: "s-a",
      board_id: "b1",
      group_id: "g1",
      parent_id: "p1",
      name: "Task A",
      position: 1,
    } as unknown as BoardPayload["items"][number];
    const sub2 = {
      id: "s-b",
      board_id: "b1",
      group_id: "g1",
      parent_id: "p1",
      name: "Task B",
      position: 2,
    } as unknown as BoardPayload["items"][number];
    base.items = [parent, sub1, sub2];
    base.cellValues = [
      {
        item_id: "s-a",
        column_id: "c1",
        value: { optionId: "s1" }, // "Done"
      } as unknown as BoardPayload["cellValues"][number],
    ];

    const kpis = computeKpis(base, new Map());
    expect(kpis.itemCount).toBe(2); // two leaves, header excluded
    expect(kpis.percentComplete).toBe(50); // 1 of 2 leaves is "Done"

    // The parent's row nests its subitems so the table can render them.
    const model = shapeReport(base, new Map());
    expect(model.groups[0].rows).toHaveLength(1); // the parent
    expect(model.groups[0].rows[0].subitems).toHaveLength(2);
    expect(model.groups[0].rows[0].subitems[0].cells.get("c1")?.text).toBe(
      "Done",
    );
  });
});
