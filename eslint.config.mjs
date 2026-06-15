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
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Stray Obsidian vault artifacts created inside the repo (not source).
    "Monolith/**",
    "vault/**",
    "**/.obsidian/**",
  ]),
]);

export default eslintConfig;
