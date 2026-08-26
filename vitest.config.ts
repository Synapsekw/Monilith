import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vitest/config";

const sharedExclude = ["e2e/**", "node_modules/**", ".next/**"];

/**
 * Strip a leading `#!/usr/bin/env node` shebang from `.mjs` modules before the
 * SSR transform parses them. The `.claude/hooks/*.mjs` scripts keep their
 * conventional shebang (they're also runnable as `node <file>`), but Rolldown's
 * SSR script parser rejects the `!` and fails the whole `pnpm test` gate when a
 * hook test imports one. Replace the line with a blank comment so byte/line
 * offsets — and the shebang's documentation intent — are preserved.
 */
const stripShebang: Plugin = {
  name: "strip-mjs-shebang",
  enforce: "pre",
  transform(code, id) {
    if (id.endsWith(".mjs") && code.startsWith("#!")) {
      return { code: code.replace(/^#![^\n]*/, "//"), map: null };
    }
    return null;
  },
};

export default defineConfig({
  plugins: [stripShebang, react()],
  test: {
    environment: "jsdom",
    // vitest's default fork-pool size (cpus - 1) oversubscribes a normal dev
    // machine: each jsdom worker is memory-hungry, and competing against the
    // rest of a real desktop's running apps pushes the box into swap, which
    // then makes worker *spawn* itself time out -- "[vitest-pool]: Timeout
    // starting forks runner" / "Timeout waiting for worker to respond" --
    // not a real test failure. A modest cap is faster in practice (no
    // thrashing) and reliable on both a laptop and a memory-constrained CI
    // runner, which is exactly the profile the default heuristic gets wrong.
    maxWorkers: 4,
    setupFiles: ["./vitest.setup.ts"],
    // Runs once after the whole run: purges leaked @example.com cloud test
    // data provisioned by *.integration.test.ts suites. See
    // src/test/global-teardown.ts (exports a named `teardown`).
    globalSetup: ["./src/test/global-teardown.ts"],
    globals: true,
    // Four projects (all inherit the options above via `extends: true`).
    // `pnpm test` runs three of them — unit + conformance + fixtures. The
    // integration project is OPT-IN (`pnpm test:integration`); see below.
    //
    //   - unit: fast, parallel, everything except the three live-project
    //     suites.
    //   - integration (TIER 1, opt-in): the *.integration.test.ts suites, which
    //     PROVISION throwaway users/orgs against a live cloud project and run a
    //     destructive @example.com purge. That needs a privileged key AND a
    //     sacrificial project, which decision-25 ruled we will not provision —
    //     so all 70 of them skip. Keeping them in the default run advertised
    //     coverage that does not exist, so they moved out to their own script
    //     rather than being deleted (the wiring still works the moment a
    //     `.env.test` exists). Run serially — concurrent files collectively
    //     trip GoTrue's auth rate limit (429 over_request_rate_limit), which
    //     surfaces either loudly or silently as a null org from
    //     create_organization. Pairs with signInWithRetry() in
    //     src/test/integration-auth.ts.
    //   - conformance (TIER 3): the *.conformance.test.ts suites. Read-only
    //     probes that prove `anon` can reach nothing on a LIVE project. Unlike
    //     integration they provision NOTHING and hold no privileged key, so
    //     they are safe against DEV (the default) and against PROD on demand.
    //   - fixtures (TIER 2): the *.fixtures.test.ts suites. The AUTHENTICATED
    //     half of the same boundary — two permanent seeded tenants on DEV,
    //     never mutated, so cross-tenant isolation is a read-only assertion.
    //     Also non-privileged and provisioning-free. DEV only, by design; see
    //     allowsTier2Fixtures() in src/lib/supabase/project-refs.ts.
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          // `.claude/hooks/**` covers the Claude Code hook scripts and
          // `scripts/**` the repo tooling scripts (both plain node .mjs with
          // exported pure functions) so they run in the same `pnpm test` gate
          // as src. Anchored at the repo root on purpose — it does not reach
          // into `.claude/worktrees/*` copies.
          include: [
            "src/**/*.{test,spec}.{ts,tsx}",
            ".claude/hooks/**/*.test.mjs",
            "scripts/**/*.test.mjs",
          ],
          exclude: [
            ...sharedExclude,
            "src/**/*.integration.test.{ts,tsx}",
            "src/**/*.conformance.test.ts",
            "src/**/*.fixtures.test.ts",
          ],
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
      {
        extends: true,
        test: {
          name: "conformance",
          include: ["src/**/*.conformance.test.ts"],
          exclude: sharedExclude,
          // Inherits jsdom + vitest.setup.ts. A `node` environment would suit
          // these fetch-only suites better, but `setupFiles: []` does not
          // override through `extends: true` and the DOM shims then throw. The
          // placeholder NEXT_PUBLIC_* values that setup seeds are handled where
          // it counts: resolveConformanceTarget() rejects them, so a run
          // without real credentials SKIPS instead of probing localhost.
          fileParallelism: false,
          // ~180 live round-trips at concurrency 6, in one beforeAll.
          testTimeout: 120_000,
          hookTimeout: 180_000,
          // Absorbs a one-off network blip. A genuine finding is deterministic
          // and survives the retry.
          retry: 1,
        },
      },
      {
        extends: true,
        test: {
          name: "fixtures",
          include: ["src/**/*.fixtures.test.ts"],
          exclude: sharedExclude,
          // Serial for the same reason as integration: every file signs the two
          // permanent fixture accounts in, and parallel worktrees share one
          // GoTrue instance. signInOrThrow() rides out the 429 on top of this.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 120_000,
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
