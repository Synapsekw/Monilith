import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  // `offline.spec.ts` runs from `playwright.offline.config.ts` (`pnpm e2e:offline`)
  // against a PRODUCTION build. It cannot pass here: `next dev` serves documents
  // without `no-store`, so an offline reload is answered from the browser's HTTP
  // cache, the navigation never fails, and the service worker's fallback — the
  // entire feature — is never reached.
  testIgnore: /offline\.spec\.ts$/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000",
    // Deliberately NOT `!process.env.CI`. Reusing whatever happens to answer on
    // :3000 silently tests a DIFFERENT checkout: every task worktree shares this
    // port, so a dev server left running from `develop` (or another task branch)
    // is picked up without a word and the suite reports on code that is not the
    // code under test. That is not theoretical — it was hit on this branch, where
    // the main checkout's server answers 404 for `/sw.js` and would have made the
    // whole offline feature look broken. Failing loudly on a busy port is the
    // cheaper outcome; start the suite with :3000 free.
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
