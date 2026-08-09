import { describe, expect, it } from "vitest";
import {
  reportConfigSchema,
  blockSchema,
  parseReportConfig,
  defaultReportConfig,
  blockBoardIds,
  REPORT_CONFIG_VERSION,
} from "@/lib/reports/config";

describe("report config", () => {
  it("defaultReportConfig parses and has all block types once", () => {
    const cfg = defaultReportConfig();
    const parsed = reportConfigSchema.parse(cfg);
    const types = parsed.blocks.map((b) => b.type);
    expect(new Set(types).size).toBe(9);
    expect(parsed.v).toBe(REPORT_CONFIG_VERSION);
  });

  it("fills block option defaults", () => {
    const parsed = reportConfigSchema.parse({
      blocks: [{ type: "table", enabled: true, options: {} }],
    });
    const table = parsed.blocks[0];
    expect(table.type).toBe("table");
    if (table.type === "table") {
      expect(table.options.orientation).toBe("landscape");
      expect(table.options.columnIds).toBeNull();
    }
  });
});

describe("report config — charts (v2 slice)", () => {
  it("REPORT_CONFIG_VERSION stays 1 (additive variants never bump it)", () => {
    expect(REPORT_CONFIG_VERSION).toBe(1);
  });

  it("defaultReportConfig has 9 block types with chart enabled", () => {
    const cfg = defaultReportConfig();
    expect(new Set(cfg.blocks.map((b) => b.type)).size).toBe(9);
    const chart = cfg.blocks.find((b) => b.type === "chart");
    expect(chart?.enabled).toBe(true);
    if (chart?.type === "chart") {
      expect(chart.options.variant).toBe("donut");
      expect(chart.options.source).toBe("status");
      expect(chart.options.columnId).toBeNull();
      expect(chart.options.maxCategories).toBe(6);
      expect(chart.options.title).toBe("");
    }
  });

  it("defaultReportConfig places chart directly after kpis", () => {
    const types = defaultReportConfig().blocks.map((b) => b.type);
    expect(types[types.indexOf("kpis") + 1]).toBe("chart");
  });

  it("backfills a missing chart block into a stored v1 config, DISABLED", () => {
    const stored = {
      v: 1,
      title: "Weekly",
      blocks: [
        { type: "cover", enabled: true, options: {} },
        { type: "kpis", enabled: true, options: {} },
        { type: "table", enabled: true, options: {} },
      ],
    };
    const cfg = parseReportConfig(stored);
    const chart = cfg.blocks.find((b) => b.type === "chart");
    expect(chart).toBeDefined();
    expect(chart?.enabled).toBe(false);
    // inserted after the last preceding block that is present (kpis)
    const types = cfg.blocks.map((b) => b.type);
    expect(types[types.indexOf("kpis") + 1]).toBe("chart");
    // the user's own blocks keep their enabled state and relative order
    expect(cfg.title).toBe("Weekly");
    expect(types.indexOf("cover")).toBeLessThan(types.indexOf("kpis"));
  });

  it("backfilled blocks never change an existing block's enabled state", () => {
    const cfg = parseReportConfig({
      v: 1,
      title: "T",
      blocks: [{ type: "table", enabled: false, options: {} }],
    });
    expect(cfg.blocks.find((b) => b.type === "table")?.enabled).toBe(false);
  });

  it("DROPS an unknown future block type instead of throwing (rollback safety)", () => {
    expect(() =>
      parseReportConfig({
        v: 1,
        title: "T",
        blocks: [
          { type: "cover", enabled: true, options: {} },
          { type: "timeline_from_the_future", enabled: true, options: {} },
        ],
      }),
    ).not.toThrow();
    const cfg = parseReportConfig({
      v: 1,
      title: "T",
      blocks: [
        { type: "timeline_from_the_future", enabled: true, options: {} },
      ],
    });
    expect(
      cfg.blocks.some((b) => (b.type as string) === "timeline_from_the_future"),
    ).toBe(false);
  });

  it("parseReportConfig tolerates null/garbage and yields a full default set", () => {
    for (const raw of [null, undefined, {}, 42, "nope"]) {
      const cfg = parseReportConfig(raw);
      expect(new Set(cfg.blocks.map((b) => b.type)).size).toBe(9);
      expect(cfg.v).toBe(1);
    }
  });

  it("the WRITE schema is still strict — junk blocks are rejected", () => {
    expect(
      blockSchema.safeParse({ type: "nope", enabled: true, options: {} })
        .success,
    ).toBe(false);
    expect(
      reportConfigSchema.safeParse({
        blocks: [{ type: "nope", enabled: true, options: {} }],
      }).success,
    ).toBe(false);
  });

  it("clamps maxCategories to 3..6 and rejects out-of-range on write", () => {
    expect(
      blockSchema.safeParse({ type: "chart", options: { maxCategories: 2 } })
        .success,
    ).toBe(false);
    expect(
      blockSchema.safeParse({ type: "chart", options: { maxCategories: 7 } })
        .success,
    ).toBe(false);
    expect(
      blockSchema.safeParse({ type: "chart", options: { maxCategories: 4 } })
        .success,
    ).toBe(true);
  });
});

