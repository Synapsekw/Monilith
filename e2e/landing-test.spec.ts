/**
 * e2e: /landing-test mono reveal smoke tests
 *
 * Two cases:
 *   1. The hero renders (MONOLITH + subtitle visible) with no console errors.
 *   2. Under `prefers-reduced-motion: reduce` the subtitle is visible immediately
 *      (CSS final state, no JS animation needed).
 *
 * `/landing-test` is a public route (no auth required). No Supabase secrets needed.
 */

import { expect, test } from "@playwright/test";

test.describe("/landing-test mono reveal", () => {
  test("renders the hero with no console errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

    await page.goto("/landing-test");

    await expect(page.getByText("MONOLITH")).toBeVisible();
    await expect(page.getByText("The only work surface you need.")).toBeVisible(
      { timeout: 6_000 },
    );

    expect(errors).toEqual([]);
  });

  test("shows the subtitle immediately under reduced motion", async ({
    browser,
  }) => {
    const ctx = await browser.newContext({ reducedMotion: "reduce" });
    const page = await ctx.newPage();

    await page.goto("/landing-test");

    await expect(
      page.getByText("The only work surface you need."),
    ).toBeVisible();

    await ctx.close();
  });
});
