import { describe, expect, it } from "vitest";
import {
  createDashboardSchema,
  createWidgetSchema,
  numberConfigSchema,
  renameDashboardSchema,
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

describe("renameDashboardSchema", () => {
  it("requires a uuid dashboardId and a 1..100 name", () => {
    expect(
      renameDashboardSchema.safeParse({ dashboardId: UUID_A, name: "New" })
        .success,
    ).toBe(true);
    expect(
      renameDashboardSchema.safeParse({ dashboardId: UUID_A, name: "" })
        .success,
    ).toBe(false);
    expect(
      renameDashboardSchema.safeParse({ dashboardId: "nope", name: "X" })
        .success,
    ).toBe(false);
    expect(
      renameDashboardSchema.safeParse({
        dashboardId: UUID_A,
        name: "a".repeat(101),
      }).success,
    ).toBe(false);
  });

  it("trims the name", () => {
    const r = renameDashboardSchema.safeParse({
      dashboardId: UUID_A,
      name: "  Hi  ",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.name).toBe("Hi");
  });
});

import {
  batteryConfigSchema,
  chartConfigSchema,
  configSchemaForKind,
} from "./dashboards";

describe("chartConfigSchema", () => {
  const col = "11111111-1111-4111-8111-111111111111";
  it("requires a chartType and a primary dimension", () => {
    expect(
      chartConfigSchema.safeParse({
        chartType: "bar",
        primary: { kind: "status", columnId: col },
      }).success,
    ).toBe(true);
    expect(
      chartConfigSchema.safeParse({
        chartType: "pie",
        primary: { kind: "status", columnId: col },
      }).success,
    ).toBe(true);
    // unknown chartType is rejected
    expect(
      chartConfigSchema.safeParse({
        chartType: "scatter",
        primary: { kind: "status", columnId: col },
      }).success,
    ).toBe(false);
    // a primary dimension is required
    expect(chartConfigSchema.safeParse({ chartType: "bar" }).success).toBe(
      false,
    );
  });

  it("defaults measure to count when omitted", () => {
    const parsed = chartConfigSchema.safeParse({
      chartType: "bar",
      primary: { kind: "status", columnId: col },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.measure).toEqual({ agg: "count" });
    }
  });
});

describe("batteryConfigSchema", () => {
  it("requires a groupColumnId", () => {
    expect(
      batteryConfigSchema.safeParse({
        groupColumnId: "11111111-1111-4111-8111-111111111111",
      }).success,
    ).toBe(true);
    expect(batteryConfigSchema.safeParse({}).success).toBe(false);
  });
});

describe("configSchemaForKind (D2)", () => {
  it("routes chart and battery to their schemas", () => {
    const col = "11111111-1111-4111-8111-111111111111";
    expect(
      configSchemaForKind("chart").safeParse({
        chartType: "bar",
        primary: { kind: "status", columnId: col },
      }).success,
    ).toBe(true);
    expect(
      configSchemaForKind("battery").safeParse({ groupColumnId: col }).success,
    ).toBe(true);
    // chart without a chartType/primary is rejected (no longer the permissive default)
    expect(configSchemaForKind("chart").safeParse({}).success).toBe(false);
  });
});

import { listConfigSchema } from "./dashboards";

describe("listConfigSchema", () => {
  const col = "11111111-1111-4111-8111-111111111111";
  it("defaults limit to 25 and accepts an empty column list", () => {
    const r = listConfigSchema.safeParse({ columnIds: [] });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.limit).toBe(25);
  });
  it("accepts columnIds + a bounded limit", () => {
    expect(
      listConfigSchema.safeParse({ columnIds: [col], limit: 50 }).success,
    ).toBe(true);
  });
  it("rejects a limit over 100 or under 1", () => {
    expect(
      listConfigSchema.safeParse({ columnIds: [], limit: 0 }).success,
    ).toBe(false);
    expect(
      listConfigSchema.safeParse({ columnIds: [], limit: 200 }).success,
    ).toBe(false);
  });
  it("rejects more than 8 columns", () => {
    expect(
      listConfigSchema.safeParse({ columnIds: Array(9).fill(col) }).success,
    ).toBe(false);
  });
});

describe("configSchemaForKind (list)", () => {
  it("routes list to listConfigSchema", () => {
    expect(
      configSchemaForKind("list").safeParse({ columnIds: [] }).success,
    ).toBe(true);
  });
});

describe("listConfigSchema filter", () => {
  it("accepts an empty config (D3a backward-compat)", () => {
    const r = listConfigSchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.filter).toBeUndefined();
  });

  it("accepts a flat AND/OR condition list", () => {
    const r = listConfigSchema.safeParse({
      columnIds: [UUID_A],
      limit: 25,
      filter: {
        combinator: "or",
        conditions: [
          { columnId: UUID_A, operator: "is", value: UUID_B },
          { columnId: UUID_A, operator: "is_empty" },
        ],
      },
    });
    expect(r.success).toBe(true);
  });

  it("defaults combinator to 'and'", () => {
    const r = listConfigSchema.safeParse({ filter: { conditions: [] } });
    expect(r.success && r.data.filter?.combinator).toBe("and");
  });

  it("rejects an unknown operator", () => {
    const r = listConfigSchema.safeParse({
      filter: { conditions: [{ columnId: UUID_A, operator: "matches" }] },
    });
    expect(r.success).toBe(false);
  });

  it("rejects a non-uuid columnId", () => {
    const r = listConfigSchema.safeParse({
      filter: { conditions: [{ columnId: "bad-id", operator: "is_empty" }] },
    });
    expect(r.success).toBe(false);
  });

  it("rejects more than 10 conditions", () => {
    const many = Array.from({ length: 11 }, () => ({
      columnId: UUID_A,
      operator: "not_empty" as const,
    }));
    const r = listConfigSchema.safeParse({ filter: { conditions: many } });
    expect(r.success).toBe(false);
  });
});
