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

  it("forces the light palette inside the print root regardless of the active theme", () => {
    const printRoot = print.match(/\[data-print-root\]\s*\{[^}]*\}/)?.[0] ?? "";
    expect(printRoot).not.toBe("");
    for (const token of [
      "--background",
      "--surface",
      "--surface-muted",
      "--surface-sunken",
      "--foreground",
      "--muted-foreground",
      "--kicker",
      "--border",
      "--border-hover",
      "--border-bright",
      "--card",
      "--primary",
      "--brand",
    ]) {
      expect(printRoot).toContain(`${token}:`);
    }
    expect(printRoot).toMatch(/color-scheme:\s*light/);
    expect(printRoot).toMatch(/-webkit-print-color-adjust:\s*exact/);
    expect(printRoot).toMatch(/(?<!-webkit-)print-color-adjust:\s*exact/);
  });

  it("prints the folder title above the print root", () => {
    const titleBlock =
      print.match(/\[data-print-title\]\s*\{[^}]*\}/)?.[0] ?? "";
    expect(titleBlock).not.toBe("");
    expect(titleBlock).toMatch(/display:\s*block/);
    expect(titleBlock).toMatch(/position:\s*absolute/);
    expect(print).toMatch(
      /\[data-print-title\],\s*\[data-print-title\]\s*\*\s*\{[^}]*visibility:\s*visible/,
    );
  });
});
