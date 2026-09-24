"use client";

import { useCallback, useReducer, useRef } from "react";
import type {
  FolderLayoutConfig,
  KpiKey,
  LayoutSection,
  LayoutTab,
} from "@/lib/validations/folder-layout";
import type { BuiltinPanel } from "@/lib/validations/folder-layout";
import {
  DEFAULT_SECTION,
  PRESETS,
  type PresetKey,
} from "@/lib/folders/presets";

export type MoveDirection = "up" | "down";

type State = { config: FolderLayoutConfig; dirty: boolean };

type Action =
  | { type: "hide"; id: string }
  | { type: "move"; id: string; dir: MoveDirection }
  | { type: "setWidth"; id: string; w: number }
  | { type: "rename"; id: string; label: string }
  | { type: "setCards"; id: string; cards: KpiKey[] }
  | { type: "addSection"; panel: BuiltinPanel }
  | { type: "renameTab"; id: string; label: string }
  | { type: "hideTab"; id: string }
  | { type: "moveTab"; id: string; dir: MoveDirection }
  | { type: "reset"; preset: PresetKey }
  | { type: "revert"; config: FolderLayoutConfig };

/** Trims a label for the tab/section `label` schema (min 1, max 24 chars).
 *  Returns null when the trimmed result is empty — the caller no-ops rather
 *  than committing a value the schema would reject. */
function sanitizeLabel(v: string): string | null {
  const trimmed = v.trim();
  return trimmed.length === 0 ? null : trimmed.slice(0, 24);
}

function replaceAt<T>(arr: T[], index: number, value: T): T[] {
  const copy = arr.slice();
  copy[index] = value;
  return copy;
}

/** Swaps `index` with its up/down neighbor. Returns null (no-op) at either
 *  boundary or when `index` isn't found, so callers can bail without change. */
function moveInArray<T>(
  arr: T[],
  index: number,
  dir: MoveDirection,
): T[] | null {
  if (index === -1) return null;
  const target = dir === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= arr.length) return null;
  const copy = arr.slice();
  const tmp = copy[index]!;
  copy[index] = copy[target]!;
  copy[target] = tmp;
  return copy;
}

function canvasTabIndexWithSection(
  config: FolderLayoutConfig,
  id: string,
): number {
  return config.tabs.findIndex(
    (t) => t.kind === "canvas" && (t.sections ?? []).some((s) => s.id === id),
  );
}

function firstCanvasTabIndex(config: FolderLayoutConfig): number {
  return config.tabs.findIndex((t) => t.kind === "canvas");
}

/** Applies `fn` to the section with `id`, in a fresh tabs array. Returns null
 *  (no-op) when no such section exists — every caller must never mutate the
 *  section, tab, or config objects it reads (spec 1's presets share object
 *  identity with `DEFAULT_SECTION`, so an in-place write would corrupt the
 *  module-level presets for the whole process). */
function updateSection(
  config: FolderLayoutConfig,
  id: string,
  fn: (s: LayoutSection) => LayoutSection,
): FolderLayoutConfig | null {
  const tabIdx = canvasTabIndexWithSection(config, id);
  if (tabIdx === -1) return null;
  const tab = config.tabs[tabIdx]!;
  const sections = (tab.sections ?? []).map((s) => (s.id === id ? fn(s) : s));
  const tabs = replaceAt(config.tabs, tabIdx, { ...tab, sections });
  return { ...config, tabs };
}