// Well-formed v4 UUIDs — Zod's .uuid() checks the version and variant nibbles.
const BOARD_A = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const BOARD_B = "5b8e9f10-2c3d-4e5f-8a9b-0c1d2e3f4a5b";
const BOARD_GONE = "9c9e6679-7425-40de-944b-e07fc1f90ae7";

/** The four board-specific blocks — the ones that carry `boardScope`. */
const BOARD_SCOPED_BLOCKS = [
  "chart",
  "table",
  "group_summaries",
  "appendix",
] as const;

function scopeOf(block: unknown): unknown {
  return (block as { options?: { boardScope?: unknown } } | undefined)?.options
    ?.boardScope;
}

describe("report config — boardScope (multi-board v2)", () => {
  it("REPORT_CONFIG_VERSION is still 1 and there are still 9 block types", () => {
    expect(REPORT_CONFIG_VERSION).toBe(1);
    expect(new Set(defaultReportConfig().blocks.map((b) => b.type)).size).toBe(
      9,
    );
  });

  it("legacy stored blocks with no boardScope still parse and default to all", () => {
    for (const type of BOARD_SCOPED_BLOCKS) {
      const parsed = blockSchema.parse({ type, enabled: true, options: {} });
      expect(scopeOf(parsed)).toEqual({ mode: "all" });
    }
  });

  it("the exact legacy table block (orientation + columnIds, no boardScope) parses", () => {
    const stored = {
      type: "table",
      enabled: true,
      options: { orientation: "landscape", columnIds: null },
    };
    const parsed = blockSchema.parse(stored);
    expect(parsed.type).toBe("table");
    if (parsed.type === "table") {
      expect(parsed.options.orientation).toBe("landscape");
      expect(parsed.options.columnIds).toBeNull();
      expect(parsed.options.boardScope).toEqual({ mode: "all" });
    }

    // …and through the lenient READ path on a whole stored config
    const cfg = parseReportConfig({ v: 1, title: "Weekly", blocks: [stored] });
    expect(scopeOf(cfg.blocks.find((b) => b.type === "table"))).toEqual({
      mode: "all",
    });
  });

  it("defaultReportConfig gives every board-specific block { mode: 'all' }", () => {
    const cfg = defaultReportConfig();
    for (const type of BOARD_SCOPED_BLOCKS) {
      expect(scopeOf(cfg.blocks.find((b) => b.type === type))).toEqual({
        mode: "all",
      });
    }
    // kpis stays option-free — KPIs pool across all bound boards by design
    const kpis = cfg.blocks.find((b) => b.type === "kpis");
    expect(kpis?.type === "kpis" && kpis.options).toEqual({});
  });

  it("a pinned { mode: 'board', boardId } round-trips through the strict write schema", () => {
    for (const type of BOARD_SCOPED_BLOCKS) {
      const input = {
        type,
        enabled: true,
        options: { boardScope: { mode: "board", boardId: BOARD_A } },
      };
      const parsed = blockSchema.parse(input);
      expect(scopeOf(parsed)).toEqual({ mode: "board", boardId: BOARD_A });
      // survives a full config round-trip
      const cfg = reportConfigSchema.parse({ blocks: [input] });
      expect(scopeOf(cfg.blocks[0])).toEqual({
        mode: "board",
        boardId: BOARD_A,
      });
    }
  });

  it("rejects a non-uuid boardId on the strict write path", () => {
    for (const type of BOARD_SCOPED_BLOCKS) {
      expect(
        blockSchema.safeParse({
          type,
          enabled: true,
          options: { boardScope: { mode: "board", boardId: "board-1" } },
        }).success,
      ).toBe(false);
    }
    // an unknown mode is rejected too
    expect(
      blockSchema.safeParse({
        type: "chart",
        options: { boardScope: { mode: "everything" } },
      }).success,
    ).toBe(false);
    // mode: "board" without a boardId is rejected
    expect(
      blockSchema.safeParse({
        type: "chart",
        options: { boardScope: { mode: "board" } },
      }).success,
    ).toBe(false);
  });

  it("blockBoardIds returns every bound board for mode: 'all'", () => {
    expect(blockBoardIds({ mode: "all" }, [BOARD_A, BOARD_B])).toEqual([
      BOARD_A,
      BOARD_B,
    ]);
    expect(blockBoardIds({ mode: "all" }, [])).toEqual([]);
  });

  it("blockBoardIds returns just the pinned board for mode: 'board'", () => {
    expect(
      blockBoardIds({ mode: "board", boardId: BOARD_B }, [BOARD_A, BOARD_B]),
    ).toEqual([BOARD_B]);
  });

  it("blockBoardIds yields [] for a stale pin to a board no longer bound", () => {
    expect(
      blockBoardIds({ mode: "board", boardId: BOARD_GONE }, [BOARD_A, BOARD_B]),
    ).toEqual([]);
    expect(blockBoardIds({ mode: "board", boardId: BOARD_A }, [])).toEqual([]);
  });
});
