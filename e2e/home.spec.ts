import { expect, test } from "@playwright/test";

test("unauthenticated / shows the landing with Log in + Sign up entry points", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/$/);

  await expect(page.getByText("MONOLITH")).toBeVisible();
  await expect(page.getByRole("link", { name: "Log in" })).toHaveAttribute(
    "href",
    "/login",
  );
  await expect(page.getByRole("link", { name: "Sign up" })).toHaveAttribute(
    "href",
    "/signup",
  );
  await expect(page.getByRole("link", { name: "Get started" })).toHaveAttribute(
    "href",
    "/signup",
  );
  await expect(page.getByRole("link", { name: "Sign in" })).toHaveAttribute(
    "href",
    "/login",
  );

  await page.getByRole("link", { name: "Get started" }).click();
  await expect(page).toHaveURL(/\/signup$/);
  await expect(page.getByText("Create your account")).toBeVisible();
});

test("landing Log in navigates to the sign-in form", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText("Welcome back")).toBeVisible();
});

test("unauthenticated /landing shows the splash entry points (proxy lets it through)", async ({
  page,
}) => {
  await page.goto("/landing");
  await expect(page).toHaveURL(/\/landing$/);
  await expect(page.getByText("MONOLITH")).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign up" })).toHaveAttribute(
    "href",
    "/signup",
  );
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
