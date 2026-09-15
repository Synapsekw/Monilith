/**
 * e2e: Folder Overview print stylesheet — the `@media print` block in
 * `src/app/globals.css` that Export PDF relies on.
 *
 * This does NOT drive the running app (no `page.goto`, no auth): it inlines
 * the actual `@media print` block from `globals.css` into a static HTML
 * harness and asserts computed `visibility`/`display` under
 * `page.emulateMedia({ media: "print" })`. That's deliberate — a regex
 * test (`src/app/print-styles.test.ts`) can check the CSS text shape, but
 * only a real Chromium layout/cascade engine catches a specificity bug like
 * the one this guards: `body:has([data-print-root]) * { visibility: hidden }`
 * has specificity (0,1,1), which OUTRANKS the re-visibility rules
 * `[data-print-root], [data-print-root] *` and `[data-print-title],
 * [data-print-title] *` at (0,1,0) — so the print root and title computed to
 * `hidden` and Export PDF produced a blank page. The fix wraps the scoping
 * condition in `:where(...)` (zero specificity) so the plain-attribute
 * re-visibility rules win again.
 *
 * No SUPABASE_SERVICE_ROLE_KEY / dev server required — safe to run anywhere.
 */

import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const css = readFileSync("src/app/globals.css", "utf8");
const printBlockMatch = css.match(/@media print \{[\s\S]*\n\}\n/);
if (!printBlockMatch) {
  throw new Error("Could not extract @media print block from globals.css");
}
const printBlock = printBlockMatch[0];

function harnessHtml(includePrintRoot: boolean): string {
  return `<!doctype html>
<html>
<head>
<style>
${printBlock}
</style>
</head>
<body>
  <aside>aside content</aside>
  <nav>nav content</nav>
  <header>header content</header>
  <p data-print-title>Folder Title</p>
  <p class="unrelated">unrelated paragraph</p>
  ${
    includePrintRoot
      ? `<div data-print-root>
    <p>root paragraph</p>
    <svg><text>chart label</text></svg>
  </div>`
      : ""
  }
</body>
</html>`;
}

test.describe("print stylesheet (folder Overview export)", () => {
  test("prints the title, root, nested content and charts; hides chrome", async ({
    page,
  }) => {
    await page.emulateMedia({ media: "print" });
    await page.setContent(harnessHtml(true));

    const visibility = (selector: string) =>
      page.locator(selector).evaluate((el) => getComputedStyle(el).visibility);
    const display = (selector: string) =>
      page.locator(selector).evaluate((el) => getComputedStyle(el).display);

    await expect.poll(() => visibility("[data-print-title]")).toBe("visible");
    await expect.poll(() => visibility("[data-print-root]")).toBe("visible");
    await expect.poll(() => visibility("[data-print-root] p")).toBe("visible");
    await expect
      .poll(() => visibility("[data-print-root] svg text"))
      .toBe("visible");

    await expect.poll(() => visibility("aside")).toBe("hidden");
    await expect.poll(() => visibility("nav")).toBe("hidden");
    await expect.poll(() => visibility(".unrelated")).toBe("hidden");
    await expect.poll(() => display("aside")).toBe("none");
    await expect.poll(() => display("nav")).toBe("none");
  });

  test("leaves an ordinary page (no print root) untouched", async ({
    page,
  }) => {
    await page.emulateMedia({ media: "print" });
    await page.setContent(harnessHtml(false));

    const visibility = (selector: string) =>
      page.locator(selector).evaluate((el) => getComputedStyle(el).visibility);
    const display = (selector: string) =>
      page.locator(selector).evaluate((el) => getComputedStyle(el).display);

    await expect.poll(() => visibility("aside")).toBe("visible");
    await expect.poll(() => visibility("nav")).toBe("visible");
    await expect.poll(() => visibility(".unrelated")).toBe("visible");
    await expect.poll(() => display("aside")).toBe("block");
    await expect.poll(() => display("nav")).toBe("block");
  });
});
