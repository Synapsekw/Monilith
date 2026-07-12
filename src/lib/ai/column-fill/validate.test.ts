import { describe, expect, it } from "vitest";
import { validateClassifications } from "@/lib/ai/column-fill/validate";
import { COLUMN_FILL_MAX } from "@/lib/ai/column-fill/schema";
import type { Classification } from "@/lib/ai/column-fill/schema";

const targetOptionIds = new Set(["opt-1", "opt-2"]);

describe("validateClassifications", () => {
  it("keeps classifications whose optionId is a known target option", () => {
    const rows: Classification[] = [
      { itemId: "item-1", optionId: "opt-1" },
      { itemId: "item-2", optionId: "opt-2" },
    ];
    const res = validateClassifications(rows, { targetOptionIds });
    expect(res.classifications).toEqual(rows);
    expect(res.warnings).toHaveLength(0);
  });

  it("keeps an explicit null optionId (no confident match) without warning", () => {
    const rows: Classification[] = [{ itemId: "item-1", optionId: null }];
    const res = validateClassifications(rows, { targetOptionIds });
    expect(res.classifications).toEqual(rows);
    expect(res.warnings).toHaveLength(0);
  });

  it("nulls out an unknown optionId and records a warning — never trusts raw model output", () => {
    const rows: Classification[] = [
      { itemId: "item-1", optionId: "not-a-real-option" },
    ];
    const res = validateClassifications(rows, { targetOptionIds });
    expect(res.classifications).toEqual([{ itemId: "item-1", optionId: null }]);
    expect(res.warnings.length).toBeGreaterThan(0);
    expect(res.warnings[0]).toContain("item-1");
  });

  it("enforces the row cap, dropping rows beyond the default max with a warning", () => {
    const rows: Classification[] = Array.from(
      { length: COLUMN_FILL_MAX + 10 },
      (_, i) => ({ itemId: `item-${i}`, optionId: null }),
    );
    const res = validateClassifications(rows, { targetOptionIds });
    expect(res.classifications).toHaveLength(COLUMN_FILL_MAX);
    expect(res.warnings.some((w) => w.toLowerCase().includes("cap"))).toBe(
      true,
    );
  });

  it("honors a custom max override", () => {
    const rows: Classification[] = Array.from({ length: 5 }, (_, i) => ({
      itemId: `item-${i}`,
      optionId: null,
    }));
    const res = validateClassifications(rows, { targetOptionIds, max: 3 });
    expect(res.classifications).toHaveLength(3);
    expect(res.warnings.some((w) => w.toLowerCase().includes("cap"))).toBe(
      true,
    );
  });

  it("handles an empty input with no warnings", () => {
    const res = validateClassifications([], { targetOptionIds });
    expect(res.classifications).toEqual([]);
    expect(res.warnings).toHaveLength(0);
  });
});
