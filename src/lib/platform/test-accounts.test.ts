import { describe, expect, it } from "vitest";
import {
  NON_CUSTOMER_EMAIL_PATTERNS,
  isNonCustomerAccount,
} from "./test-accounts";

describe("isNonCustomerAccount", () => {
  it("flags IANA-reserved test domains", () => {
    expect(isNonCustomerAccount("pulse-tier2-fixture-a@example.com")).toBe(
      true,
    );
    expect(isNonCustomerAccount("someone@example.net")).toBe(true);
    expect(isNonCustomerAccount("someone@example.org")).toBe(true);
  });

  it("flags the .internal suffix used by system actors", () => {
    expect(isNonCustomerAccount("pulse-autopilot@pulse.internal")).toBe(true);
  });

  it("treats real customer domains as people", () => {
    for (const email of [
      "info@synapse-solutions.ai",
      "mohamedalzarooni@eand.com",
      "irdhina.harith@accenture.com",
      "leostalin91@gmail.com",
      "misamara@hotmail.com",
    ]) {
      expect(isNonCustomerAccount(email), email).toBe(false);
    }
  });

  it("normalizes case and surrounding whitespace", () => {
    expect(isNonCustomerAccount("  Probe-1@EXAMPLE.COM ")).toBe(true);
    expect(isNonCustomerAccount("Pulse-Autopilot@Pulse.Internal")).toBe(true);
  });

  it("treats a missing address as a real user — never hide an unknown row", () => {
    expect(isNonCustomerAccount(null)).toBe(false);
    expect(isNonCustomerAccount(undefined)).toBe(false);
    expect(isNonCustomerAccount("")).toBe(false);
  });

  it("does not match a lookalike domain that merely contains the reserved name", () => {
    // A real company could plausibly register these; only the true suffix counts.
    expect(isNonCustomerAccount("sales@example.com.attacker.io")).toBe(false);
    expect(isNonCustomerAccount("hi@notexample.com")).toBe(false);
    expect(isNonCustomerAccount("ops@internal.io")).toBe(false);
  });

  it("classifies the four accounts that survive on DEV as non-customer", () => {
    // Regression lock: these are exactly the accounts the 2026-08-10 cleanup
    // deliberately KEPT (the platform agent + the Tier-2 isolation fixtures).
    for (const email of [
      "pulse-autopilot@pulse.internal",
      "pulse-tier2-fixture-a@example.com",
      "pulse-tier2-fixture-b@example.com",
      "pulse-tier2-fixture-c@example.com",
    ]) {
      expect(isNonCustomerAccount(email), email).toBe(true);
    }
  });
});

describe("NON_CUSTOMER_EMAIL_PATTERNS", () => {
  // The list is handed to `platform_search_users` as SQL ILIKE patterns, so the
  // database and the TypeScript classifier must agree on every address.
  // Mirror ILIKE here: `%` = any run of characters, everything else literal.
  const ilike = (email: string, pattern: string) =>
    new RegExp(
      "^" +
        pattern
          .split("%")
          .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
          .join(".*") +
        "$",
      "i",
    ).test(email);
  const matchesAny = (email: string) =>
    NON_CUSTOMER_EMAIL_PATTERNS.some((p) => ilike(email, p));

  it("is a non-empty list of leading-wildcard suffix patterns", () => {
    expect(NON_CUSTOMER_EMAIL_PATTERNS.length).toBeGreaterThan(0);
    for (const p of NON_CUSTOMER_EMAIL_PATTERNS) {
      expect(p.startsWith("%"), p).toBe(true);
      // Exactly one wildcard, at the front — a suffix match and nothing else.
      expect(p.indexOf("%", 1), p).toBe(-1);
      // No `_` single-char wildcard sneaking in: ILIKE treats it specially.
      expect(p.includes("_"), p).toBe(false);
    }
  });

  it("agrees with isNonCustomerAccount on every address the classifier handles", () => {
    for (const email of [
      "pulse-autopilot@pulse.internal",
      "pulse-tier2-fixture-a@example.com",
      "someone@example.net",
      "someone@example.org",
      "Probe-1@EXAMPLE.COM",
      "info@synapse-solutions.ai",
      "leostalin91@gmail.com",
      "sales@example.com.attacker.io",
      "hi@notexample.com",
      "ops@internal.io",
    ]) {
      expect(matchesAny(email), email).toBe(isNonCustomerAccount(email));
    }
  });
});
