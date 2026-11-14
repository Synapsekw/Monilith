import type { MonoPalette } from "./mono-palette";

export type MonoMood =
  "idle" | "hello" | "listening" | "thinking" | "needsyou" | "done" | "dozing";

export const MONO_MOODS: readonly MonoMood[] = [
  "idle",
  "hello",
  "listening",
  "thinking",
  "needsyou",
  "done",
  "dozing",
];

type Pose = {
  r: number;
  y: number;
  x: number;
  sx: number;
  sy: number;
  eye: number;
  lEye: number;
  rEye: number;
  ex: number;
  ey: number;
  happy: number;
  smile: number;
  light: number;
  think: number;
};

type PathCmd =
  | ["M" | "L", number, number]
  | ["C", number, number, number, number, number, number]
  | ["Q", number, number, number, number]
  | ["Z"];

const personality = { expressiveness: 1.35, glow: 1.5 };
const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const smooth = (x: number) => {
  x = clamp(x);
  return x * x * (3 - 2 * x);
};
const pulse = (t: number, start: number, duration: number) =>
  Math.sin(Math.PI * clamp((t - start) / duration));

const shell: PathCmd[] = [
  ["M", -91, -49],
  ["C", -87, -72, -53, -81, -15, -85],
  ["C", 23, -89, 69, -84, 85, -71],
  ["C", 101, -58, 109, -11, 108, 22],
  ["C", 109, 58, 97, 78, 71, 86],
  ["C", 37, 96, -53, 94, -79, 75],
  ["C", -101, 59, -103, -11, -91, -49],
  ["Z"],
];
const face: PathCmd[] = [
  ["M", -84, -40],
  ["C", -78, -58, -44, -65, -12, -67],
  ["C", 22, -71, 61, -67, 76, -54],
  ["C", 88, -43, 95, -9, 90, 18],
  ["C", 86, 42, 56, 54, 19, 58],
  ["C", -23, 62, -65, 52, -76, 36],
  ["C", -89, 19, -91, -17, -84, -40],
  ["Z"],
];
const belt: PathCmd[] = [
  ["M", -92, 53],
  ["C", -73, 73, -26, 80, 19, 77],
  ["C", 61, 76, 90, 65, 101, 47],
];
function pose(t: number, mood: MonoMood, blinkAge: number): Pose {
  const lengths: Partial<Record<MonoMood, number>> = { hello: 2, done: 2.7 };
  const limit = lengths[mood];
  const motion: MonoMood = limit && t > limit ? "idle" : mood;
  const p: Pose = {
    r: 0,
    y: 0,
    x: 0,
    sx: 1,
    sy: 1,
    eye: 1,
    lEye: 1,
    rEye: 1,
    ex: 0,
    ey: 0,
    happy: 0,
    smile: 1,
    light: 0.42,
    think: 0,
  };
  const a = personality.expressiveness;
  if (motion === "hello") {
    p.y = -20 * pulse(t, 0.08, 0.85);
    p.r = -0.13 * pulse(t, 0.3, 0.65) + 0.08 * pulse(t, 0.95, 0.5);
    p.sx = 1 + 0.08 * pulse(t, 0, 0.3);
    p.sy =
      1 -
      0.08 * pulse(t, 0, 0.3) +
      0.055 * pulse(t, 0.3, 0.35) -
      0.04 * pulse(t, 0.9, 0.25);
    p.eye = 1 + 0.2 * pulse(t, 0.1, 0.85);
    p.smile = 1.35;
    p.light = 0.5 + 0.8 * pulse(t, 0, 1.6);
  }
  if (motion === "listening") {
    p.r = -0.11;
    p.y = -6 + Math.sin(t * 1.8);
    p.x = 3;
    p.ex = 5;
    p.ey = -4;
    p.sx = 1.025;
    p.sy = 1.025;
    p.eye = 1.15;
    p.light = 0.95;
  }
  if (motion === "thinking") {
    p.r = -0.095 + Math.sin(t * 2.2) * 0.025;
    p.y = -4 + Math.sin(t * 2.2) * 1.8;
    p.ex = -10;
    p.ey = -10;
    p.rEye = 0.58;
    p.think = 1;
    p.light = 0.85;
  }
  if (motion === "done") {
    p.y = -25 * pulse(t, 0.2, 0.75) - 12 * pulse(t, 1.05, 0.55);
    p.sy =
      1 -
      0.09 * pulse(t, 0, 0.24) +
      0.065 * pulse(t, 0.27, 0.3) -
      0.07 * pulse(t, 0.89, 0.22) +
      0.035 * pulse(t, 1.13, 0.24) -
      0.035 * pulse(t, 1.59, 0.2);
    p.sx = 2 - p.sy;
    p.happy = pulse(t, 0.12, 2.2);
    p.light = 0.5 + 0.95 * pulse(t, 0.9, 0.42) + 0.8 * pulse(t, 1.55, 0.42);
    p.r = -0.09 * pulse(t, 0.3, 0.8) + 0.065 * pulse(t, 1.15, 0.55);
  }
  if (motion === "needsyou") {
    p.r = 0.16;
    p.ex = 6;
    p.ey = -4;
    p.lEye = 0.48;
    p.rEye = 1.23;
    p.smile = 0.2;
    p.light = 0.67;
  }
  if (motion === "dozing") {
    const v = smooth(t / 1.2);
    p.y = 5 * v;
    p.sy = 1 - 0.035 * v;
    p.eye = 1 - 0.92 * v;
    p.ey = 5 * v;
    p.light = 0.42 - 0.3 * v;
    p.r = -0.025 * v;
  }
  if (motion === "idle") {
    p.eye = 1 - 0.96 * Math.sin(Math.PI * clamp(blinkAge / 0.16));
    p.y = -2.8 + Math.sin(t * 1.7) * 2.8;
    p.r = Math.sin(t * 1.05) * 0.018;
    p.sy = 1 + Math.sin(t * 1.7) * 0.008;
    p.light = 0.5 + Math.sin(t * 1.7) * 0.07;
    const moment = t % 18;
    p.ex = 7 * pulse(moment, 5, 2.2) - 5 * pulse(moment, 13, 2);
    p.ey = -3 * pulse(moment, 5, 2.2);
  }
  if (["listening", "thinking", "needsyou"].includes(motion) && blinkAge > 0)
    p.eye = 1 - 0.96 * Math.sin(Math.PI * clamp(blinkAge / 0.16));
  p.r *= a;
  p.x *= a;
  p.y *= a;
  p.sx = 1 + (p.sx - 1) * a;
  p.sy = 1 + (p.sy - 1) * a;
  return p;
}

