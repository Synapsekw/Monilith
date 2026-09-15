import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
const print = css.split("@media print")[1] ?? "";

describe("print stylesheet (folder Overview export)", () => {
  it("exists and isolates the print root", () => {
    expect(print).toContain("[data-print-root]");
    expect(print).toMatch(/\[data-print-hide\][^}]*display:\s*none/);
  });
  it("hides the app chrome and keeps charts visible", () => {
    expect(print).toMatch(/aside|nav/);
    expect(print).toMatch(
      /\.recharts-surface[^}]*visibility:\s*visible|\[data-print-root\]\s*\*[^}]*visibility:\s*visible/,
    );
  });
});
