import { expect, test } from "@playwright/test";

test("unauthenticated visit to / shows the MONOLITH landing linking to /login", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/$/);

  const hero = page.getByRole("link", { name: "MONOLITH" });
  await expect(hero).toBeVisible();
  await expect(hero).toHaveAttribute("href", "/login");

  await hero.click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText("Welcome back")).toBeVisible();
});

test("unauthenticated visit to /landing shows the splash (proxy lets it through)", async ({
  page,
}) => {
  await page.goto("/landing");
  await expect(page).toHaveURL(/\/landing$/);

  const hero = page.getByRole("link", { name: "MONOLITH" });
  await expect(hero).toBeVisible();
  await expect(hero).toHaveAttribute("href", "/login");
});

test("/login shows the sign-in form", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByText("Welcome back")).toBeVisible();
  await expect(page.getByLabel(/email/i)).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
  await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
});

test("/signup shows the create-account form", async ({ page }) => {
  await page.goto("/signup");
  await expect(page.getByText("Create your account")).toBeVisible();
  await expect(page.getByLabel(/full name/i)).toBeVisible();
  await expect(page.getByLabel(/email/i)).toBeVisible();
  await expect(
    page.getByRole("button", { name: /create account/i }),
  ).toBeVisible();
});
