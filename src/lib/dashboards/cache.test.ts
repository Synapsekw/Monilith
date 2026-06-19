import { describe, expect, it } from "vitest";
import {
  applyLayouts,
  insertWidget,
  removeWidget,
  renameDashboard,
  replaceWidget,
  type DashboardCache,
  type CacheWidget,
} from "./cache";

function widget(id: string, extra: Partial<CacheWidget> = {}): CacheWidget {
  return {
    id,
    org_id: "o1",
    dashboard_id: "d1",
    source_board_id: "b1",
    kind: "number",
    title: "",
    config: { agg: "count" },
    layout: { x: 0, y: 0, w: 2, h: 2 },
    position: 0,
    created_at: "",
    updated_at: "",
    ...extra,
  } as CacheWidget;
}

function base(): DashboardCache {
  return {
    dashboard: {
      id: "d1",
      org_id: "o1",
      name: "D",
    } as DashboardCache["dashboard"],
    widgets: [widget("w1")],
  };
}

describe("insertWidget", () => {
  it("appends a widget; idempotent on id", () => {
    const next = insertWidget(base(), widget("w2"));
    expect(next.widgets.map((w) => w.id)).toEqual(["w1", "w2"]);
    expect(insertWidget(next, widget("w2")).widgets).toHaveLength(2);
  });
  it("does not mutate the input", () => {
    const input = base();
    insertWidget(input, widget("w2"));
    expect(input.widgets).toHaveLength(1);
  });
});

describe("replaceWidget", () => {
  it("replaces by id", () => {
    const next = replaceWidget(base(), widget("w1", { title: "X" }));
    expect(next.widgets[0].title).toBe("X");
  });
});

describe("removeWidget", () => {
  it("removes by id", () => {
    expect(removeWidget(base(), "w1").widgets).toHaveLength(0);
  });
});

describe("renameDashboard", () => {
  it("updates the dashboard name, leaving widgets untouched", () => {
    const next = renameDashboard(base(), "Renamed");
    expect(next.dashboard.name).toBe("Renamed");
    expect(next.widgets).toHaveLength(1);
  });
  it("does not mutate the input", () => {
    const input = base();
    renameDashboard(input, "Renamed");
    expect(input.dashboard.name).toBe("D");
  });
});

describe("applyLayouts", () => {
  it("patches layout rects by id, leaving others untouched", () => {
    const cache = insertWidget(base(), widget("w2"));
    const next = applyLayouts(cache, [{ id: "w2", x: 3, y: 1, w: 4, h: 2 }]);
    expect(next.widgets.find((w) => w.id === "w2")!.layout).toEqual({
      x: 3,
      y: 1,
      w: 4,
      h: 2,
    });
    expect(next.widgets.find((w) => w.id === "w1")!.layout).toEqual({
      x: 0,
      y: 0,
      w: 2,
      h: 2,
    });
  });
});
