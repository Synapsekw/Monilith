import { describe, expect, it } from "vitest";
import { folderLayoutConfigSchema } from "./folder-layout";

const canvasTab = (sections: unknown[]) => ({
  id: "overview",
  label: "Overview",
  kind: "canvas",
  sections,
});
const kpis = {
  id: "kpis",
  type: "builtin",
  panel: "kpis",
  props: { cards: ["complete", "overdue"] },
  layout: { x: 0, y: 0, w: 12, h: 2 },
};

describe("folderLayoutConfigSchema", () => {
  it("accepts a minimal one-tab config", () => {
    const parsed = folderLayoutConfigSchema.safeParse({
      v: 1,
      tabs: [canvasTab([kpis])],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects duplicate tab ids", () => {
    const parsed = folderLayoutConfigSchema.safeParse({
      v: 1,
      tabs: [canvasTab([]), canvasTab([])],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects two tabs of the same singleton built-in kind", () => {
    const parsed = folderLayoutConfigSchema.safeParse({
      v: 1,
      tabs: [
        { id: "a", label: "Stages", kind: "stages" },
        { id: "b", label: "Phases", kind: "stages" },
      ],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects duplicate section ids inside one tab", () => {
    const parsed = folderLayoutConfigSchema.safeParse({
      v: 1,
      tabs: [canvasTab([kpis, { ...kpis }])],
    });
    expect(parsed.success).toBe(false);
  });

  it("requires cards on a kpis section and forbids props elsewhere", () => {
    expect(
      folderLayoutConfigSchema.safeParse({
        v: 1,
        tabs: [canvasTab([{ ...kpis, props: undefined }])],
      }).success,
    ).toBe(false);
    expect(
      folderLayoutConfigSchema.safeParse({
        v: 1,
        tabs: [
          canvasTab([
            {
              id: "burn",
              type: "builtin",
              panel: "burn",
              props: { cards: ["complete"] },
              layout: { x: 0, y: 0, w: 8, h: 4 },
            },
          ]),
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects sections on a non-canvas tab", () => {
    const parsed = folderLayoutConfigSchema.safeParse({
      v: 1,
      tabs: [
        { id: "stages", label: "Stages", kind: "stages", sections: [kpis] },
      ],
    });
    expect(parsed.success).toBe(false);
  });

  it("enforces the bounds: 6 tabs, 24 sections, 6 KPI cards, 24-char label", () => {
    const many = (n: number, f: (i: number) => unknown) =>
      Array.from({ length: n }, (_, i) => f(i));
    expect(
      folderLayoutConfigSchema.safeParse({
        v: 1,
        tabs: many(7, (i) => ({
          id: `t${i}`,
          label: `T${i}`,
          kind: "canvas",
          sections: [],
        })),
      }).success,
    ).toBe(false);
    expect(
      folderLayoutConfigSchema.safeParse({
        v: 1,
        tabs: [canvasTab(many(25, (i) => ({ ...kpis, id: `s${i}` })))],
      }).success,
    ).toBe(false);
    expect(
      folderLayoutConfigSchema.safeParse({
        v: 1,
        tabs: [
          canvasTab([
            {
              ...kpis,
              props: {
                cards: [
                  "complete",
                  "gap",
                  "overdue",
                  "dueThisWeek",
                  "blocked",
                  "stale",
                  "complete",
                ],
              },
            },
          ]),
        ],
      }).success,
    ).toBe(false);
    expect(
      folderLayoutConfigSchema.safeParse({
        v: 1,
        tabs: [
          {
            id: "overview",
            label: "x".repeat(25),
            kind: "canvas",
            sections: [],
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("accepts a widget section so spec 2 needs no config migration", () => {
    const parsed = folderLayoutConfigSchema.safeParse({
      v: 1,
      tabs: [
        canvasTab([
          {
            id: "w1",
            type: "widget",
            widgetId: "8f1d6b3e-3f4a-4a9e-9a7c-1c2d3e4f5a6b",
            layout: { x: 0, y: 0, w: 4, h: 4 },
          },
        ]),
      ],
    });
    expect(parsed.success).toBe(true);
  });
});
