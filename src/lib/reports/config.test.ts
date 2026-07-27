import { describe, expect, it } from "vitest";
import {
  reportConfigSchema,
  blockSchema,
  parseReportConfig,
  defaultReportConfig,
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
