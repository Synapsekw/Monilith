export const PRESENCE_PALETTE = [
  "#e8595b",
  "#f2994a",
  "#f2c94c",
  "#27ae60",
  "#2d9cdb",
  "#9b51e0",
  "#eb5fa6",
  "#56ccf2",
] as const;

export type PresencePaletteColor = (typeof PRESENCE_PALETTE)[number];

/** Deterministic, stable color for a user across the whole app. */
export function presenceColor(userId: string): PresencePaletteColor {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(hash) % PRESENCE_PALETTE.length;
  return PRESENCE_PALETTE[idx];
}
