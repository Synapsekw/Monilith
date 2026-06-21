import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const sharedExclude = ["e2e/**", "node_modules/**", ".next/**"];

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    // Runs once after the whole run: purges leaked @example.com cloud test
    // data provisioned by *.integration.test.ts suites. See
    // src/test/global-teardown.ts (exports a named `teardown`).
    globalSetup: ["./src/test/global-teardown.ts"],
    globals: true,
    // Two projects (both inherit the options above via `extends: true`):
    //   - unit: fast, parallel, everything except the integration suites.
    //   - integration: the *.integration.test.ts suites, which hit the live
    //     cloud Supabase project. Run serially — concurrent files collectively
    //     trip GoTrue's auth rate limit (429 over_request_rate_limit), which
    //     surfaces either loudly or silently as a null org from
    //     create_organization. Pairs with signInWithRetry() in
    //     src/test/integration-auth.ts.
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["src/**/*.{test,spec}.{ts,tsx}"],
          exclude: [...sharedExclude, "src/**/*.integration.test.{ts,tsx}"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["src/**/*.integration.test.{ts,tsx}"],
          exclude: sharedExclude,
          fileParallelism: false,
        },
      },
    ],
  },
  resolve: {
    alias: {
      "@": resolve(process.cwd(), "src"),
      // `server-only` is a Next.js build-time guard, unresolvable under Vitest.
      // Stub it so tests that pull a guarded module (e.g. `@/lib/boards/queries`,
      // typically only for its types) can load. See vitest.server-only-stub.ts.
      "server-only": resolve(process.cwd(), "vitest.server-only-stub.ts"),
    },
  },
});
