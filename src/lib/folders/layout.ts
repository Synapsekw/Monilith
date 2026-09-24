import {
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

/**
 * Row (or its absence) to a config that always renders.
 *
 * A malformed config must NEVER fail the folder page — same degradation
 * posture the folder RPC panels use for a failed read. An unparseable config
 * falls back to the row's own preset, and an unknown preset to `project`,
 * which is today's layout. `version: 0` means "no row yet": the save action
 * inserts rather than updates.
 */
export function resolveLayout(row: FolderLayoutRow | null): ResolvedLayout {
  if (!row) return { config: PRESETS.project, preset: "project", version: 0 };
  const preset = isPresetKey(row.preset) ? row.preset : "project";
  const parsed = folderLayoutConfigSchema.safeParse(row.config);
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
