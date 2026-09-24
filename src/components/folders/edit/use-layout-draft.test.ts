import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { folderLayoutConfigSchema } from "@/lib/validations/folder-layout";
import { PRESETS } from "@/lib/folders/presets";
import { useLayoutDraft } from "./use-layout-draft";

const panels = (config: {
  tabs: { sections?: { type: string; panel?: string }[] }[];
}) =>
  (config.tabs[0].sections ?? []).map((s) =>
    s.type === "builtin" ? s.panel : "widget",
  );

const draft = () => renderHook(() => useLayoutDraft(PRESETS.project));

describe("useLayoutDraft", () => {
  it("starts clean and hides a section by removing it from the tab", () => {
    const { result } = draft();
    expect(result.current.dirty).toBe(false);
    act(() => result.current.hide("burn"));
    expect(panels(result.current.config)).not.toContain("burn");
    expect(result.current.dirty).toBe(true);
  });

  it("moves a section up without disturbing the rest of the order", () => {
    const { result } = draft();
    act(() => result.current.move("burn", "up"));
    expect(panels(result.current.config)).toEqual([
      "burn",
      "kpis",
      "boardStatus",
      "attention",
      "intelligence",
      "milestones",
    ]);
  });

  it("is a no-op when moving the first section up or the last one down", () => {
    const { result } = draft();
    act(() => result.current.move("kpis", "up"));
    expect(panels(result.current.config)).toEqual([
      "kpis",
      "burn",
      "boardStatus",
      "attention",
      "intelligence",
      "milestones",
    ]);
    expect(result.current.dirty).toBe(false);
  });

  it("re-adds a hidden panel with its default rect", () => {
    const { result } = draft();
    act(() => result.current.hide("burn"));
    act(() => result.current.addSection("burn"));
    const added = (result.current.config.tabs[0].sections ?? []).find(
      (s) => s.type === "builtin" && s.panel === "burn",
    );
    expect(added?.layout.w).toBe(8);
  });

  it("sets a section width and changes nothing else about it", () => {
    const { result } = draft();
    act(() => result.current.setWidth("attention", 12));
    const section = (result.current.config.tabs[0].sections ?? []).find(
      (s) => s.id === "attention",
    );
    expect(section?.layout).toEqual({ x: 0, y: 6, w: 12, h: 5 });
  });

  it("trims a rename and rejects an empty one", () => {
    const { result } = draft();
    act(() => result.current.rename("attention", "  Open risks  "));
    const section = (result.current.config.tabs[0].sections ?? []).find(
      (s) => s.id === "attention",
    );
    expect(section?.type === "builtin" && section.title).toBe("Open risks");
    act(() => result.current.rename("attention", "   "));
    const after = (result.current.config.tabs[0].sections ?? []).find(
      (s) => s.id === "attention",
    );
    expect(after?.type === "builtin" && after.title).toBe("Open risks");
  });

  it("sets the KPI card list in the chosen order and refuses an empty list", () => {
    const { result } = draft();
    act(() => result.current.setCards("kpis", ["overdue", "complete"]));
    const kpis = (result.current.config.tabs[0].sections ?? [])[0];
    expect(kpis.type === "builtin" && kpis.props?.cards).toEqual([
      "overdue",
      "complete",
    ]);
    act(() => result.current.setCards("kpis", []));
    const after = (result.current.config.tabs[0].sections ?? [])[0];
    expect(after.type === "builtin" && after.props?.cards).toEqual([
      "overdue",
      "complete",
    ]);
  });

  it("hides a tab but never the last remaining one", () => {
    const { result } = draft();
    act(() => result.current.hideTab("people"));
    expect(result.current.config.tabs.map((t) => t.id)).toEqual([
      "overview",
      "stages",
      "boards",
    ]);
    act(() => result.current.hideTab("stages"));
    act(() => result.current.hideTab("boards"));
    act(() => result.current.hideTab("overview"));
    expect(result.current.config.tabs).toHaveLength(1);
  });

  it("reset(preset) replaces the whole config and stays dirty", () => {
    const { result } = draft();
    act(() => result.current.reset("crm"));
    expect(result.current.config).toEqual(PRESETS.crm);
    expect(result.current.dirty).toBe(true);
  });

  it("revert() restores the initial config and clears dirty", () => {
    const { result } = draft();
    act(() => result.current.hide("burn"));
    act(() => result.current.revert());
    expect(result.current.config).toEqual(PRESETS.project);
    expect(result.current.dirty).toBe(false);
  });

  it("leaves a schema-valid config after any sequence of edits", () => {
    const { result } = draft();
    act(() => result.current.hide("burn"));
    act(() => result.current.move("attention", "up"));
    act(() => result.current.setWidth("attention", 12));
    act(() => result.current.rename("attention", "Open risks"));
    act(() => result.current.setCards("kpis", ["overdue", "blocked"]));
    act(() => result.current.renameTab("stages", "Pipeline"));
    act(() => result.current.hideTab("people"));
    act(() => result.current.addSection("burn"));
    expect(
      folderLayoutConfigSchema.safeParse(result.current.config).success,
    ).toBe(true);
  });
});
