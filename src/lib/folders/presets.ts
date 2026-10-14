import type {
  BuiltinPanel,
  FolderLayoutConfig,
  LayoutSection,
} from "@/lib/validations/folder-layout";

export const PRESET_KEYS = ["project", "crm", "support", "blank"] as const;
export type PresetKey = (typeof PRESET_KEYS)[number];

/** Narrower than `LayoutSection` so spreading `{ ...KPIS, props: {...} }`
 *  below keeps `props`/`panel` in scope — the exported `DEFAULT_SECTION`
 *  widens back to `LayoutSection` per the public interface. */
type BuiltinSection = Extract<LayoutSection, { type: "builtin" }>;

const KPIS: BuiltinSection = {
  id: "kpis",
  type: "builtin",
  panel: "kpis",
  props: {
    cards: ["complete", "gap", "overdue", "dueThisWeek", "blocked", "stale"],
  },
  layout: { x: 0, y: 0, w: 12, h: 2 },
};
const BURN: BuiltinSection = {
  id: "burn",
  type: "builtin",
  panel: "burn",
  layout: { x: 0, y: 2, w: 8, h: 4 },
};
const BOARD_STATUS: BuiltinSection = {
  id: "board-status",
  type: "builtin",
  panel: "boardStatus",
  layout: { x: 8, y: 2, w: 4, h: 4 },
};
const ATTENTION: BuiltinSection = {
  id: "attention",
  type: "builtin",
  panel: "attention",
  layout: { x: 0, y: 6, w: 8, h: 5 },
};
const INTELLIGENCE: BuiltinSection = {
  id: "intelligence",
  type: "builtin",
  panel: "intelligence",
  layout: { x: 8, y: 6, w: 4, h: 3 },
};
const MILESTONES: BuiltinSection = {
  id: "milestones",
  type: "builtin",
  panel: "milestones",
  layout: { x: 8, y: 9, w: 4, h: 2 },
};

/** Default rect + props for a panel the user adds back from the Sections sheet.
 *  `y` is rewritten on save by the draft reducer; `x`/`w` are the real content. */
export const DEFAULT_SECTION: Record<BuiltinPanel, LayoutSection> = {
  kpis: KPIS,
  burn: BURN,
  boardStatus: BOARD_STATUS,
  attention: ATTENTION,
  intelligence: INTELLIGENCE,
  milestones: MILESTONES,
};

const pick = (...panels: BuiltinPanel[]): LayoutSection[] =>
  panels.map((p) => DEFAULT_SECTION[p]);

const STAGES_TAB = { id: "stages", label: "Stages", kind: "stages" } as const;
const BOARDS_TAB = { id: "boards", label: "Boards", kind: "boards" } as const;
const PEOPLE_TAB = { id: "people", label: "People", kind: "people" } as const;

/**
 * `project` is today's layout, exactly: the six KPI cards in their current
 * order, burn + status-by-board on one row, attention with intelligence and
 * milestones stacked in the right column, and the four current tabs.
 */
export const PRESETS: Record<PresetKey, FolderLayoutConfig> = {
  project: {
    v: 1,
    tabs: [
      {
        id: "overview",
        label: "Overview",
        kind: "canvas",
        sections: pick(
          "kpis",
          "burn",
          "boardStatus",
          "attention",
          "intelligence",
          "milestones",
        ),
      },
      STAGES_TAB,
      BOARDS_TAB,
      PEOPLE_TAB,
    ],
  },
  crm: {
    v: 1,
    tabs: [
      {
        id: "overview",
        label: "Overview",
        kind: "canvas",
        sections: [
          {
            ...KPIS,
            props: { cards: ["complete", "overdue", "dueThisWeek"] },
          },
          { ...ATTENTION, layout: { x: 0, y: 2, w: 8, h: 5 } },
          {
            ...BOARD_STATUS,
            layout: { x: 8, y: 2, w: 4, h: 4 },
          },
          {
            ...INTELLIGENCE,
            layout: { x: 8, y: 7, w: 4, h: 3 },
          },
        ],
      },
      { ...STAGES_TAB, label: "Pipeline" },
      BOARDS_TAB,
    ],
  },
  support: {
    v: 1,
    tabs: [
      {
        id: "overview",
        label: "Overview",
        kind: "canvas",
        sections: [
          {
            ...KPIS,
            props: { cards: ["overdue", "dueThisWeek", "blocked", "stale"] },
          },
          { ...ATTENTION, layout: { x: 0, y: 2, w: 8, h: 5 } },
          {
            ...BOARD_STATUS,
            layout: { x: 8, y: 2, w: 4, h: 4 },
          },
        ],
      },
      BOARDS_TAB,
      PEOPLE_TAB,
    ],
  },
  blank: {
    v: 1,
    tabs: [
      { id: "overview", label: "Overview", kind: "canvas", sections: [] },
      BOARDS_TAB,
    ],
  },
};
