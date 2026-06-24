/** Preset free-text category suggestions for non-item time-card rows.
 * Categories are free text (custom values allowed); these are just suggestions
 * surfaced in the add-row picker alongside the user's previously-used ones. */
export const PRESET_CATEGORIES = [
  "Meetings",
  "Admin",
  "Internal",
  "Leave/PTO",
  "Other",
] as const;

export type PresetCategory = (typeof PRESET_CATEGORIES)[number];
