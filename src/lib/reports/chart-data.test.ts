import { describe, expect, it } from "vitest";
import { computeChartSeries } from "@/lib/reports/chart-data";
import type { ChartBlockOptions } from "@/lib/reports/config";
import type { BoardPayload } from "@/lib/boards/queries";

const OPTS: ChartBlockOptions = {
  variant: "donut",
  source: "status",
  columnId: null,
  title: "",
  maxCategories: 6,
};
const opts = (o: Partial<ChartBlockOptions> = {}): ChartBlockOptions => ({
  ...OPTS,
  ...o,
});
const NAMES = new Map<string, string>();

/** Minimal payload builder — only the fields the shaper reads. */
function payload(args: {
  columns?: unknown[];
  groups?: unknown[];
  items?: unknown[];
  cellValues?: unknown[];
}): BoardPayload {
  return {
    board: { id: "b1", name: "Board" },
    columns: args.columns ?? [],
    groups: args.groups ?? [],
    items: args.items ?? [],
    cellValues: args.cellValues ?? [],
  } as unknown as BoardPayload;
}

const statusCol = (
  options: { id: string; label: string; color?: string }[],
) => ({
  id: "c1",
  name: "Status",
  kind: "status",
  position: 0,
  settings: { options },
});

const item = (id: string, groupId = "g1", parentId: string | null = null) => ({
  id,
  name: id,
  group_id: groupId,
  parent_id: parentId,
  position: 0,
});

const cell = (itemId: string, optionId: string | null) => ({
  item_id: itemId,
  column_id: "c1",
  value: optionId === null ? null : { optionId },
});

