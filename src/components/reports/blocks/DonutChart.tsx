// src/components/reports/blocks/DonutChart.tsx
// Pure SVG. No hooks, no refs, no ids, no measurement — see ChartBlock.parity.test.tsx.
import type { ChartCategory } from "@/lib/reports/chart-data";

const SIZE = 168;
const C = SIZE / 2;
const R_OUT = 76;
const R_IN = 47; // 0.62 ring ratio
const GAP_PX = 2; // the dataviz "surface gap", as an ANGULAR shortening (not a stroke)

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

const f = (n: number) => n.toFixed(3);

/** One ring segment as a closed path: outer arc → inner arc back. */
function segmentPath(startDeg: number, endDeg: number): string {
  const large = endDeg - startDeg > 180 ? 1 : 0;
  const o1 = polar(C, C, R_OUT, startDeg);
  const o2 = polar(C, C, R_OUT, endDeg);
  const i2 = polar(C, C, R_IN, endDeg);
  const i1 = polar(C, C, R_IN, startDeg);
  return [
    `M ${f(o1.x)} ${f(o1.y)}`,
    `A ${R_OUT} ${R_OUT} 0 ${large} 1 ${f(o2.x)} ${f(o2.y)}`,
    `L ${f(i2.x)} ${f(i2.y)}`,
    `A ${R_IN} ${R_IN} 0 ${large} 0 ${f(i1.x)} ${f(i1.y)}`,
    "Z",
  ].join(" ");
}

export function DonutChart({
  categories,
  total,
}: {
  categories: ChartCategory[];
  total: number;
}) {
  const sum = categories.reduce((n, c) => n + c.value, 0) || 1;
  // A 2px gap at the ring's mid-radius, expressed in degrees.
  const gapDeg = (GAP_PX / (((R_OUT + R_IN) / 2) * Math.PI * 2)) * 360;
  // A plain loop, not `.map` with a running cursor: the react-hooks/immutability
  // rule forbids reassigning a local from inside a render closure.
  const paths: { key: string; color: string; d: string }[] = [];
  let cursor = 0;
  for (const c of categories) {
    const sweep = (c.value / sum) * 360;
    const start = cursor + gapDeg / 2;
    const end = cursor + sweep - gapDeg / 2;
    cursor += sweep;
    paths.push({
      key: c.key,
      color: c.color,
      d: segmentPath(start, Math.max(start + 0.01, end)),
    });
  }

  return (
    <svg
      className="r-chart-ring"
      width={SIZE}
      height={SIZE}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      role="img"
      aria-label={`Donut chart, ${total} items`}
    >
      {paths.map((p) => (
        <path key={p.key} d={p.d} fill={p.color} />
      ))}
      <text className="r-chart-total" x={C} y={C - 1} textAnchor="middle">
        {total}
      </text>
      <text className="r-chart-total-l" x={C} y={C + 15} textAnchor="middle">
        ITEMS
      </text>
    </svg>
  );
}
