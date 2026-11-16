import { describe, expect, it } from "vitest";
import { folderLayoutConfigSchema } from "@/lib/validations/folder-layout";
import { PRESETS, PRESET_KEYS } from "./presets";
import {
  canvasSections,
  layoutNeedsBurn,
  layoutNeedsLoad,
  resolveLayout,
} from "./layout";

describe("presets", () => {
  it("gives the crm and support presets the people section and no load map", () => {
    for (const key of ["crm", "support"] as const) {
      const panels = canvasSections(PRESETS[key], "overview").map((s) =>
        s.type === "builtin" ? s.panel : "widget",
      );
      expect(panels).toContain("people");
      expect(panels).not.toContain("load");
    }
  });

  it("every preset is a valid config", () => {
    for (const key of PRESET_KEYS)
      expect(folderLayoutConfigSchema.safeParse(PRESETS[key]).success).toBe(
        true,
      );
  });

  it("the project preset is the tower layout", () => {
    const sections = canvasSections(PRESETS.project, "overview");
    expect(
      sections.map((s) => (s.type === "builtin" ? s.panel : "widget")),
    ).toEqual([
      "kpis",
      "burn",
      "load",
      "boardStatus",
      "people",
      "attention",
      "intelligence",
      "milestones",
    ]);
    const kpis = sections[0];
    expect(kpis.type === "builtin" && kpis.props?.cards).toEqual([
      "complete",
      "gap",
      "overdue",
      "dueThisWeek",
      "blocked",
      "stale",
    ]);
    expect(PRESETS.project.tabs.map((t) => t.id)).toEqual([
      "overview",
      "stages",
      "timeline",
      "boards",
      "people",
    ]);
  });

  it("the crm preset drops burn and milestones and renames the stages tab", () => {
    const panels = canvasSections(PRESETS.crm, "overview").map((s) =>
      s.type === "builtin" ? s.panel : "widget",
    );
    expect(panels).not.toContain("burn");
    expect(panels).not.toContain("milestones");
    expect(PRESETS.crm.tabs.find((t) => t.kind === "stages")?.label).toBe(
      "Pipeline",
    );
  });
});

describe("resolveLayout", () => {
  it("falls back to the project preset when there is no row", () => {
    const resolved = resolveLayout(null);
    expect(resolved.config).toEqual(PRESETS.project);
    expect(resolved.preset).toBe("project");
    expect(resolved.version).toBe(0);
  });

  it("falls back to the row's own preset when the config is invalid", () => {
    const resolved = resolveLayout({
      preset: "crm",
      config: { v: 1, tabs: "nope" },
      version: 4,
    });
    expect(resolved.config).toEqual(PRESETS.crm);
    expect(resolved.version).toBe(4);
  });

  it("falls back to project when the preset column is also unknown", () => {
    const resolved = resolveLayout({ preset: "wat", config: null, version: 2 });
    expect(resolved.config).toEqual(PRESETS.project);
    expect(resolved.preset).toBe("project");
  });

  it("returns the stored config when it is valid", () => {
    const config = {
      v: 1,
      tabs: [{ id: "overview", label: "Deals", kind: "canvas", sections: [] }],
    };
    const resolved = resolveLayout({ preset: "blank", config, version: 7 });
    expect(resolved.config.tabs[0].label).toBe("Deals");
    expect(resolved.version).toBe(7);
  });
});

