"use client";

import type { ReactNode } from "react";
import type { LayoutSection } from "@/lib/validations/folder-layout";

/**
 * The Overview canvas: a 12-column CSS Grid at `lg`, one stacked column below.
 *
 * Explicit COLUMN placement with automatic rows is what reproduces today's
 * layout exactly — an 8-span followed by two 4-spans puts the second 4-span in
 * the right-hand column of the NEXT row (Intelligence above Next milestones),
 * while row heights stay content-sized. Absolutely-positioned react-grid-layout
 * would have fixed the row heights and broken the small-screen stack; `y`/`h`
 * are carried in the config for spec 2's widget canvas, not read here.
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
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      {sections.map((s) => (
        <div
          key={s.id}
          data-testid="section-cell"
          data-section-id={s.id}
          className="min-w-0 lg:[grid-column:var(--col)]"
          style={
            {
              "--col": `${s.layout.x + 1} / span ${s.layout.w}`,
            } as React.CSSProperties
          }
        >
          {render(s)}
        </div>
      ))}
    </div>
  );
}
