import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Pin `no-explicit-any` to error. eslint-config-next/typescript already sets this
  // today, but pinning documents intent and survives a future Next major that might
  // relax the default. This is the guard that keeps Supabase `Json`/jsonb columns and
  // RPC return boundaries honest — parse them with Zod, never cast through `any`.
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  // Env vars are read through the validated schemas — src/lib/env.ts (public,
  // NEXT_PUBLIC_*) and src/lib/env.server.ts (server-only secrets) — never raw.
  // Exemptions: the two schema modules themselves; instrumentation.ts (reads
  // NEXT_RUNTIME/VERCEL_ENV, the platform vars that gate validation);
  // web-vitals.tsx (deliberate static reads for Next inline replacement — the
  // endpoint var IS schema-validated in env.ts); and test land, where mutating
  // process.env is the job.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      "src/lib/env.ts",
      "src/lib/env.server.ts",
      "src/instrumentation.ts",
      "src/components/web-vitals.tsx",
      "src/test/**",
      "src/**/*.test.{ts,tsx}",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            'MemberExpression[object.type="MemberExpression"][object.object.name="process"][object.property.name="env"]',
          message:
            "Read env vars via src/lib/env.ts (public) or src/lib/env.server.ts (server secrets), not process.env directly.",
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "**/.next/**", // nested build output (e.g. git worktrees under .claude/)
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Agent/tooling scratch dirs — worktrees, caches; never source.
    ".claude/**",
    // Stray Obsidian vault artifacts created inside the repo (not source).
    "Monolith/**",
    "vault/**",
    "**/.obsidian/**",
  ]),
]);

export default eslintConfig;
