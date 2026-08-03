import { describe, it, expect } from "vitest";
import {
  entitlesAi,
  creditLimitFor,
  CREDIT_LIMIT_UNMANAGED,
} from "@/lib/billing/entitling";
import { CREDITS_PER_SEAT } from "@/lib/billing/tiers";

describe("entitlesAi", () => {
  it("entitles a trialing, active, or past-due subscription", () => {
    expect(entitlesAi("trialing")).toBe(true);
    expect(entitlesAi("active")).toBe(true);
    // past_due is still entitled: Stripe retries for days, and cutting AI off
    // on the first failed charge punishes a customer whose card merely expired.
    expect(entitlesAi("past_due")).toBe(true);
  });

  it("does not entitle never-subscribed, cancelled, or grace", () => {
    expect(entitlesAi("none")).toBe(false);
    expect(entitlesAi("canceled")).toBe(false);
    // grace is the post-cancellation read-only window: non-AI features keep
    // working, AI does not.
    expect(entitlesAi("grace")).toBe(false);
  });
});

describe("creditLimitFor", () => {
  it("gives Pulse 500 pooled credits per seat", () => {
    expect(creditLimitFor("pulse", 1)).toBe(CREDITS_PER_SEAT);
    expect(creditLimitFor("pulse", 7)).toBe(3_500);
  });

  it("gives a trial one flat 500-credit org grant, not per seat", () => {
    expect(creditLimitFor("trial", 1)).toBe(500);
    expect(creditLimitFor("trial", 12)).toBe(500);
  });

  it("gives Core nothing — Core is the no-AI tier", () => {
    expect(creditLimitFor("core", 50)).toBe(0);
    expect(creditLimitFor("none", 50)).toBe(0);
  });

  it("leaves Enterprise at its admin-set ceiling via the sentinel", () => {
    // Enterprise ceilings are negotiated; a webhook recomputing them from seats
    // would silently overwrite the deal.
    expect(creditLimitFor("enterprise", 40)).toBe(CREDIT_LIMIT_UNMANAGED);
    expect(CREDIT_LIMIT_UNMANAGED).toBe(-1);
  });

  it("never returns a negative pool for a real tier", () => {
    expect(creditLimitFor("pulse", 0)).toBe(0);
    expect(creditLimitFor("pulse", -3)).toBe(0);
  });

  it("truncates a fractional seat count rather than writing a fractional pool", () => {
    expect(creditLimitFor("pulse", 2.9)).toBe(1_000);
  });
});
