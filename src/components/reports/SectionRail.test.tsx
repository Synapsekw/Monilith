import { describe, expect, it } from "vitest";
import { moveBlock, toggleBlock } from "@/components/reports/SectionRail";
import { defaultReportConfig } from "@/lib/reports/config";

describe("SectionRail helpers", () => {
  it("toggleBlock flips enabled at the index", () => {
    const cfg = defaultReportConfig();
    const before = cfg.blocks[0].enabled;
    expect(toggleBlock(cfg, 0).blocks[0].enabled).toBe(!before);
  });
  it("moveBlock reorders and clamps at bounds", () => {
    const cfg = defaultReportConfig();
    const moved = moveBlock(cfg, 0, 1);
    expect(moved.blocks[1].type).toBe(cfg.blocks[0].type);
    expect(moveBlock(cfg, 0, -1)).toBe(cfg); // no-op past the top
  });
});
