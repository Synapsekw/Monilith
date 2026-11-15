import type { StatusColor } from "@/components/ui/status-pill";

const W = 84;
const H = 28;
const PAD = 3;

/** A tiny trend mark for a KPI card: plain SVG, no chart library, so it costs
 *  nothing on first paint. Colour comes from the status token; `label` is the
 *  text alternative and should state the series in words. */
export function Sparkline({
  points,
  kind = "line",
  color,
  label,
}: {
  points: number[];
  kind?: "line" | "bars";
  color: StatusColor;
  label: string;
}) {
  if (points.length < 2) return null;
  const min = Math.min(...points, kind === "bars" ? 0 : Infinity);
  const max = Math.max(...points);
  const span = max - min || 1;
  const y = (v: number) => H - PAD - ((v - min) / span) * (H - 2 * PAD);
  const style = { color: `var(--status-${color})` };
  if (kind === "bars") {
    const bw = (W - 2 * PAD) / points.length;
    return (
      <svg
        role="img"
        aria-label={label}
        viewBox={`0 0 ${W} ${H}`}
        className="h-7 w-[5.25rem] shrink-0"
        style={style}
      >
        {points.map((v, i) => (
          <rect
            key={i}
            x={PAD + i * bw + 1}
            y={y(v)}
            width={Math.max(1, bw - 2)}
            height={Math.max(1, H - PAD - y(v))}
            rx={1}
            fill="currentColor"
            opacity={i === 0 ? 1 : 0.45}
          />
        ))}
      </svg>
    );
  }
  const x = (i: number) => PAD + (i / (points.length - 1)) * (W - 2 * PAD);
  const last = points.length - 1;
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${W} ${H}`}
      className="h-7 w-[5.25rem] shrink-0"
      style={style}
    >
      <polyline
        points={points.map((v, i) => `${x(i)},${y(v)}`).join(" ")}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={x(last)} cy={y(points[last]!)} r={2.6} fill="currentColor" />
    </svg>
  );
}
