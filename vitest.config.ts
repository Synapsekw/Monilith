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
          // `.claude/hooks/**` covers the Claude Code hook scripts (plain
          // node .mjs with exported pure functions) so they run in the same
          // `pnpm test` gate as src. Anchored at the repo root on purpose —
          // it does not reach into `.claude/worktrees/*` copies.
          include: [
            "src/**/*.{test,spec}.{ts,tsx}",
            ".claude/hooks/**/*.test.mjs",
          ],
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
          // These suites are NETWORK-bound (live cloud Supabase), not
          // compute-bound: individual ops already run 3–5s in isolation, and
          // `beforeAll` provisioning (createUser + signInWithRetry, which can
          // back off up to ~31s on a 429 + create_organization + workspace)
          // is slower still. Vitest's compute-tier defaults (5s test / 10s
          // hook) leave no headroom, so when a full `pnpm test` interleaves
          // the 200+ parallel unit files the live round-trips slow under CPU
          // contention and tip over the defaults. A timed-out `beforeAll`
          // fails the WHOLE file with no per-test failures — the "N failed
          // files but fewer failed tests" signature of this flake. Generous
          // explicit timeouts remove the load-induced flake without masking
          // real bugs (assertions still fail fast); `retry: 1` absorbs a
          // genuine one-off cloud/network blip.
          testTimeout: 30_000,
          hookTimeout: 60_000,
          retry: 1,
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
