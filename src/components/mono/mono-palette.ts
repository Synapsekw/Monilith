export type MonoPalette = {
  glow: string;
  glowRgb: [number, number, number];
  beltDark: string;
  beltDeep: string;
  beltLight: string;
  beltHighlight: string;
  eyeBloomRgb: [number, number, number];
};

export const MONO_PRESET_COLORS = [
  { name: "Periwinkle", hex: "#7395ff" },
  { name: "Ember", hex: "#ff8a4c" },
  { name: "Mint", hex: "#3fe0a5" },
  { name: "Rose", hex: "#ff6fa8" },
  { name: "Violet", hex: "#a77bff" },
  { name: "Sun", hex: "#ffc94d" },
  { name: "Ice", hex: "#5fd4ff" },
] as const;

const HEX = /^#[0-9a-f]{6}$/i;

export const DEFAULT_MONO_COLOR = "#7395ff";

/** True for `#rrggbb` (either case): the only colour shape a Mono stores. */
export function isMonoColor(hex: string): boolean {
  return HEX.test(hex);
}

function toRgb(hex: string): [number, number, number] {
  if (!HEX.test(hex)) throw new Error(`Invalid Mono colour: ${hex}`);
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [
    number,
    number,
    number,
  ];
}

function mixRgb(
  c: [number, number, number],
  toward: 0 | 255,
  amount: number,
): [number, number, number] {
  return c.map((v) => Math.round(v + (toward - v) * amount)) as [
    number,
    number,
    number,
  ];
}

const css = (c: [number, number, number]) => `rgb(${c.join(",")})`;

export function monoPalette(hex: string): MonoPalette {
  const rgb = toRgb(hex);
  return {
    glow: hex.toLowerCase(),
    glowRgb: rgb,
    beltDark: css(mixRgb(rgb, 0, 0.45)),
    beltDeep: css(mixRgb(rgb, 0, 0.85)),
    beltLight: css(mixRgb(rgb, 255, 0.45)),
    beltHighlight: css(mixRgb(rgb, 255, 0.7)),
    eyeBloomRgb: mixRgb(rgb, 255, 0.55),
  };
}
