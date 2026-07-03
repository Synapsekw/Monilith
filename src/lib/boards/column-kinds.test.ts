import { describe, expect, it } from "vitest";

import { COLUMN_KIND_META, COLUMN_KIND_ORDER } from "./column-kinds";

describe("column kind metadata", () => {
  it("has a meta entry for every ordered kind", () => {
    for (const kind of COLUMN_KIND_ORDER) {
      expect(COLUMN_KIND_META[kind]).toBeDefined();
    }
  });

  it("order and meta cover the same set of kinds", () => {
    expect(COLUMN_KIND_ORDER.length).toBe(Object.keys(COLUMN_KIND_META).length);
  });

  it("marks status and dropdown as having options", () => {
    expect(COLUMN_KIND_META.status.hasOptions).toBe(true);
    expect(COLUMN_KIND_META.dropdown.hasOptions).toBe(true);
  });

  it("marks text and checkbox as not having options", () => {
    expect(COLUMN_KIND_META.text.hasOptions).toBe(false);
    expect(COLUMN_KIND_META.checkbox.hasOptions).toBe(false);
  });

  it("registers the currency kind", () => {
    expect(COLUMN_KIND_META.currency).toMatchObject({
      label: "Currency",
      hasOptions: false,
    });
    expect(COLUMN_KIND_ORDER).toContain("currency");
  });
});
