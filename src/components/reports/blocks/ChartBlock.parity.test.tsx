import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { render } from "@testing-library/react";
import { ChartBlock } from "@/components/reports/blocks/ChartBlock";
import type { ChartSeries } from "@/lib/reports/chart-data";
import type { ChartBlockOptions } from "@/lib/reports/config";

const OPTS: ChartBlockOptions = {
  variant: "donut",
  source: "status",
  columnId: null,
  title: "",
  maxCategories: 6,
  boardScope: { mode: "all" },
};

const SERIES: ChartSeries = {
  categories: [
    { key: "a", label: "Done", value: 12, color: "#5866c4" },
    { key: "b", label: "Working on it", value: 7, color: "#eb6834" },
    { key: "c", label: "Stuck", value: 3, color: "#e34948" },
  ],
  total: 22,
  categoryName: "Status",
  empty: false,
};

/**
 * Canonicalise the ONE thing that differs between the two renderers for a
 * reason that provably cannot affect rendering: inline-style serialisation.
 *
 * `renderToStaticMarkup` writes the style attribute exactly as React composed
 * it (`style="background:#5866c4"`). A client render instead assigns through
 * the CSSOM, which re-serialises the attribute (`style="background: rgb(88,
 * 102, 196);"`). Both parse to the identical computed style — and the PDF path
 * hands its server string to `page.setContent`, i.e. to that same CSSOM — so
 * the two surfaces still paint the same pixels. Inline styles are unavoidable
 * here: the bar fill's width IS the data.
 *
 * The transform is applied to BOTH sides, so everything the test exists to
 * catch — element structure, class names, attribute order, whitespace, and any
 * generated id — is still compared byte-for-byte and still fatal.
 */
function canonical(html: string): string {
  const host = document.createElement("div");
  host.innerHTML = html;
  host.querySelectorAll("[style]").forEach((node) => {
    const el = node as HTMLElement;
    el.setAttribute("style", el.style.cssText);
  });
  return host.innerHTML;
}

/**
 * The one-render-surface guarantee, as an executable assertion.
 *
 * The PDF path renders this component with renderToStaticMarkup in a Node
 * server action (no DOM, no client JS); PreviewPane renders the same component
 * into a live React root in an iframe. If those two ever diverge, the exported
 * PDF stops matching what the user approved on screen. This test is the reason
 * the chart components may not use hooks, refs, ids or measurement.
 */
describe("ChartBlock — preview/PDF parity", () => {
  for (const variant of ["donut", "bars"] as const) {
    it(`${variant}: client markup is identical to server markup`, () => {
      const options = { ...OPTS, variant };
      const server = renderToStaticMarkup(
        <ChartBlock series={SERIES} options={options} />,
      );
      const { container } = render(
        <ChartBlock series={SERIES} options={options} />,
      );
      expect(canonical(container.innerHTML)).toBe(canonical(server));
    });
  }
});