function layoutReducer(state: State, action: Action): State {
  switch (action.type) {
    case "hide": {
      const tabIdx = canvasTabIndexWithSection(state.config, action.id);
      if (tabIdx === -1) return state;
      const tab = state.config.tabs[tabIdx]!;
      const sections = (tab.sections ?? []).filter((s) => s.id !== action.id);
      const tabs = replaceAt(state.config.tabs, tabIdx, { ...tab, sections });
      return { config: { ...state.config, tabs }, dirty: true };
    }
    case "move": {
      const tabIdx = canvasTabIndexWithSection(state.config, action.id);
      if (tabIdx === -1) return state;
      const tab = state.config.tabs[tabIdx]!;
      const sections = tab.sections ?? [];
      const idx = sections.findIndex((s) => s.id === action.id);
      const moved = moveInArray(sections, idx, action.dir);
      if (!moved) return state;
      const tabs = replaceAt(state.config.tabs, tabIdx, {
        ...tab,
        sections: moved,
      });
      return { config: { ...state.config, tabs }, dirty: true };
    }
    case "setWidth": {
      const config = updateSection(state.config, action.id, (s) => ({
        ...s,
        layout: { ...s.layout, w: action.w },
      }));
      if (!config) return state;
      return { config, dirty: true };
    }
    case "rename": {
      const clean = sanitizeLabel(action.label);
      if (clean === null) return state;
      const config = updateSection(state.config, action.id, (s) =>
        s.type === "builtin" ? { ...s, title: clean } : s,
      );
      if (!config) return state;
      return { config, dirty: true };
    }
    case "setCards": {
      if (action.cards.length === 0) return state;
      const cards = action.cards.slice(0, 6);
      const config = updateSection(state.config, action.id, (s) =>
        s.type === "builtin" && s.panel === "kpis"
          ? { ...s, props: { cards } }
          : s,
      );
      if (!config) return state;
      return { config, dirty: true };
    }
    case "addSection": {
      const tabIdx = firstCanvasTabIndex(state.config);
      if (tabIdx === -1) return state;
      const tab = state.config.tabs[tabIdx]!;
      const sections = tab.sections ?? [];
      const base = DEFAULT_SECTION[action.panel];
      const id = sections.some((s) => s.id === base.id)
        ? `${base.id}-2`
        : base.id;
      const section: LayoutSection = { ...base, id };
      const tabs = replaceAt(state.config.tabs, tabIdx, {
        ...tab,
        sections: [...sections, section],
      });
      return { config: { ...state.config, tabs }, dirty: true };
    }
    case "renameTab": {
      const clean = sanitizeLabel(action.label);
      if (clean === null) return state;
      const idx = state.config.tabs.findIndex((t) => t.id === action.id);
      if (idx === -1) return state;
      const tabs = replaceAt(state.config.tabs, idx, {
        ...state.config.tabs[idx]!,
        label: clean,
      });
      return { config: { ...state.config, tabs }, dirty: true };
    }
    case "hideTab": {
      // The last remaining tab can never be hidden — the command center
      // needs at least one tab to render.
      if (state.config.tabs.length <= 1) return state;
      const idx = state.config.tabs.findIndex((t) => t.id === action.id);
      if (idx === -1) return state;
      const tabs = state.config.tabs.filter((_, i) => i !== idx);
      return { config: { ...state.config, tabs }, dirty: true };
    }
    case "moveTab": {
      const idx = state.config.tabs.findIndex((t) => t.id === action.id);
      const moved = moveInArray(state.config.tabs, idx, action.dir);
      if (!moved) return state;
      return { config: { ...state.config, tabs: moved }, dirty: true };
    }
    case "reset":
      // Whole-config replacement — always dirty, even if it happens to equal
      // what's already on screen: nothing has been saved yet.
      return { config: PRESETS[action.preset], dirty: true };
    case "revert":
      return { config: action.config, dirty: false };
    default:
      return state;
  }
}

/**
 * Local draft editor for the command center layout. Pure client state — every
 * operation builds new section/tab/config objects rather than mutating what
 * it read (see `updateSection`'s note), and every operation leaves a config
 * `folderLayoutConfigSchema` accepts (proven by the "any sequence of edits"
 * test) since Save has no other validation pass before it hits the network.
 */
export function useLayoutDraft(initial: FolderLayoutConfig) {
  const initialRef = useRef(initial);
  const [state, dispatch] = useReducer(layoutReducer, initial, (config) => ({
    config,
    dirty: false,
  }));

  const hide = useCallback((id: string) => dispatch({ type: "hide", id }), []);
  const move = useCallback(
    (id: string, dir: MoveDirection) => dispatch({ type: "move", id, dir }),
    [],
  );
  const setWidth = useCallback(
    (id: string, w: number) => dispatch({ type: "setWidth", id, w }),
    [],
  );
  const rename = useCallback(
    (id: string, label: string) => dispatch({ type: "rename", id, label }),
    [],
  );
  const setCards = useCallback(
    (id: string, cards: KpiKey[]) => dispatch({ type: "setCards", id, cards }),
    [],
  );
  const addSection = useCallback(
    (panel: BuiltinPanel) => dispatch({ type: "addSection", panel }),
    [],
  );
  const renameTab = useCallback(
    (id: string, label: string) => dispatch({ type: "renameTab", id, label }),
    [],
  );
  const hideTab = useCallback(
    (id: string) => dispatch({ type: "hideTab", id }),
    [],
  );
  const moveTab = useCallback(
    (id: string, dir: MoveDirection) => dispatch({ type: "moveTab", id, dir }),
    [],
  );
  const reset = useCallback(
    (preset: PresetKey) => dispatch({ type: "reset", preset }),
    [],
  );
  const revert = useCallback(
    () => dispatch({ type: "revert", config: initialRef.current }),
    [],
  );

  return {
    config: state.config,
    dirty: state.dirty,
    hide,
    move,
    setWidth,
    rename,
    setCards,
    addSection,
    renameTab,
    hideTab,
    moveTab,
    reset,
    revert,
  };
}

export type LayoutDraft = ReturnType<typeof useLayoutDraft>;
export type { LayoutTab };
