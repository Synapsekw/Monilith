import { describe, expect, it } from "vitest";
import { mirrorFooterValues, mirrorValuesForCell } from "@/lib/boards/mirror";
import type { BoardCache } from "@/lib/boards/cache";

function baseCache(over: Partial<BoardCache>): BoardCache {
  return {
    board: {} as BoardCache["board"],
    groups: [],
    columns: [],
    items: [],
    cellValues: [],
    dependencies: [],
    attachments: [],
    timeEntries: [],
    relationLinks: [],
    mirrorTargetCells: [],
    mirrorTargetColumns: [],
    ...over,
  };
}

const mirrorCol = {
  id: "mir",
  kind: "mirror",
  settings: { source_relation_column_id: "rel", target_column_id: "tcol" },
} as unknown as BoardCache["columns"][number];

describe("mirrorValuesForCell", () => {
  it("derives one value per linked item, in link position order", () => {
    const cache = baseCache({
      relationLinks: [
        {
          id: "l2",
          itemId: "i1",
          columnId: "rel",
          linkedItemId: "b2",
          linkedItemName: "B2",
          position: 1,
        },
        {
          id: "l1",
          itemId: "i1",
          columnId: "rel",
          linkedItemId: "b1",
          linkedItemName: "B1",
          position: 0,
        },
      ],
      mirrorTargetCells: [
        { item_id: "b1", column_id: "tcol", value: { text: "alpha" } } as never,
        { item_id: "b2", column_id: "tcol", value: { text: "beta" } } as never,
      ],
    });
    const vals = mirrorValuesForCell(cache, "i1", mirrorCol);
    expect(vals.map((v) => v.linkedItemId)).toEqual(["b1", "b2"]);
    expect(vals.map((v) => v.value)).toEqual([
      { text: "alpha" },
      { text: "beta" },
    ]);
  });

  it("yields an absent value when the target cell is unreadable/missing", () => {
    const cache = baseCache({
      relationLinks: [
        {
          id: "l1",
          itemId: "i1",
          columnId: "rel",
          linkedItemId: "b1",
          linkedItemName: null,
          position: 0,
        },
      ],
      mirrorTargetCells: [],
    });
    expect(mirrorValuesForCell(cache, "i1", mirrorCol)).toEqual([
      { linkedItemId: "b1", value: null },
    ]);
  });

  it("returns empty when the mirror config points at a missing relation column", () => {
    const cache = baseCache({ relationLinks: [] });
    const broken = {
      ...mirrorCol,
      settings: { source_relation_column_id: "gone", target_column_id: "tcol" },
    } as typeof mirrorCol;
    expect(mirrorValuesForCell(cache, "i1", broken)).toEqual([]);
  });
});

describe("mirrorFooterValues", () => {
  it("flattens mirrored values across items (RLS-null included as empty)", () => {
    const cache = baseCache({
      relationLinks: [
        {
          id: "l1",
          itemId: "i1",
          columnId: "rel",
          linkedItemId: "b1",
          linkedItemName: "B1",
          position: 0,
        },
        {
          id: "l2",
          itemId: "i1",
          columnId: "rel",
          linkedItemId: "b2",
          linkedItemName: "B2",
          position: 1,
        },
        {
          id: "l3",
          itemId: "i2",
          columnId: "rel",
          linkedItemId: "b3",
          linkedItemName: null,
          position: 0,
        },
      ],
      mirrorTargetCells: [
        { item_id: "b1", column_id: "tcol", value: { n: 10 } } as never,
        { item_id: "b2", column_id: "tcol", value: { n: 5 } } as never,
        // b3 has no readable target cell → null
      ],
    });
    expect(mirrorFooterValues(cache, mirrorCol, ["i1", "i2"])).toEqual([
      { n: 10 },
      { n: 5 },
      null,
    ]);
  });

  it("is empty when no items are linked", () => {
    const cache = baseCache({ relationLinks: [] });
    expect(mirrorFooterValues(cache, mirrorCol, ["i1"])).toEqual([]);
  });
});
