import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { reachable } from "@/test/static-imports";

const SRC = join(process.cwd(), "src");
const DOCUMENT = join(SRC, "components/reports/ReportDocument.tsx");
const UI_CHART = join(SRC, "components/ui/chart.tsx");

/**
 * The report document is rendered by `renderToStaticMarkup` in a server action
 * and loaded into headless Chromium with `page.setContent` — a page that runs
 * NO client JavaScript. recharts 3.x renders an empty wrapper div there (it
 * builds its geometry in effects/layout hooks), and `@/components/ui/chart` is
 * a "use client" module. Either import would produce a PDF with blank boxes
 * where the charts should be, while the live preview iframe looked correct.
 *
 * Charts on this surface are hand-rolled static SVG/CSS. This test is the fence.
 */
describe("report render-surface boundary", () => {
  const { files, bare } = reachable(DOCUMENT);

  it("does not statically reach recharts from ReportDocument", () => {
    expect(bare.has("recharts")).toBe(false);
  });

  it("does not statically reach the client ChartContainer from ReportDocument", () => {
    expect(files.has(UI_CHART)).toBe(false);
  });

  it("reaches the hand-rolled chart block (the walker is actually traversing)", () => {
    expect(
      files.has(join(SRC, "components/reports/blocks/ChartBlock.tsx")),
    ).toBe(true);
    expect(
      files.has(join(SRC, "components/reports/blocks/DonutChart.tsx")),
    ).toBe(true);
  });
});
