import { describe, expect, it } from "vitest";
import { isNonCustomerAccount, partitionByAccountKind } from "./test-accounts";

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
});

describe("partitionByAccountKind", () => {
  const user = (email: string | null) => ({ email });

  it("splits the two buckets and preserves order within each", () => {
    const { people, systemAndTest } = partitionByAccountKind([
      user("a@eand.com"),
      user("pulse-autopilot@pulse.internal"),
      user("b@accenture.com"),
      user("pulse-tier2-fixture-a@example.com"),
      user("c@gmail.com"),
    ]);

    expect(people.map((u) => u.email)).toEqual([
      "a@eand.com",
      "b@accenture.com",
      "c@gmail.com",
    ]);
    expect(systemAndTest.map((u) => u.email)).toEqual([
      "pulse-autopilot@pulse.internal",
      "pulse-tier2-fixture-a@example.com",
    ]);
  });

  it("loses no rows — every input lands in exactly one bucket", () => {
    const input = [
      user("a@eand.com"),
      user(null),
      user("x@example.com"),
      user("b@gmail.com"),
    ];
    const { people, systemAndTest } = partitionByAccountKind(input);
    expect(people.length + systemAndTest.length).toBe(input.length);
  });

  it("handles an empty page", () => {
    expect(partitionByAccountKind([])).toEqual({
      people: [],
      systemAndTest: [],
    });
  });

  it("classifies the four accounts that survive on DEV as non-customer", () => {
    // Regression lock: these are exactly the accounts the 2026-08-10 cleanup
    // deliberately KEPT (the platform agent + the Tier-2 isolation fixtures).
    // If one ever lands in `people`, the console is cluttered again.
    const { people, systemAndTest } = partitionByAccountKind([
      user("pulse-autopilot@pulse.internal"),
      user("pulse-tier2-fixture-a@example.com"),
      user("pulse-tier2-fixture-b@example.com"),
      user("pulse-tier2-fixture-c@example.com"),
    ]);
    expect(people).toEqual([]);
    expect(systemAndTest).toHaveLength(4);
  });
});
