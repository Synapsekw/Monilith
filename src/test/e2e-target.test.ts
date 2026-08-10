import { describe, expect, it } from "vitest";
import { SUPABASE_PROJECT_REFS } from "@/lib/supabase/project-refs";
// The module under test lives in `e2e/` (it guards Playwright), but its test
// lives here: vitest's unit project only includes `src/**`, and a `*.test.ts`
// placed under `e2e/` would be collected by PLAYWRIGHT instead — where it would
// fail for want of a browser fixture.
import {
  ALLOW_DEV_ENV_VAR,
  checkE2eProvisioningTarget,
} from "../../e2e/support/e2e-target";

const DEV_URL = `https://${SUPABASE_PROJECT_REFS.dev}.supabase.co`;
const PROD_URL = `https://${SUPABASE_PROJECT_REFS.prod}.supabase.co`;
const THROWAWAY_URL = "https://abcdefghijklmnopqrst.supabase.co";

describe("checkE2eProvisioningTarget", () => {
  it("always refuses PROD", () => {
    expect(checkE2eProvisioningTarget(PROD_URL, undefined).allowed).toBe(false);
  });

  it("refuses PROD even when the DEV override is set", () => {
    // The override is scoped to DEV by design; production has no escape hatch.
    const verdict = checkE2eProvisioningTarget(PROD_URL, "1");
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toMatch(/never permitted/i);
  });

  it("refuses DEV by default — this is the leak that motivated the guard", () => {
    const verdict = checkE2eProvisioningTarget(DEV_URL, undefined);
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toContain(ALLOW_DEV_ENV_VAR);
  });

  it("allows DEV only on an explicit opt-in", () => {
    expect(checkE2eProvisioningTarget(DEV_URL, "1").allowed).toBe(true);
  });

  it("does not accept a truthy-but-wrong override value", () => {
    for (const value of ["true", "yes", "0", ""]) {
      expect(checkE2eProvisioningTarget(DEV_URL, value).allowed, value).toBe(
        false,
      );
    }
  });

  it("allows a throwaway project — that is what E2E is for", () => {
    expect(checkE2eProvisioningTarget(THROWAWAY_URL, undefined).allowed).toBe(
      true,
    );
    expect(
      checkE2eProvisioningTarget("http://localhost:54321", undefined).allowed,
    ).toBe(true);
  });

  it("refuses an absent URL rather than guessing", () => {
    const verdict = checkE2eProvisioningTarget(undefined, "1");
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toMatch(/not set/i);
  });

  it("always explains itself when it refuses", () => {
    for (const url of [PROD_URL, DEV_URL, undefined]) {
      const verdict = checkE2eProvisioningTarget(url, undefined);
      expect(verdict.allowed).toBe(false);
      expect(verdict.reason?.length ?? 0).toBeGreaterThan(0);
    }
  });
});
