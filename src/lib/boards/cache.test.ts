import { describe, expect, it } from "vitest";
import {
  addDependency,
  buildCellMap,
  cellKey,
  insertColumn,
  insertGroup,
  insertItem,
  removeCellValue,
  removeColumn,
  removeDependency,
  removeGroup,
  removeItem,
  replaceColumn,
  replaceGroup,
  replaceItem,
  replaceBoard,
  upsertCellValue,
  prependColumnFile,
  removeColumnFile,
  filesForCell,
  type BoardCache,
  type CacheAttachment,
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
    attachments: [],
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
    attachments: [],
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

describe("insertGroup", () => {
  function withGroup(): BoardCache {
    return {
      ...baseCache(),
      groups: [
        {
          id: "g1",
          board_id: "b1",
          name: "Group 1",
          color: "#0073ea",
          position: 0,
        } as never,
      ],
    };
  }

  it("inserts in position order, not insertion order", () => {
    const next = insertGroup(withGroup(), {
      id: "g0",
      board_id: "b1",
      name: "Group 0",
      color: "#0073ea",
      position: -1,
    } as never);
    expect(next.groups.map((g) => g.id)).toEqual(["g0", "g1"]);
  });

  it("appends when its position is greatest", () => {
    const next = insertGroup(withGroup(), {
      id: "g2",
      board_id: "b1",
      name: "Group 2",
      color: "#0073ea",
      position: 1,
    } as never);
    expect(next.groups.map((g) => g.id)).toEqual(["g1", "g2"]);
  });

  it("is idempotent — does not duplicate an existing group id", () => {
    const next = insertGroup(withGroup(), {
      id: "g1",
      board_id: "b1",
      name: "Group 1",
      color: "#0073ea",
      position: 0,
    } as never);
    expect(next.groups).toHaveLength(1);
  });

  it("does not mutate the input cache (immutable)", () => {
    const input = withGroup();
    insertGroup(input, {
      id: "g2",
      board_id: "b1",
      name: "Group 2",
      color: "#0073ea",
      position: 1,
    } as never);
    expect(input.groups).toHaveLength(1);
  });
});

describe("replaceGroup position sort", () => {
  function twoGroups(): BoardCache {
    return {
      ...baseCache(),
      groups: [
        {
          id: "g1",
          board_id: "b1",
          name: "G1",
          color: "#0073ea",
          position: 0,
        } as never,
        {
          id: "g2",
          board_id: "b1",
          name: "G2",
          color: "#0073ea",
          position: 1,
        } as never,
      ],
    };
  }

  it("re-sorts by position after a replace (covers reorder)", () => {
    const next = replaceGroup(twoGroups(), {
      id: "g1",
      board_id: "b1",
      name: "G1",
      color: "#0073ea",
      position: 2,
    } as never);
    expect(next.groups.map((g) => g.id)).toEqual(["g2", "g1"]);
  });
});

describe("removeGroup", () => {
  function cache(): BoardCache {
    return {
      board: { id: "b1", org_id: "o1", name: "B" } as never,
      groups: [
        {
          id: "g1",
          board_id: "b1",
          name: "G1",
          color: "#0073ea",
          position: 0,
        } as never,
        {
          id: "g2",
          board_id: "b1",
          name: "G2",
          color: "#0073ea",
          position: 1,
        } as never,
      ],
      columns: [],
      items: [
        { id: "i1", board_id: "b1", group_id: "g1", name: "One" } as never,
        { id: "i2", board_id: "b1", group_id: "g2", name: "Two" } as never,
      ],
      cellValues: [
        {
          item_id: "i1",
          column_id: "c1",
          org_id: "o1",
          board_id: "b1",
          value: { text: "x" },
        } as never,
        {
          item_id: "i2",
          column_id: "c1",
          org_id: "o1",
          board_id: "b1",
          value: { text: "y" },
        } as never,
      ],
      dependencies: [],
      attachments: [],
    };
  }

  it("removes the group, its items, and those items' cell values", () => {
    const next = removeGroup(cache(), "g1");
    expect(next.groups.map((g) => g.id)).toEqual(["g2"]);
    expect(next.items.map((i) => i.id)).toEqual(["i2"]);
    expect(next.cellValues.map((c) => c.item_id)).toEqual(["i2"]);
  });

  it("does not mutate the input cache (immutable)", () => {
    const input = cache();
    removeGroup(input, "g1");
    expect(input.groups).toHaveLength(2);
    expect(input.items).toHaveLength(2);
  });
});

describe("removeItem", () => {
  it("removes the item and its cell values", () => {
    const next = removeItem(baseCache(), "i1");
    expect(next.items.some((i) => i.id === "i1")).toBe(false);
    expect(next.cellValues.some((c) => c.item_id === "i1")).toBe(false);
    expect(next.items.some((i) => i.id === "i2")).toBe(true);
  });

  it("cascades to subitems of the removed parent", () => {
    const cache = baseCache();
    cache.items.push({
      id: "sub1",
      board_id: "b1",
      group_id: "g1",
      parent_id: "i1",
      name: "Sub",
    } as never);
    cache.cellValues.push({
      item_id: "sub1",
      column_id: "c1",
      org_id: "o1",
      board_id: "b1",
      value: { text: "x" },
    } as never);
    const next = removeItem(cache, "i1");
    expect(next.items.some((i) => i.id === "sub1")).toBe(false);
    expect(next.cellValues.some((c) => c.item_id === "sub1")).toBe(false);
  });
});

function attachment(
  id: string,
  over: Partial<CacheAttachment> = {},
): CacheAttachment {
  return {
    id,
    org_id: "o1",
    board_id: "b1",
    item_id: "i1",
    column_id: "c1",
    uploaded_by: "u1",
    storage_path: `o1/b1/i1/c1/${id}.txt`,
    file_name: `${id}.txt`,
    mime_type: "text/plain",
    size_bytes: 4,
    created_at: "2026-06-19T00:00:00Z",
    ...over,
  } as CacheAttachment;
}

describe("files-column attachment cache mutators", () => {
  it("prependColumnFile adds newest-first and de-dupes by id", () => {
    let c = prependColumnFile(baseCache(), attachment("a1"));
    expect(c.attachments.map((a) => a.id)).toEqual(["a1"]);
    c = prependColumnFile(c, attachment("a2"));
    expect(c.attachments.map((a) => a.id)).toEqual(["a2", "a1"]); // prepended
    c = prependColumnFile(c, attachment("a1"));
    expect(c.attachments).toHaveLength(2); // de-dupe
  });

  it("removeColumnFile removes by id (no-op when absent)", () => {
    const seeded = prependColumnFile(baseCache(), attachment("a1"));
    expect(removeColumnFile(seeded, "a1").attachments).toHaveLength(0);
    expect(removeColumnFile(seeded, "nope").attachments).toHaveLength(1);
  });

  it("filesForCell filters by item + column", () => {
    let c = prependColumnFile(baseCache(), attachment("a1"));
    c = prependColumnFile(c, attachment("a2", { column_id: "c2" }));
    c = prependColumnFile(c, attachment("a3", { item_id: "i2" }));
    expect(filesForCell(c, "i1", "c1").map((a) => a.id)).toEqual(["a1"]);
    expect(filesForCell(c, "i1", "c2").map((a) => a.id)).toEqual(["a2"]);
    expect(filesForCell(c, "i9", "c1")).toHaveLength(0);
  });
});
