import * as path from "node:path";
import * as dotenv from "dotenv";
import { ALLOW_DEV_ENV_VAR, checkE2eProvisioningTarget } from "./e2e-target";

/**
 * Playwright `globalSetup`: runs ONCE before any spec, and fails the whole run
 * loudly if the resolved Supabase project must not be provisioned into.
 *
 * One choke point instead of a guard duplicated across 26 spec files — and it
 * covers specs written later, which is the half that matters. Wired into both
 * `playwright.config.ts` and `playwright.offline.config.ts` (the offline suite
 * ran from the latter and was the single largest producer of leaked accounts).
 *
 * Loads env the same way the specs do, so it judges exactly the project they
 * will reach — not a differently-resolved one.
 */
export default function globalSetup(): void {
  dotenv.config({
    path: path.resolve(process.cwd(), ".env.local"),
    override: true,
  });
  const envTest = path.resolve(process.cwd(), ".env.test");
  dotenv.config({ path: envTest, override: true });

  // No service-role key → no spec can provision anything; they skip themselves.
  // Staying quiet here keeps CI (which has no secrets) green.
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return;

  const verdict = checkE2eProvisioningTarget(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env[ALLOW_DEV_ENV_VAR],
  );

  if (!verdict.allowed) {
    throw new Error(
      `[e2e] Refusing to run: unsafe provisioning target.\n\n${verdict.reason}\n`,
    );
  }
}