function path(ctx: CanvasRenderingContext2D, points: PathCmd[]) {
  ctx.beginPath();
  for (const p of points) {
    if (p[0] === "M") ctx.moveTo(p[1], p[2]);
    else if (p[0] === "L") ctx.lineTo(p[1], p[2]);
    else if (p[0] === "C")
      ctx.bezierCurveTo(p[1], p[2], p[3], p[4], p[5], p[6]);
    else if (p[0] === "Q") ctx.quadraticCurveTo(p[1], p[2], p[3], p[4]);
    else ctx.closePath();
  }
}

function paintMono(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
  p: Pose,
  t: number,
  palette: MonoPalette,
) {
  const rgb = palette.glowRgb.join(",");
  const bloomRgb = palette.eyeBloomRgb.join(",");
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  const lift = Math.max(0, -p.y),
    poolWidth = 86 + lift * 1.5,
    poolPower = Math.min(1, p.light * 0.72 * personality.glow);
  ctx.save();
  ctx.translate(p.x * 0.25, 106);
  ctx.scale(1, 0.24);
  const pool = ctx.createRadialGradient(0, 0, 0, 0, 0, poolWidth);
  pool.addColorStop(0, "rgba(" + rgb + "," + 0.62 * poolPower + ")");
  pool.addColorStop(0.27, "rgba(" + rgb + "," + 0.42 * poolPower + ")");
  pool.addColorStop(0.64, "rgba(" + rgb + "," + 0.18 * poolPower + ")");
  pool.addColorStop(1, "rgba(" + rgb + ",0)");
  ctx.fillStyle = pool;
  ctx.fillRect(-poolWidth, -poolWidth, poolWidth * 2, poolWidth * 2);
  ctx.restore();
  ctx.translate(p.x, p.y + 70);
  ctx.rotate(p.r);
  ctx.scale(p.sx, p.sy);
  ctx.translate(0, -70);
  path(ctx, shell);
  let g = ctx.createLinearGradient(-92, -85, 100, 91);
  g.addColorStop(0, "#79808c");
  g.addColorStop(0.12, "#454c57");
  g.addColorStop(0.34, "#2c323d");
  g.addColorStop(0.68, "#171c24");
  g.addColorStop(0.91, "#313946");
  g.addColorStop(1, "#171c24");
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = "#788192";
  ctx.lineWidth = 0.65;
  ctx.stroke();
  path(ctx, [
    ["M", 85, -71],
    ["C", 101, -58, 109, -11, 108, 22],
    ["C", 109, 58, 97, 78, 71, 86],
    ["C", 91, 58, 95, 1, 83, -32],
    ["C", 80, -51, 84, -63, 85, -71],
    ["Z"],
  ]);
  g = ctx.createLinearGradient(75, 0, 110, 0);
  g.addColorStop(0, "rgba(38,46,62,.2)");
  g.addColorStop(0.65, "rgba(" + rgb + ",.3)");
  g.addColorStop(1, "rgba(" + rgb + ",.6)");
  ctx.fillStyle = g;
  ctx.fill();
  path(ctx, face);
  g = ctx.createLinearGradient(-50, -67, 47, 58);
  g.addColorStop(0, "#222b36");
  g.addColorStop(0.31, "#0b1017");
  g.addColorStop(0.7, "#04070b");
  g.addColorStop(1, "#101720");
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#10151d";
  ctx.stroke();
  ctx.lineWidth = 0.7;
  ctx.strokeStyle = "#788293";
  ctx.stroke();
  ctx.save();
  path(ctx, face);
  ctx.clip();
  g = ctx.createLinearGradient(-80, -60, -15, 14);
  g.addColorStop(0, "rgba(236,245,255,.25)");
  g.addColorStop(0.4, "rgba(236,245,255,.025)");
  g.addColorStop(1, "rgba(236,245,255,0)");
  ctx.fillStyle = g;
  path(ctx, [
    ["M", -100, -60],
    ["Q", -15, -105, 88, -43],
    ["Q", -43, -63, -95, 20],
    ["Z"],
  ]);
  ctx.fill();
  ctx.restore();
  ctx.save();
  path(ctx, belt);
  ctx.strokeStyle = palette.glow;
  ctx.lineWidth = 16;
  ctx.globalAlpha = clamp(0.25 * p.light * personality.glow);
  ctx.shadowColor = palette.glow;
  ctx.shadowBlur = 32 * p.light * personality.glow;
  ctx.stroke();
  ctx.restore();
  path(ctx, belt);
  ctx.strokeStyle = palette.beltDeep;
  ctx.lineWidth = 9;
  ctx.stroke();
  path(ctx, belt);
  g = ctx.createLinearGradient(-90, 0, 104, 0);
  g.addColorStop(0, palette.beltDark);
  g.addColorStop(0.4, palette.glow);
  g.addColorStop(0.72, palette.glow);
  g.addColorStop(1, palette.beltLight);
  ctx.strokeStyle = g;
  ctx.lineWidth = 4;
  ctx.globalAlpha = clamp(p.light * personality.glow);
  ctx.shadowColor = palette.glow;
  ctx.shadowBlur = 24 * p.light;
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
  if (p.think) {
    ctx.save();
    path(ctx, belt);
    ctx.lineWidth = 3;
    const phase = (t * 0.38) % 1,
      cx = -115 + phase * 250;
    g = ctx.createLinearGradient(cx - 30, 0, cx + 30, 0);
    g.addColorStop(0, "rgba(" + rgb + ",0)");
    g.addColorStop(0.5, palette.beltHighlight);
    g.addColorStop(1, "rgba(" + rgb + ",0)");
    ctx.strokeStyle = g;
    ctx.shadowColor = palette.glow;
    ctx.shadowBlur = 10;
    ctx.stroke();
    ctx.restore();
  }
  ctx.save();
  ctx.translate(p.ex, p.ey);
  ctx.rotate(-0.075);
  for (const ex of [-37, 30]) {
    const ey = ex < 0 ? -7 : -9,
      glowPower =
        Math.min(1.2, (0.48 + p.light * 0.35) * personality.glow) *
        Math.max(0.15, p.eye);
    const bloom = ctx.createRadialGradient(ex, ey, 2, ex, ey, 34);
    bloom.addColorStop(0, "rgba(" + bloomRgb + "," + 0.28 * glowPower + ")");
    bloom.addColorStop(0.36, "rgba(" + bloomRgb + "," + 0.16 * glowPower + ")");
    bloom.addColorStop(1, "rgba(" + bloomRgb + ",0)");
    ctx.fillStyle = bloom;
    ctx.fillRect(ex - 34, ey - 34, 68, 68);
  }
  ctx.fillStyle = "#fff9e9";
  ctx.strokeStyle = "#fff9e9";
  ctx.lineCap = "round";
  ctx.shadowColor = "rgba(" + bloomRgb + ",.9)";
  ctx.shadowBlur = 22 * personality.glow;
  for (let i = 0; i < 2; i++) {
    const ex = i === 0 ? -37 : 30,
      ey = i === 0 ? -7 : -9;
    const openness = Math.max(0.055, p.eye * (i === 0 ? p.lEye : p.rEye));
    if (p.happy > 0.25) {
      ctx.beginPath();
      ctx.moveTo(ex - 10, ey + 4);
      ctx.quadraticCurveTo(ex, ey - 12 * p.happy, ex + 10, ey + 4);
      ctx.lineWidth = 5;
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.ellipse(ex, ey, 9, 18 * openness, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.shadowBlur = 5;
  ctx.beginPath();
  ctx.moveTo(-16, 24);
  ctx.quadraticCurveTo(-1, 24 + 13 * p.smile, 13, 22);
  ctx.lineWidth = 3.4;
  ctx.stroke();
  ctx.restore();
  ctx.restore();
}

export function drawMono(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  mood: MonoMood,
  t: number,
  blinkAge: number,
  palette: MonoPalette,
): void {
  paintMono(
    ctx,
    width * 0.49,
    height * 0.44,
    Math.min(width / 255, height / 270),
    pose(t, mood, blinkAge),
    t,
    palette,
  );
}
