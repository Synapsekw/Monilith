import { describe, expect, it } from "vitest";
import { folderLayoutConfigSchema } from "@/lib/validations/folder-layout";
import { PRESETS, PRESET_KEYS } from "./presets";
import { canvasSections, layoutNeedsBurn, resolveLayout } from "./layout";

describe("presets", () => {
  it("every preset is a valid config", () => {
    for (const key of PRESET_KEYS)
      expect(folderLayoutConfigSchema.safeParse(PRESETS[key]).success).toBe(
        true,
      );
  });

  it("the project preset is today's layout: six KPIs and all six panels", () => {
    const sections = canvasSections(PRESETS.project, "overview");
    expect(
      sections.map((s) => (s.type === "builtin" ? s.panel : "widget")),
    ).toEqual([
      "kpis",
      "burn",
      "boardStatus",
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
