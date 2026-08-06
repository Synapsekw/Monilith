import { describe, it, expect } from "vitest";
import {
  parseBoardFilter,
  serializeBoardFilter,
  filterFacetCount,
  isFilterActive,
  isCellEmpty,
  evaluateCondition,
  buildItemPredicate,
  buildItemComparator,
  EMPTY_BOARD_FILTER,
  type BoardFilterState,
  type FilterColumnMeta,
} from "@/lib/boards/board-filter";
import { cellKey } from "@/lib/boards/cache";

const item = (id: string, name = id, created_at = "2026-01-01T00:00:00Z") => ({
  id,
  name,
  created_at,
});

const columns: FilterColumnMeta[] = [
  { id: "c-text", kind: "text", settings: {} },
  { id: "c-people", kind: "people", settings: {} },
  {
    id: "c-status",
    kind: "status",
    settings: {
      options: [
        { id: "opt-todo", label: "Todo", color: "#000" },
        { id: "opt-doing", label: "Doing", color: "#111" },
        { id: "opt-done", label: "Done", color: "#222" },
      ],
    },
  },
  { id: "c-num", kind: "numbers", settings: {} },
  { id: "c-date", kind: "date", settings: {} },
];

function ctxWith(cells: Record<string, unknown>) {
  // keys are "itemId:columnId"
  const cellMap = new Map<string, unknown>(Object.entries(cells));
  return { columns, cellMap };
}

describe("parse / serialize round-trip", () => {
  it("parses an empty param set to the empty state", () => {
    expect(parseBoardFilter(new URLSearchParams(""))).toEqual(
      EMPTY_BOARD_FILTER,
    );
  });

  it("round-trips search, people, status, conditions and sort", () => {
    const state: BoardFilterState = {
      q: "hello",
      people: ["u1", "u2"],
      status: ["opt-done"],
      conditions: {
        combinator: "or",
        // listFilterSchema requires a uuid columnId (real board columns are uuids)
        conditions: [
          {
            columnId: "11111111-1111-4111-8111-111111111111",
            operator: "contains",
            value: "x",
          },
        ],
      },
      sort: { field: { kind: "column", columnId: "c-num" }, direction: "desc" },
    };
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(serializeBoardFilter(state))) {
      if (v !== null) params.set(k, v);
    }
    expect(parseBoardFilter(params)).toEqual(state);
  });

  it("drops cleared facets from the URL (null values)", () => {
    const out = serializeBoardFilter(EMPTY_BOARD_FILTER);
    expect(out).toEqual({
      q: null,
      people: null,
      status: null,
      filter: null,
      sort: null,
    });
  });

  it("serializes built-in name/created sorts without a col prefix", () => {
    expect(
      serializeBoardFilter({
        ...EMPTY_BOARD_FILTER,
        sort: { field: { kind: "name" }, direction: "asc" },
      }).sort,
    ).toBe("name:asc");
    expect(
      serializeBoardFilter({
        ...EMPTY_BOARD_FILTER,
        sort: { field: { kind: "created" }, direction: "desc" },
      }).sort,
    ).toBe("created:desc");
  });

  it("defensively ignores malformed filter JSON", () => {
    const params = new URLSearchParams();
    params.set("filter", "{not json");
    expect(parseBoardFilter(params).conditions.conditions).toEqual([]);
  });
});

describe("active-state helpers", () => {
  it("counts people + status + conditions as facets (not search/sort)", () => {
    expect(
      filterFacetCount({
        q: "abc",
        people: ["u1", "u2"],
        status: ["opt-done"],
        conditions: {
          combinator: "and",
          conditions: [{ columnId: "c-text", operator: "eq", value: "y" }],
        },
        sort: { field: { kind: "name" }, direction: "asc" },
      }),
    ).toBe(4);
  });

  it("isFilterActive is true for search-only and sort-only", () => {
    expect(isFilterActive({ ...EMPTY_BOARD_FILTER, q: " x " })).toBe(true);
    expect(
      isFilterActive({
        ...EMPTY_BOARD_FILTER,
        sort: { field: { kind: "name" }, direction: "asc" },
      }),
    ).toBe(true);
    expect(isFilterActive(EMPTY_BOARD_FILTER)).toBe(false);
    expect(isFilterActive({ ...EMPTY_BOARD_FILTER, q: "   " })).toBe(false);
  });
});

