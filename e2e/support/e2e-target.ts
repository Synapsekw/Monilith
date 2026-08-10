// May the Playwright suite PROVISION accounts against this Supabase project?
//
// Every spec in `e2e/` loads `.env.local` and creates confirmed users through
// the service-role admin API, gated only on "are the secrets present?". Since
// `.env.local` points at DEV, each run seeded real `@example.com` users and
// throwaway orgs into the live, user-facing database.
//
// Nothing ever collected them: `src/test/global-teardown.ts` is the sweeper for
// exactly this leak, but it purges ONLY a project explicitly marked
// `PULSE_TEST_DB` and refuses DEV/PROD by design (the purge is destructive).
// That asymmetry is the bug — a leak whose collector is forbidden from the
// place the leak happens. The guard therefore belongs on the provisioning side,
// which is what this module is. 56 leaked accounts were removed by hand on
// 2026-08-10; this stops the pile from forming again.
//
// Deliberately mirrors the deny-list vocabulary of `src/test/integration-env.ts`
// rather than inventing a second scheme. Relative import: Playwright's TS
// transform is not a safe place to rely on the `@/*` path alias.
import { labelSupabaseTarget } from "../../src/lib/supabase/project-refs";

/** Opt-in escape hatch for a deliberate DEV run. Never honoured for PROD. */
export const ALLOW_DEV_ENV_VAR = "PULSE_E2E_ALLOW_DEV";

export type E2eTargetVerdict = {
  allowed: boolean;
  /** Operator-facing explanation; present whenever `allowed` is false. */
  reason?: string;
};

/**
 * Decide whether provisioning may run against `url`.
 *
 *  - PROD  → always refused. No override exists, and none should: production
 *            must never grow throwaway accounts.
 *  - DEV   → refused unless `PULSE_E2E_ALLOW_DEV=1`. DEV holds the real,
 *            live, user-facing data (the production deployment runs it), so
 *            polluting it must be a conscious act, not the default.
 *  - other → allowed. A throwaway project or localhost is what E2E is for.
 *
 * An absent URL is refused: the suite cannot prove where it is pointed, and
 * "unknown" is not a safe default when the failure mode is writing to DEV.
 */
export function checkE2eProvisioningTarget(
  url: string | undefined,
  allowDev: string | undefined,
): E2eTargetVerdict {
  if (!url) {
    return {
      allowed: false,
      reason:
        "NEXT_PUBLIC_SUPABASE_URL is not set — refusing to provision against an unknown project.",
    };
  }

  const target = labelSupabaseTarget(url);

  if (target === "prod") {
    return {
      allowed: false,
      reason:
        "Target is the PROD Supabase project. E2E provisioning is never permitted against " +
        `production, and ${ALLOW_DEV_ENV_VAR} does not override this.`,
    };
  }

  if (target === "dev") {
    if (allowDev === "1") return { allowed: true };
    return {
      allowed: false,
      reason:
        "Target is the DEV Supabase project, which holds the real, live, user-facing data " +
        "(www.monolith.works runs on it). Provisioning here leaks @example.com users and " +
        "throwaway orgs that no teardown will ever collect.\n\n" +
        "  → Point .env.test at a throwaway project, or, to accept the pollution deliberately:\n" +
        `      ${ALLOW_DEV_ENV_VAR}=1 pnpm e2e`,
    };
  }

  return { allowed: true };
}
