import { describe, expect, it } from "vitest";
import {
  addDependency,
  buildCellMap,
  cellKey,
  insertColumn,
  insertItem,
  removeCellValue,
  removeColumn,
  removeDependency,
  replaceColumn,
  replaceGroup,
  replaceItem,
  replaceBoard,
  upsertCellValue,
  type BoardCache,
  type CacheColumn,
  type CacheDependency,
} from "./cache";

function baseCache(): BoardCache {
  return {
    board: { id: "b1", org_id: "o1", name: "B" } as BoardCache["board"],
    groups: [],
    columns: [],
    items: [
      { id: "i1", board_id: "b1", group_id: "g1", name: "One" } as never,
      { id: "i2", board_id: "b1", group_id: "g1", name: "Two" } as never,
    ],
    cellValues: [
      {
        item_id: "i1",
        column_id: "c1",
        org_id: "o1",
        board_id: "b1",
        value: { text: "old" },
      } as never,
    ],
    dependencies: [],
  };
}

describe("upsertCellValue", () => {
  it("replaces an existing cell value by (item_id, column_id)", () => {
    const next = upsertCellValue(baseCache(), {
      item_id: "i1",
      column_id: "c1",
      org_id: "o1",
      board_id: "b1",
      value: { text: "new" },
    } as never);
    const cell = next.cellValues.find(
      (c) => c.item_id === "i1" && c.column_id === "c1",
    );
    expect((cell!.value as { text: string }).text).toBe("new");
    expect(next.cellValues).toHaveLength(1);
  });

  it("inserts a new cell value when none exists", () => {
    const next = upsertCellValue(baseCache(), {
      item_id: "i2",
      column_id: "c1",
      org_id: "o1",
      board_id: "b1",
      value: { text: "x" },
    } as never);
    expect(next.cellValues).toHaveLength(2);
  });

  it("does not mutate the input cache (immutable)", () => {
    const input = baseCache();
    upsertCellValue(input, {
      item_id: "i1",
      column_id: "c1",
      org_id: "o1",
      board_id: "b1",
      value: { text: "new" },
    } as never);
    expect((input.cellValues[0].value as { text: string }).text).toBe("old");
  });
});

describe("removeCellValue", () => {
  it("removes the cell value for (item_id, column_id)", () => {
    const next = removeCellValue(baseCache(), "i1", "c1");
    expect(next.cellValues).toHaveLength(0);
  });

  it("is a no-op when the cell does not exist", () => {
    const next = removeCellValue(baseCache(), "i2", "c9");
    expect(next.cellValues).toHaveLength(1);
  });
});

describe("replaceItem", () => {
  it("replaces a matching item by id", () => {
    const next = replaceItem(baseCache(), {
      id: "i1",
      board_id: "b1",
      group_id: "g1",
      name: "Renamed",
    } as never);
    expect(next.items.find((i) => i.id === "i1")!.name).toBe("Renamed");
  });
});

describe("replaceBoard", () => {
  it("replaces the board row", () => {
    const next = replaceBoard(baseCache(), {
      id: "b1",
      org_id: "o1",
      name: "Renamed board",
    } as never);
    expect(next.board.name).toBe("Renamed board");
  });
});

describe("replaceGroup", () => {
  it("replaces a matching group by id", () => {
    const withGroup = {
      ...baseCache(),
      groups: [
        {
          id: "g1",
          board_id: "b1",
          name: "Group 1",
          color: "#0073ea",
        } as never,
      ],
    };
    const next = replaceGroup(withGroup, {
      id: "g1",
      board_id: "b1",
      name: "Renamed group",
      color: "#0073ea",
    } as never);
    expect(next.groups.find((g) => g.id === "g1")!.name).toBe("Renamed group");
  });
});

describe("insertItem", () => {
  it("appends a new item", () => {
    const next = insertItem(baseCache(), {
      id: "i3",
      board_id: "b1",
      group_id: "g1",
      name: "Three",
    } as never);
    expect(next.items).toHaveLength(3);
  });

  it("is idempotent — does not duplicate an existing item id", () => {
    const next = insertItem(baseCache(), {
      id: "i1",
      board_id: "b1",
      group_id: "g1",
      name: "One",
    } as never);
    expect(next.items).toHaveLength(2);
  });
});

