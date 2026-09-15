import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { reachable } from "@/test/static-imports";

const SRC = join(process.cwd(), "src");
const ENTRY = join(SRC, "components/folders/CommandCenter.tsx");
const INNER = join(SRC, "components/folders/charts/BurnChartInner.tsx");

describe("command center first-paint bundle boundary", () => {
  const { files, bare } = reachable(ENTRY);
  it("does not statically reach BurnChartInner from CommandCenter", () => {
    expect(files.has(INNER)).toBe(false);
  });
  it("does not statically reach recharts from CommandCenter", () => {
    expect(bare.has("recharts")).toBe(false);
  });
});
