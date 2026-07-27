import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { reachable } from "@/test/static-imports";

const SRC = join(process.cwd(), "src");
const ENTRY = join(SRC, "components/dashboards/DashboardWidget.tsx");
const CHART_WIDGET = join(SRC, "components/dashboards/widgets/ChartWidget.tsx");

describe("dashboard first-paint bundle boundary", () => {
  const { files, bare } = reachable(ENTRY);

  it("does not statically reach ChartWidget from DashboardWidget", () => {
    expect(files.has(CHART_WIDGET)).toBe(false);
  });

  it("does not statically reach recharts from DashboardWidget", () => {
    expect(bare.has("recharts")).toBe(false);
  });
});
