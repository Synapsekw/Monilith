import { expect, test } from "@playwright/test";

test("home renders the welcome shell", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Welcome to Pulse" }),
  ).toBeVisible();
});

test("command palette opens via keyboard shortcut", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("ControlOrMeta+k");
  await expect(
    page.getByPlaceholder("Type a command or search…"),
  ).toBeVisible();
});