describe("buildCellMap", () => {
  const cells = [
    { item_id: "i1", column_id: "c1", value: { optionId: "o1" } },
    { item_id: "i1", column_id: "c2", value: 5 },
    { item_id: "i2", column_id: "c1", value: null },
  ] as never[];

  it("keys values by item:column for O(1) lookup", () => {
    const map = buildCellMap(cells);
    expect(map.get(cellKey("i1", "c2"))).toBe(5);
    expect(map.get(cellKey("i1", "c1"))).toEqual({ optionId: "o1" });
    expect(map.get(cellKey("i2", "c9"))).toBeUndefined();
  });

  it("uses a colon-delimited key", () => {
    expect(cellKey("i1", "c2")).toBe("i1:c2");
  });
});

const dep1: CacheDependency = {
  id: "dep1",
  org_id: "o1",
  board_id: "b1",
  predecessor_id: "i1",
  successor_id: "i2",
  type: "FS",
  created_at: "2026-06-16T00:00:00Z",
};

describe("addDependency", () => {
  it("appends a new dependency", () => {
    const next = addDependency(baseCache(), dep1);
    expect(next.dependencies).toHaveLength(1);
    expect(next.dependencies[0].id).toBe("dep1");
  });

  it("is idempotent — does not duplicate an existing dep id", () => {
    const withOne = addDependency(baseCache(), dep1);
    const withTwo = addDependency(withOne, dep1);
    expect(withTwo.dependencies).toHaveLength(1);
  });

  it("does not mutate the input cache (immutable)", () => {
    const input = baseCache();
    addDependency(input, dep1);
    expect(input.dependencies).toHaveLength(0);
  });
});

describe("removeDependency", () => {
  it("removes a dependency by id", () => {
    const withOne = addDependency(baseCache(), dep1);
    const next = removeDependency(withOne, "dep1");
    expect(next.dependencies).toHaveLength(0);
  });

  it("is a no-op when the dependency is absent", () => {
    const next = removeDependency(baseCache(), "nonexistent");
    expect(next.dependencies).toHaveLength(0);
  });
});

function col(
  id: string,
  position: number,
  over: Partial<CacheColumn> = {},
): CacheColumn {
  return {
    id,
    org_id: "o",
    board_id: "b",
    kind: "text",
    name: id,
    settings: {},
    position,
    width: null,
    created_at: "2026-06-17T00:00:00Z",
    updated_at: "2026-06-17T00:00:00Z",
    ...over,
  } as CacheColumn;
}
function cache(columns: CacheColumn[]): BoardCache {
  return {
    board: { id: "b", org_id: "o" } as BoardCache["board"],
    groups: [],
    columns,
    items: [],
    cellValues: [
      { item_id: "i", column_id: "a" } as BoardCache["cellValues"][number],
    ],
    dependencies: [],
  };
}

describe("column cache mutators", () => {
  it("insertColumn appends + keeps position order + de-dupes by id", () => {
    let c = insertColumn(cache([col("a", 0)]), col("b", 1));
    expect(c.columns.map((x) => x.id)).toEqual(["a", "b"]);
    c = insertColumn(c, col("z", -1));
    expect(c.columns.map((x) => x.id)).toEqual(["z", "a", "b"]); // re-sorted
    c = insertColumn(c, col("a", 0));
    expect(c.columns).toHaveLength(3); // de-dupe
  });
  it("replaceColumn swaps by id (covers rename + width) and re-sorts", () => {
    const c = replaceColumn(
      cache([col("a", 0)]),
      col("a", 0, { name: "Renamed", width: 300 }),
    );
    expect(c.columns[0].name).toBe("Renamed");
    expect(c.columns[0].width).toBe(300);
  });
  it("removeColumn drops the column AND its cell values", () => {
    const c = removeColumn(cache([col("a", 0)]), "a");
    expect(c.columns).toHaveLength(0);
    expect(c.cellValues).toHaveLength(0); // 'a' cell removed
  });
});
