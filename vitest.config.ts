import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

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
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["e2e/**", "node_modules/**", ".next/**"],
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
