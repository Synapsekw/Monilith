import { existsSync } from "node:fs";
import { config } from "dotenv";
import { SUPABASE_PROJECT_REFS } from "@/lib/supabase/project-refs";

// Single source of truth for integration-suite env resolution.
//
// The 38 `*.integration.test.ts(x)` suites + `global-teardown.ts` all import
// this module instead of each hardcoding `config({ path: ".env.local" })`.
// It loads `.env.local` (base) then `.env.test` (override) if present, so a
// dedicated test project's creds win when `.env.test` exists. With no
// `.env.test`, integration suites skip cleanly (default = no DEV pollution).

// Project refs the destructive teardown purge must NEVER touch. PROD is the
// hard line; DEV is also deny-listed belt-and-suspenders so that even a
// mis-set PULSE_TEST_DB=1 in `.env.local` can't aim the purge at DEV. The
// real gate, though, is the positive PULSE_TEST_DB marker: a forgotten
// `.env.test` leaves the marker unset, so the target is never "safe".
const FORBIDDEN_PROJECT_REFS = [
  SUPABASE_PROJECT_REFS.prod, // PROD
  SUPABASE_PROJECT_REFS.dev, // DEV
] as const;

const ENV_LOCAL = ".env.local";
const ENV_TEST = ".env.test";

let loaded = false;

/**
 * Load `.env.local` (base) then `.env.test` (override) if present. Idempotent —
 * safe to call once per file at import time. `override: true` is required
 * because `vitest.setup.ts` seeds placeholder NEXT_PUBLIC_* values first.
 */
export function loadIntegrationEnv(): void {
  if (loaded) return;
  config({ path: ENV_LOCAL, override: true });
  if (existsSync(ENV_TEST)) {
    config({ path: ENV_TEST, override: true });
  }
  loaded = true;
}

/**
 * True only when a SAFE, non-DEV/PROD test target with a service-role is
 * resolved. Integration suites gate `describe.skipIf(!integrationTargetReady())`
 * on this, so they SKIP cleanly when `.env.test` is absent (the default that
 * stops DEV pollution). Running integration suites is therefore opt-in: it
 * requires a provisioned test project + `.env.test`.
 */
export function integrationTargetReady(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return Boolean(serviceRole) && isSafeTestTarget(url);
}

/**
 * Guard for the destructive teardown purge. A URL is a safe test target ONLY
 * when it is the explicitly-marked dedicated test project — never DEV/PROD.
 *
 * Two independent conditions, both required:
 *  - positive: `PULSE_TEST_DB === "1"` (the opt-in marker that only lives in
 *    `.env.test`), and
 *  - negative: the URL is not a known DEV/PROD project ref.
 */
export function isSafeTestTarget(url: string | undefined): boolean {
  if (!url) return false;
  if (process.env.PULSE_TEST_DB !== "1") return false; // explicit opt-in marker
  if (FORBIDDEN_PROJECT_REFS.some((ref) => url.includes(ref))) return false;
  return true;
}
