"use client";

import type { ReactNode } from "react";
import type { LayoutSection } from "@/lib/validations/folder-layout";

/** A run of consecutive sections that share one grid cell. */
type Group = { x: number; w: number; sections: LayoutSection[] };

/**
 * Splits `sections` into the grid cells they occupy, preserving config order.
 *
 * A cell holds a RUN of consecutive sections with the same `x` AND the same
 * `w` — that is exactly today's right-hand column (Intelligence stacked above
 * Next milestones), which the pre-branch markup wrote by hand as
 * `<div className="flex flex-col gap-4">`. Rendering them as separate grid
 * items instead would let CSS auto-placement drop Next milestones into the row
 * BELOW Needs attention, leaving a hole the height of the attention panel
 * (measured: a 16px gap became 496px).
 *
 * A full-width section (`w === 12`) always stands alone: it starts its own row,
 * so stacking it with the next same-`x` section would pull that section up out
 * of its row.
 */
export function groupSections(sections: LayoutSection[]): Group[] {
  const groups: Group[] = [];
  for (const s of sections) {
    const { x, w } = s.layout;
    const last = groups[groups.length - 1];
    const joins =
      last !== undefined && last.x === x && last.w === w && w !== 12;
    if (joins) last.sections.push(s);
    else groups.push({ x, w, sections: [s] });
  }
  return groups;
}

/** Nothing to draw: what a `render` callback returns for an absent section. */
function isEmpty(node: ReactNode): boolean {
  return node === null || node === undefined || node === false;
}

/**
 * Render-time fill rule (2026-11-14 browser fix). A section that renders
 * nothing (load while its read is skipped, Intelligence with no briefs)
 * used to leave its grid cell empty, so its row showed a blank gap. The saved
 * config is NOT rewritten; only this render's placement changes:
 *   - a cell whose sections all render nothing is dropped;
 *   - a ROW is a run of cells laid left to right (a cell starts a new row when
 *     it is full width, follows a full-width cell, or does not start right of
 *     the previous cell);
 *   - in a row that lost a cell, each surviving cell stretches to the next
 *     survivor's start (the last one to the row's end, the first one from the
 *     row's start), so neighbours fill the row;
 *   - a row with every cell present keeps its saved columns exactly.
 * Note: a lazily loaded neighbour that appears later (e.g. load rows arriving)
 * shrinks its row-mate back to the saved width on that re-render.
 */
export function fillRows<T extends { x: number; w: number }>(
  cells: { cell: T; present: boolean }[],
): T[] {
  const rows: { cell: T; present: boolean }[][] = [];
  for (const c of cells) {
    const row = rows[rows.length - 1];
    const prev = row?.[row.length - 1]?.cell;
    const starts =
      prev === undefined ||
      c.cell.w === 12 ||
      prev.w === 12 ||
      c.cell.x < prev.x + prev.w;
    if (starts) rows.push([c]);
    else row!.push(c);
  }
  const out: T[] = [];
  for (const row of rows) {
    const kept = row.filter((c) => c.present).map((c) => c.cell);
    if (kept.length === row.length) {
      out.push(...kept);
      continue;
    }
    const lo = Math.min(...row.map((c) => c.cell.x));
    const hi = Math.max(...row.map((c) => c.cell.x + c.cell.w));
    kept.forEach((cell, i) => {
      const x = i === 0 ? lo : cell.x;
      const end = i === kept.length - 1 ? hi : kept[i + 1]!.x;
      out.push({ ...cell, x, w: end - x });
    });
  }
  return out;
}

/**
 * The Overview canvas: a 12-column CSS Grid at `lg`, one stacked column below.
 *
 * Explicit COLUMN placement with automatic rows is what reproduces today's
 * layout exactly — an 8-span followed by a 4-span puts the 4-span in the
 * right-hand column of the same row, while row heights stay content-sized.
 * Absolutely-positioned react-grid-layout would have fixed the row heights and
 * broken the small-screen stack; `y`/`h` are carried in the config for spec 2's
 * widget canvas, not read here. Vertical neighbours in one column come from
 * `groupSections` above, not from auto-placement.
 *
 * The column is passed as a CSS custom property so the placement can be
 * responsive — inline styles cannot carry a media query, Tailwind arbitrary
 * properties can.
 */
export function SectionGrid({
  sections,
  render,
}: {
  sections: LayoutSection[];
  render: (section: LayoutSection) => ReactNode;
}) {
  if (sections.length === 0) return null;
  // Render first, so a section that draws nothing can give its space away.
  const cells = groupSections(sections).map((g) => {
    const drawn = g.sections
      .map((s) => ({ s, node: render(s) }))
      .filter((d) => !isEmpty(d.node));
    return { cell: { ...g, drawn }, present: drawn.length > 0 };
  });
  const groups = fillRows(cells);
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      {groups.map((g) => (
        <div
          key={g.sections[0]!.id}
          data-testid="section-group"
          data-section-ids={g.drawn.map((d) => d.s.id).join(" ")}
          className="flex min-w-0 flex-col gap-4 lg:[grid-column:var(--col)]"
          style={
            {
              "--col": `${g.x + 1} / span ${g.w}`,
            } as React.CSSProperties
          }
        >
          {g.drawn.map(({ s, node }) => (
            // Each section keeps its own wrapper so Customize mode's
            // `SectionChrome` still wraps one section at a time, and
            // `data-section-id` still resolves every section individually.
            <div
              key={s.id}
              data-testid="section-cell"
              data-section-id={s.id}
              className="min-w-0"
            >
              {node}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
