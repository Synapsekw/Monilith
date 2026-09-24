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
  const groups = groupSections(sections);
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      {groups.map((g) => (
        <div
          key={g.sections[0]!.id}
          data-testid="section-group"
          className="flex min-w-0 flex-col gap-4 lg:[grid-column:var(--col)]"
          style={
            {
              "--col": `${g.x + 1} / span ${g.w}`,
            } as React.CSSProperties
          }
        >
          {g.sections.map((s) => (
            // Each section keeps its own wrapper so Customize mode's
            // `SectionChrome` still wraps one section at a time, and
            // `data-section-id` still resolves every section individually.
            <div
              key={s.id}
              data-testid="section-cell"
              data-section-id={s.id}
              className="min-w-0"
            >
              {render(s)}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
