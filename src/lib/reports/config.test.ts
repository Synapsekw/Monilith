import { describe, expect, it } from "vitest";
import {
  reportConfigSchema,
  defaultReportConfig,
  REPORT_CONFIG_VERSION,
} from "@/lib/reports/config";

describe("report config", () => {
  it("defaultReportConfig parses and has all 8 block types once", () => {
    const cfg = defaultReportConfig();
    const parsed = reportConfigSchema.parse(cfg);
    const types = parsed.blocks.map((b) => b.type);
    expect(new Set(types).size).toBe(8);
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

  it("rejects an unknown block type", () => {
    const r = reportConfigSchema.safeParse({
      blocks: [{ type: "charts", enabled: true, options: {} }],
    });
    expect(r.success).toBe(false);
  });
});