describe("computeChartSeries", () => {
  it("is empty when the board has no items", () => {
    const s = computeChartSeries(
      payload({ columns: [statusCol([])] }),
      NAMES,
      opts(),
    );
    expect(s.empty).toBe(true);
    expect(s.total).toBe(0);
    expect(s.categories).toEqual([]);
  });

  it("is empty when source=status and the board has no status column", () => {
    const s = computeChartSeries(
      payload({ items: [item("i1")] }),
      NAMES,
      opts({ source: "status" }),
    );
    expect(s.empty).toBe(true);
  });

  it("is empty when source=column points at a deleted column", () => {
    const s = computeChartSeries(
      payload({ columns: [statusCol([])], items: [item("i1")] }),
      NAMES,
      opts({ source: "column", columnId: "gone" }),
    );
    expect(s.empty).toBe(true);
  });

  it("counts LEAF items only, so the total matches the KPI item count", () => {
    const s = computeChartSeries(
      payload({
        columns: [statusCol([{ id: "o1", label: "Done", color: "#00aa00" }])],
        items: [item("parent"), item("kid", "g1", "parent")],
        cellValues: [cell("parent", "o1"), cell("kid", "o1")],
      }),
      NAMES,
      opts(),
    );
    expect(s.total).toBe(1); // "parent" has a child → not a leaf
    expect(s.categories).toEqual([
      { key: "o1", label: "Done", value: 1, color: "#00aa00" },
    ]);
  });

  it("uses the board option color when configured", () => {
    const s = computeChartSeries(
      payload({
        columns: [
          statusCol([
            { id: "o1", label: "Done", color: "#00aa00" },
            { id: "o2", label: "Stuck", color: "#dd0000" },
          ]),
        ],
        items: [item("i1"), item("i2"), item("i3")],
        cellValues: [cell("i1", "o1"), cell("i2", "o1"), cell("i3", "o2")],
      }),
      NAMES,
      opts(),
    );
    expect(s.categories.map((c) => [c.label, c.value, c.color])).toEqual([
      ["Done", 2, "#00aa00"],
      ["Stuck", 1, "#dd0000"],
    ]);
  });

  it("assigns ramp slots by SETTINGS index, not by rank (no repaint on reorder)", () => {
    // o1 is first in settings but LAST by value; it must still get slot 1.
    const p = payload({
      columns: [
        statusCol([
          { id: "o1", label: "A" },
          { id: "o2", label: "B" },
        ]),
      ],
      items: [item("i1"), item("i2"), item("i3")],
      cellValues: [cell("i1", "o1"), cell("i2", "o2"), cell("i3", "o2")],
    });
    const s = computeChartSeries(p, NAMES, opts());
    expect(s.categories.map((c) => c.label)).toEqual(["B", "A"]); // value desc
    expect(s.categories.find((c) => c.label === "A")?.color).toBe("#5866c4"); // slot 1
    expect(s.categories.find((c) => c.label === "B")?.color).toBe("#eb6834"); // slot 2
  });

  it("labels blank cells '—' in the reserved neutral, never a ramp slot", () => {
    const s = computeChartSeries(
      payload({
        columns: [statusCol([{ id: "o1", label: "Done" }])],
        items: [item("i1"), item("i2")],
        cellValues: [cell("i1", "o1"), cell("i2", null)],
      }),
      NAMES,
      opts(),
    );
    const none = s.categories.find((c) => c.key === "__none");
    expect(none).toMatchObject({ label: "—", value: 1, color: "#9aa1b1" });
  });

  it("folds the tail into a neutral 'Other' at maxCategories", () => {
    const options = ["a", "b", "c", "d", "e"].map((id) => ({
      id,
      label: id.toUpperCase(),
    }));
    // counts: a=5 b=4 c=3 d=2 e=1
    const items: unknown[] = [];
    const cells: unknown[] = [];
    let n = 0;
    options.forEach((o, i) => {
      for (let k = 0; k < 5 - i; k++) {
        const id = `i${n++}`;
        items.push(item(id));
        cells.push(cell(id, o.id));
      }
    });
    const s = computeChartSeries(
      payload({ columns: [statusCol(options)], items, cellValues: cells }),
      NAMES,
      opts({ maxCategories: 3 }),
    );
    expect(s.categories.map((c) => [c.key, c.value])).toEqual([
      ["a", 5],
      ["b", 4],
      ["__other", 6], // 3 + 2 + 1
    ]);
    expect(s.categories[2].color).toBe("#9aa1b1");
    expect(s.total).toBe(15);
  });

  it("breaks value ties by label ascending (deterministic preview/PDF parity)", () => {
    const s = computeChartSeries(
      payload({
        columns: [
          statusCol([
            { id: "z", label: "Zeta" },
            { id: "a", label: "Alpha" },
          ]),
        ],
        items: [item("i1"), item("i2")],
        cellValues: [cell("i1", "z"), cell("i2", "a")],
      }),
      NAMES,
      opts(),
    );
    expect(s.categories.map((c) => c.label)).toEqual(["Alpha", "Zeta"]);
  });

  it("counts an item once per selected value for a multi-value column", () => {
    const s = computeChartSeries(
      payload({
        columns: [
          {
            id: "c1",
            name: "Tags",
            kind: "dropdown",
            position: 0,
            settings: {
              options: [
                { id: "x", label: "X" },
                { id: "y", label: "Y" },
              ],
            },
          },
        ],
        items: [item("i1")],
        cellValues: [
          { item_id: "i1", column_id: "c1", value: { optionIds: ["x", "y"] } },
        ],
      }),
      NAMES,
      opts({ source: "column", columnId: "c1" }),
    );
    expect(s.total).toBe(1);
    expect(s.categories.reduce((n, c) => n + c.value, 0)).toBe(2);
  });

  it("charts board groups with their own colors when source=board_group", () => {
    const s = computeChartSeries(
      payload({
        groups: [
          { id: "g1", name: "Now", color: "#112233", position: 0 },
          { id: "g2", name: "Later", color: "#445566", position: 1 },
        ],
        items: [item("i1", "g1"), item("i2", "g2"), item("i3", "g2")],
      }),
      NAMES,
      opts({ source: "board_group" }),
    );
    expect(s.categoryName).toBe("Group");
    expect(s.categories.map((c) => [c.label, c.value, c.color])).toEqual([
      ["Later", 2, "#445566"],
      ["Now", 1, "#112233"],
    ]);
  });

  it("resolves people ids to names and gives them stable name-ordered slots", () => {
    const names = new Map([
      ["u1", "Zoe"],
      ["u2", "Ada"],
    ]);
    const s = computeChartSeries(
      payload({
        columns: [
          {
            id: "c1",
            name: "Owner",
            kind: "people",
            position: 0,
            settings: null,
          },
        ],
        items: [item("i1"), item("i2"), item("i3")],
        cellValues: [
          { item_id: "i1", column_id: "c1", value: { userIds: ["u1"] } },
          { item_id: "i2", column_id: "c1", value: { userIds: ["u1"] } },
          { item_id: "i3", column_id: "c1", value: { userIds: ["u2"] } },
        ],
      }),
      names,
      opts({ source: "column", columnId: "c1" }),
    );
    expect(s.categoryName).toBe("Owner");
    // Ada sorts first by name → slot 1, even though Zoe has more items.
    expect(s.categories.find((c) => c.label === "Ada")?.color).toBe("#5866c4");
    expect(s.categories.find((c) => c.label === "Zoe")?.color).toBe("#eb6834");
    expect(s.categories.map((c) => c.label)).toEqual(["Zoe", "Ada"]); // value desc
  });

  it("uses the status column's name for the derived title", () => {
    const s = computeChartSeries(
      payload({
        columns: [statusCol([{ id: "o1", label: "Done" }])],
        items: [item("i1")],
        cellValues: [cell("i1", "o1")],
      }),
      NAMES,
      opts(),
    );
    expect(s.categoryName).toBe("Status");
  });
});