describe("isCellEmpty", () => {
  it("treats null/absent as empty for every kind", () => {
    expect(isCellEmpty("text", null)).toBe(true);
    expect(isCellEmpty("status", undefined)).toBe(true);
  });
  it("reads per-kind fullness", () => {
    expect(isCellEmpty("text", { text: "" })).toBe(true);
    expect(isCellEmpty("text", { text: "hi" })).toBe(false);
    expect(isCellEmpty("status", { optionId: null })).toBe(true);
    expect(isCellEmpty("status", { optionId: "o" })).toBe(false);
    expect(isCellEmpty("people", { userIds: [] })).toBe(true);
    expect(isCellEmpty("people", { userIds: ["u"] })).toBe(false);
    expect(isCellEmpty("numbers", { n: 0 })).toBe(false);
    expect(isCellEmpty("checkbox", { checked: false })).toBe(true);
    expect(isCellEmpty("checkbox", { checked: true })).toBe(false);
  });
});

describe("evaluateCondition", () => {
  it("status is / is_not", () => {
    expect(
      evaluateCondition(
        { columnId: "c", operator: "is", value: "o1" },
        "status",
        { optionId: "o1" },
      ),
    ).toBe(true);
    expect(
      evaluateCondition(
        { columnId: "c", operator: "is_not", value: "o1" },
        "status",
        { optionId: "o2" },
      ),
    ).toBe(true);
  });

  it("text contains / eq (case-insensitive contains)", () => {
    expect(
      evaluateCondition(
        { columnId: "c", operator: "contains", value: "Ell" },
        "text",
        { text: "hello" },
      ),
    ).toBe(true);
    expect(
      evaluateCondition(
        { columnId: "c", operator: "eq", value: "hello" },
        "text",
        { text: "hello" },
      ),
    ).toBe(true);
  });

  it("contains matches against the STRIPPED cell text (what the user sees)", () => {
    // Stored raw value has Markdown; the cell displays "Q3 goals ship billing"
    // (bold stripped, newline flattened) — a query over the visible words
    // must match even though it's not a literal substring of the raw string.
    expect(
      evaluateCondition(
        { columnId: "c", operator: "contains", value: "goals ship" },
        "text",
        { text: "**Q3 goals**\n- ship billing" },
      ),
    ).toBe(true);
  });

  it("contains also strips Markdown out of the query value itself", () => {
    expect(
      evaluateCondition(
        { columnId: "c", operator: "contains", value: "**billing**" },
        "text",
        { text: "- ship billing" },
      ),
    ).toBe(true);
  });

  it("eq matches a bolded stored value against its plain-text query", () => {
    expect(
      evaluateCondition(
        { columnId: "c", operator: "eq", value: "Q3 goals" },
        "text",
        { text: "**Q3 goals**" },
      ),
    ).toBe(true);
  });

  it("eq strips Markdown from both sides symmetrically", () => {
    expect(
      evaluateCondition(
        { columnId: "c", operator: "eq", value: "**Q3 goals**" },
        "text",
        { text: "Q3 goals" },
      ),
    ).toBe(true);
  });

  it("numeric gt / lt / eq over numbers and currency", () => {
    expect(
      evaluateCondition(
        { columnId: "c", operator: "gt", value: 5 },
        "numbers",
        { n: 6 },
      ),
    ).toBe(true);
    expect(
      evaluateCondition(
        { columnId: "c", operator: "lt", value: 5 },
        "currency",
        { amount: 3 },
      ),
    ).toBe(true);
    expect(
      evaluateCondition(
        { columnId: "c", operator: "num_eq", value: 5 },
        "numbers",
        { n: 4 },
      ),
    ).toBe(false);
  });

  it("date before / after / on (ISO string compare)", () => {
    expect(
      evaluateCondition(
        { columnId: "c", operator: "before", value: "2026-06-01" },
        "date",
        { date: "2026-05-01" },
      ),
    ).toBe(true);
    expect(
      evaluateCondition(
        { columnId: "c", operator: "on", value: "2026-05-01" },
        "date",
        { date: "2026-05-01" },
      ),
    ).toBe(true);
  });

  it("is_empty / not_empty", () => {
    expect(
      evaluateCondition({ columnId: "c", operator: "is_empty" }, "text", {
        text: "",
      }),
    ).toBe(true);
    expect(
      evaluateCondition({ columnId: "c", operator: "not_empty" }, "numbers", {
        n: 1,
      }),
    ).toBe(true);
  });
});

