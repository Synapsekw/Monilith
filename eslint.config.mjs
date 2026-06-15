import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
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
