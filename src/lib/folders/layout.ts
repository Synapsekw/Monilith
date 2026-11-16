import {
  BUILTIN_PANELS,
  folderLayoutConfigSchema,
  type FolderLayoutConfig,
  type LayoutSection,
} from "@/lib/validations/folder-layout";
import { PRESETS, PRESET_KEYS, type PresetKey } from "./presets";

export type FolderLayoutRow = {
  preset: string;
  config: unknown;
  version: number;
};

export type ResolvedLayout = {
  config: FolderLayoutConfig;
  preset: PresetKey;
  version: number;
};

const isPresetKey = (v: string): v is PresetKey =>
  (PRESET_KEYS as readonly string[]).includes(v);

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** A section this build cannot draw: a section type it has never heard of, or
 *  a builtin whose panel id is not in `BUILTIN_PANELS`. */
function isUnknownSection(section: unknown): boolean {
  if (!isRecord(section)) return false;
  if (section.type === "widget") return false;
  if (section.type !== "builtin") return typeof section.type === "string";
  return (
    typeof section.panel === "string" &&
    !(BUILTIN_PANELS as readonly string[]).includes(section.panel)
  );
}

/**
 * A copy of a stored config without the sections this build does not know.
 * Everything else is left exactly as stored, so a config that is broken in any
 * other way still fails the strict parse and takes the preset fallback.
 */
function withoutUnknownSections(config: unknown): unknown {
  if (!isRecord(config) || !Array.isArray(config.tabs)) return config;
  return {
    ...config,
    tabs: config.tabs.map((tab: unknown) =>
      isRecord(tab) && Array.isArray(tab.sections)
        ? {
            ...tab,
            sections: tab.sections.filter((s) => !isUnknownSection(s)),
          }
        : tab,
    ),
  };
}

/**
 * Row (or its absence) to a config that always renders.
 *
 * A malformed config must NEVER fail the folder page — same degradation
 * posture the folder RPC panels use for a failed read. An unparseable config
 * falls back to the row's own preset, and an unknown preset to `project`,
 * which is today's layout. `version: 0` means "no row yet": the save action
 * inserts rather than updates.
 *
 * One unknown panel is not a malformed config. A layout saved by a newer build
 * can name a panel this one has never heard of; that section is dropped and
 * every other tab and section the person arranged is kept, instead of the
 * whole layout being thrown away for the preset. The strict schema still
 * guards the write path (`saveFolderLayoutSchema`).
 */
export function resolveLayout(row: FolderLayoutRow | null): ResolvedLayout {
  if (!row) return { config: PRESETS.project, preset: "project", version: 0 };
  const preset = isPresetKey(row.preset) ? row.preset : "project";
  const strict = folderLayoutConfigSchema.safeParse(row.config);
  const parsed = strict.success
    ? strict
    : folderLayoutConfigSchema.safeParse(withoutUnknownSections(row.config));
  return {
    config: parsed.success ? parsed.data : PRESETS[preset],
    preset,
    version: row.version,
  };
}

/** Sections of one canvas tab, in render order. Empty for a non-canvas tab. */
export function canvasSections(
  config: FolderLayoutConfig,
  tabId: string,
): LayoutSection[] {
  const tab = config.tabs.find((t) => t.id === tabId);
  return tab?.kind === "canvas" ? (tab.sections ?? []) : [];
}

/**
 * Whether `folder_burn` must run. TWO consumers, not one: the Overview's burn
 * section AND the Stages tab's own chart (`tabs/Stages.tsx`). Gating on the
 * section alone would leave a folder that kept its stages tab rendering a
 * permanently failed chart.
 * A layout with KPI cards but no burn section and no stages tab deliberately
 * skips the read, so its KPI cards show no trends.
 */
export function layoutNeedsBurn(config: FolderLayoutConfig): boolean {
  return config.tabs.some(
    (t) =>
      t.kind === "stages" ||
      (t.sections ?? []).some(
        (s) => s.type === "builtin" && s.panel === "burn",
      ),
  );
}

/**
 * Whether `folder_load` must run: only a canvas tab holding a builtin `load`
 * section draws the heat map. The payload also skips the read for a folder
 * with no dated items (see `hasDatedItems`).
 */
export function layoutNeedsLoad(config: FolderLayoutConfig): boolean {
  return config.tabs.some((t) =>
    (t.sections ?? []).some((s) => s.type === "builtin" && s.panel === "load"),
  );
}
