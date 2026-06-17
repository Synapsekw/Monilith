import { describe, expect, it } from "vitest";
import {
  createDashboardSchema,
  createWidgetSchema,
  numberConfigSchema,
  saveLayoutSchema,
} from "./dashboards";

// "11111111-1111-1111-1111-111111111111" fails Zod 4's strict UUID check
// (variant nibble must be [89ab]). Use UUIDs that satisfy version nibble=4
// and variant nibble=8 — matching the repo convention in other test files.
const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";

describe("numberConfigSchema", () => {
  it("accepts count without a value column", () => {
    expect(numberConfigSchema.safeParse({ agg: "count" }).success).toBe(true);
  });
  it("rejects sum without a value column", () => {
    expect(numberConfigSchema.safeParse({ agg: "sum" }).success).toBe(false);
  });
  it("accepts sum with a value column", () => {
    const r = numberConfigSchema.safeParse({
      agg: "sum",
      valueColumnId: UUID_A,
    });
    expect(r.success).toBe(true);
  });
});

describe("createWidgetSchema", () => {
  it("requires a uuid dashboardId and a known kind", () => {
    const r = createWidgetSchema.safeParse({
      dashboardId: UUID_A,
      kind: "number",
      sourceBoardId: UUID_B,
      title: "Open items",
      config: { agg: "count" },
    });
    expect(r.success).toBe(true);
  });
});

describe("saveLayoutSchema", () => {
  it("validates an array of grid rects", () => {
    const r = saveLayoutSchema.safeParse({
      dashboardId: UUID_A,
      layouts: [{ id: UUID_B, x: 0, y: 0, w: 2, h: 2 }],
    });
    expect(r.success).toBe(true);
  });
});

describe("createDashboardSchema", () => {
  it("trims and bounds the name", () => {
    expect(
      createDashboardSchema.safeParse({
        workspaceId: UUID_A,
        name: "  My Dash  ",
      }).success,
    ).toBe(true);
    expect(
      createDashboardSchema.safeParse({
        workspaceId: UUID_A,
        name: "",
      }).success,
    ).toBe(false);
  });
});