describe("resolveLayout with a panel this build does not know", () => {
  const rect = { x: 0, y: 0, w: 12, h: 4 };
  const known = (id: string, panel: string) => ({
    id,
    type: "builtin",
    panel,
    layout: rect,
  });
  const stored = (sections: unknown[]) => ({
    v: 1,
    tabs: [
      { id: "overview", label: "My overview", kind: "canvas", sections },
      { id: "people", label: "Team", kind: "people" },
    ],
  });

  it("drops the unknown panel and keeps the rest of the layout", () => {
    const resolved = resolveLayout({
      preset: "crm",
      config: stored([
        known("burn", "burn"),
        known("forecast", "forecastFromTheFuture"),
        known("people", "people"),
      ]),
      version: 9,
    });
    // Not the crm preset: the person's own tabs, labels and order survive.
    expect(resolved.config.tabs.map((t) => t.label)).toEqual([
      "My overview",
      "Team",
    ]);
    expect(resolved.config.tabs[0].sections?.map((s) => s.id)).toEqual([
      "burn",
      "people",
    ]);
    expect(resolved.preset).toBe("crm");
    expect(resolved.version).toBe(9);
  });

  it("drops a section of a type this build does not know", () => {
    const resolved = resolveLayout({
      preset: "project",
      config: stored([
        known("burn", "burn"),
        {
          id: "embed",
          type: "embed",
          url: "https://example.com",
          layout: rect,
        },
      ]),
      version: 3,
    });
    expect(resolved.config.tabs[0].sections?.map((s) => s.id)).toEqual([
      "burn",
    ]);
  });

  it("keeps a tab whose only section was unknown, as an empty canvas", () => {
    const resolved = resolveLayout({
      preset: "project",
      config: stored([known("forecast", "forecastFromTheFuture")]),
      version: 3,
    });
    expect(resolved.config.tabs[0].label).toBe("My overview");
    expect(resolved.config.tabs[0].sections).toEqual([]);
  });

  it("keeps widget sections and kpi props untouched", () => {
    const widget = {
      id: "w1",
      type: "widget",
      widgetId: "3f2c1a5e-8f0b-4c1d-9a7e-2b6d4c8e1f00",
      layout: rect,
    };
    const kpis = {
      id: "kpis",
      type: "builtin",
      panel: "kpis",
      props: { cards: ["overdue", "blocked"] },
      layout: rect,
    };
    const resolved = resolveLayout({
      preset: "project",
      config: stored([kpis, known("x", "notYet"), widget]),
      version: 1,
    });
    expect(resolved.config.tabs[0].sections).toEqual([kpis, widget]);
  });

  it("still falls back to the preset when the config is broken another way", () => {
    // A known panel with an impossible rect is corruption, not a newer build.
    const resolved = resolveLayout({
      preset: "crm",
      config: stored([
        known("x", "notYet"),
        { ...known("burn", "burn"), layout: { x: 99, y: 0, w: 12, h: 4 } },
      ]),
      version: 5,
    });
    expect(resolved.config).toEqual(PRESETS.crm);
  });

  it("returns a valid stored config by the strict path, unchanged", () => {
    const config = stored([known("burn", "burn")]);
    expect(
      resolveLayout({ preset: "blank", config, version: 2 }).config,
    ).toEqual(config);
  });
});

describe("layoutNeedsBurn", () => {
  const cfg = (tabs: unknown[]) =>
    folderLayoutConfigSchema.parse({ v: 1, tabs });
  const burnSection = {
    id: "burn",
    type: "builtin",
    panel: "burn",
    layout: { x: 0, y: 0, w: 8, h: 4 },
  };

  it("is true when a burn section is present", () => {
    expect(
      layoutNeedsBurn(
        cfg([{ id: "o", label: "O", kind: "canvas", sections: [burnSection] }]),
      ),
    ).toBe(true);
  });

  it("is true when a stages tab is present even with no burn section", () => {
    expect(
      layoutNeedsBurn(
        cfg([
          { id: "o", label: "O", kind: "canvas", sections: [] },
          { id: "stages", label: "Pipeline", kind: "stages" },
        ]),
      ),
    ).toBe(true);
  });

  it("is false only when neither is present", () => {
    expect(
      layoutNeedsBurn(
        cfg([{ id: "o", label: "O", kind: "canvas", sections: [] }]),
      ),
    ).toBe(false);
  });
});

describe("layoutNeedsLoad", () => {
  it("is true only when a canvas tab holds a builtin load section", () => {
    expect(layoutNeedsLoad(PRESETS.project)).toBe(true);
    expect(layoutNeedsLoad(PRESETS.blank)).toBe(false);
    expect(
      layoutNeedsLoad({
        v: 1,
        tabs: [
          {
            id: "overview",
            label: "Overview",
            kind: "canvas",
            sections: [
              {
                id: "burn",
                type: "builtin",
                panel: "burn",
                layout: { x: 0, y: 0, w: 6, h: 4 },
              },
            ],
          },
        ],
      } as never),
    ).toBe(false);
  });
});
