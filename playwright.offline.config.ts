import { defineConfig, devices } from "@playwright/test";

/**
 * Offline acceptance runs against a PRODUCTION BUILD, not `next dev`.
 *
 * This is not a preference — the behaviour under test does not exist in dev.
 * `next dev` serves documents with `Cache-Control: no-cache, must-revalidate`
 * (storable), so an offline reload is answered from Chromium's HTTP cache and
 * the navigation never fails. The service worker's whole job is to answer a
 * navigation that FAILED, so its fallback is never reached and the offline
 * shell is never exercised. `next start` sends
 * `private, no-cache, no-store, max-age=0, must-revalidate` — `no-store` means
 * the document is never written to the HTTP cache, the offline navigation
 * genuinely fails, and the worker takes over. Verified by measurement on both.
 *
 * Service workers, precaching and content-hashed immutable assets are all
 * production semantics; dev chunk URLs are not even stable between compiles.
 *
 * Port 3001, not 3000, so this never collides with a dev server someone already
 * has running — and `reuseExistingServer` is OFF so it can never silently test
 * one either (see the note in `playwright.config.ts`).
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: /offline\.spec\.ts$/,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3001",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm build && pnpm start -p 3001",
    url: "http://localhost:3001",
    reuseExistingServer: false,
    // A production build from cold, then boot.
    timeout: 300_000,
  },
});