describe("buildItemPredicate", () => {
  it("passes everything for the empty state", () => {
    const pred = buildItemPredicate(EMPTY_BOARD_FILTER, ctxWith({}));
    expect(pred(item("i1"))).toBe(true);
  });

  it("quick search matches item name (case-insensitive)", () => {
    const pred = buildItemPredicate(
      { ...EMPTY_BOARD_FILTER, q: "ROAD" },
      ctxWith({}),
    );
    expect(pred(item("i1", "Q2 Roadmap"))).toBe(true);
    expect(pred(item("i2", "Backlog"))).toBe(false);
  });

  it("quick search also matches text-column contents", () => {
    const pred = buildItemPredicate(
      { ...EMPTY_BOARD_FILTER, q: "urgent" },
      ctxWith({ [cellKey("i1", "c-text")]: { text: "This is Urgent work" } }),
    );
    expect(pred(item("i1", "Task"))).toBe(true);
  });

  it("people filter matches any assigned user (OR)", () => {
    const pred = buildItemPredicate(
      { ...EMPTY_BOARD_FILTER, people: ["me"] },
      ctxWith({
        [cellKey("i1", "c-people")]: { userIds: ["someone", "me"] },
        [cellKey("i2", "c-people")]: { userIds: ["someone"] },
      }),
    );
    expect(pred(item("i1"))).toBe(true);
    expect(pred(item("i2"))).toBe(false);
  });

  it("status filter matches a selected option", () => {
    const pred = buildItemPredicate(
      { ...EMPTY_BOARD_FILTER, status: ["opt-done"] },
      ctxWith({
        [cellKey("i1", "c-status")]: { optionId: "opt-done" },
        [cellKey("i2", "c-status")]: { optionId: "opt-todo" },
      }),
    );
    expect(pred(item("i1"))).toBe(true);
    expect(pred(item("i2"))).toBe(false);
  });

  it("AND-combines quick facets (people AND status)", () => {
    const pred = buildItemPredicate(
      { ...EMPTY_BOARD_FILTER, people: ["me"], status: ["opt-done"] },
      ctxWith({
        [cellKey("i1", "c-people")]: { userIds: ["me"] },
        [cellKey("i1", "c-status")]: { optionId: "opt-done" },
        [cellKey("i2", "c-people")]: { userIds: ["me"] },
        [cellKey("i2", "c-status")]: { optionId: "opt-todo" },
      }),
    );
    expect(pred(item("i1"))).toBe(true);
    expect(pred(item("i2"))).toBe(false);
  });

  it("generic conditions honour the or combinator", () => {
    const state: BoardFilterState = {
      ...EMPTY_BOARD_FILTER,
      conditions: {
        combinator: "or",
        conditions: [
          { columnId: "c-num", operator: "gt", value: 100 },
          { columnId: "c-status", operator: "is", value: "opt-done" },
        ],
      },
    };
    const pred = buildItemPredicate(
      state,
      ctxWith({
        [cellKey("i1", "c-num")]: { n: 5 },
        [cellKey("i1", "c-status")]: { optionId: "opt-done" },
      }),
    );
    expect(pred(item("i1"))).toBe(true); // matches the status branch
  });
});

