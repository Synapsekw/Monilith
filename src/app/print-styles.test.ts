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

  it("scopes every hiding rule to a page that HAS a print root", () => {
    // Regression guard: these rules were global, so printing any other page in
    // the app hid its chrome and blanked every element. Both the chrome-hiding
    // rule and the blanket `visibility: hidden` must sit behind
    // `body:has([data-print-root])`.
    expect(print).toMatch(
      /body:has\(\[data-print-root\]\)\s+aside[^{]*\{[^}]*display:\s*none/,
    );
    expect(print).toMatch(
      /body:has\(\[data-print-root\]\)\s+\*\s*\{[^}]*visibility:\s*hidden/,
    );
    // No UNSCOPED `body * { visibility: hidden }` / bare `aside,` selector.
    expect(print).not.toMatch(/(^|[^)])\s\bbody\s+\*\s*\{/);
    expect(print).not.toMatch(/\n\s*aside,/);
  });

  it("lets the print root paginate instead of pinning it to one page", () => {
    // `position: absolute; inset: 0` clipped a multi-page Overview to a single
    // sheet. The root must be positioned with an auto bottom and height.
    const printRoot = print.match(/\[data-print-root\]\s*\{[^}]*\}/)?.[0] ?? "";
    expect(printRoot).toMatch(/position:\s*absolute/);
    expect(printRoot).toMatch(/top:\s*26mm/);
    expect(printRoot).toMatch(/bottom:\s*auto/);
    expect(printRoot).toMatch(/height:\s*auto/);
    // A declaration, not the prose in the comment above it.
    expect(printRoot).not.toMatch(/inset:\s*0\s*;/);
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