describe("buildItemComparator", () => {
  it("returns null when no sort is set", () => {
    expect(buildItemComparator(EMPTY_BOARD_FILTER, ctxWith({}))).toBeNull();
  });

  it("sorts by name ascending / descending", () => {
    const asc = buildItemComparator(
      {
        ...EMPTY_BOARD_FILTER,
        sort: { field: { kind: "name" }, direction: "asc" },
      },
      ctxWith({}),
    )!;
    const rows = [
      item("i1", "Charlie"),
      item("i2", "Alice"),
      item("i3", "Bob"),
    ];
    expect([...rows].sort(asc).map((r) => r.name)).toEqual([
      "Alice",
      "Bob",
      "Charlie",
    ]);
  });

  it("sorts by a numbers column, empties last in both directions", () => {
    const cells = {
      [cellKey("i1", "c-num")]: { n: 30 },
      [cellKey("i2", "c-num")]: { n: 10 },
      // i3 has no value → empty
    };
    const asc = buildItemComparator(
      {
        ...EMPTY_BOARD_FILTER,
        sort: {
          field: { kind: "column", columnId: "c-num" },
          direction: "asc",
        },
      },
      ctxWith(cells),
    )!;
    const rows = [item("i1"), item("i2"), item("i3")];
    expect([...rows].sort(asc).map((r) => r.id)).toEqual(["i2", "i1", "i3"]);

    const desc = buildItemComparator(
      {
        ...EMPTY_BOARD_FILTER,
        sort: {
          field: { kind: "column", columnId: "c-num" },
          direction: "desc",
        },
      },
      ctxWith(cells),
    )!;
    expect([...rows].sort(desc).map((r) => r.id)).toEqual(["i1", "i2", "i3"]);
  });

  it("sorts a status column by its option order, not label text", () => {
    const cells = {
      [cellKey("i1", "c-status")]: { optionId: "opt-done" }, // index 2
      [cellKey("i2", "c-status")]: { optionId: "opt-todo" }, // index 0
      [cellKey("i3", "c-status")]: { optionId: "opt-doing" }, // index 1
    };
    const asc = buildItemComparator(
      {
        ...EMPTY_BOARD_FILTER,
        sort: {
          field: { kind: "column", columnId: "c-status" },
          direction: "asc",
        },
      },
      ctxWith(cells),
    )!;
    const rows = [item("i1"), item("i2"), item("i3")];
    expect([...rows].sort(asc).map((r) => r.id)).toEqual(["i2", "i3", "i1"]);
  });

  it("sorts a text column by the STRIPPED value, not raw Markdown punctuation", () => {
    // Raw strings would sort "- bullet" and "**Zebra**" ahead of "Alpha"
    // (punctuation sorts before letters); the stripped/displayed text should
    // sort Alpha, bullet, Zebra.
    const cells = {
      [cellKey("i1", "c-text")]: { text: "- bullet" },
      [cellKey("i2", "c-text")]: { text: "**Zebra**" },
      [cellKey("i3", "c-text")]: { text: "Alpha" },
    };
    const asc = buildItemComparator(
      {
        ...EMPTY_BOARD_FILTER,
        sort: {
          field: { kind: "column", columnId: "c-text" },
          direction: "asc",
        },
      },
      ctxWith(cells),
    )!;
    const rows = [item("i1"), item("i2"), item("i3")];
    expect([...rows].sort(asc).map((r) => r.id)).toEqual(["i3", "i1", "i2"]);
  });

  it("memoizes the per-item sort key instead of recomputing it per comparison", () => {
    // Regression guard for the sort-key performance fix: stripMarkdown (or
    // any per-kind key derivation) must run once per row, not once per
    // comparison. We can't spy on the module-private stripMarkdown call
    // directly, so instead we assert the *comparator itself* only reads each
    // cell's raw value once across a sort with many rows/comparisons.
    let reads = 0;
    const cellMap = new Map<string, unknown>();
    const rows = Array.from({ length: 50 }, (_, i) => {
      const id = `i${i}`;
      cellMap.set(cellKey(id, "c-text"), { text: `- item ${49 - i}` });
      return item(id);
    });
    const trackedCellMap = {
      get(key: string) {
        if (key.endsWith(":c-text")) reads++;
        return cellMap.get(key);
      },
    } as unknown as Map<string, unknown>;
    const asc = buildItemComparator(
      {
        ...EMPTY_BOARD_FILTER,
        sort: {
          field: { kind: "column", columnId: "c-text" },
          direction: "asc",
        },
      },
      { columns, cellMap: trackedCellMap },
    )!;
    [...rows].sort(asc);
    // O(n) reads (one per row), not O(n log n) (one per comparison).
    expect(reads).toBe(rows.length);
  });
});
