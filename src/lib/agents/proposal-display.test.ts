import { describe, it, expect } from "vitest";
import {
  PROPOSAL_STATE_PILL,
  proposalDisplayState,
  proposalExpiryLabel,
} from "./proposal-display";

const NOW = Date.parse("2026-08-13T09:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

function at(offsetMs: number): string {
  return new Date(NOW + offsetMs).toISOString();
}

describe("proposalDisplayState", () => {
  it("is pending while the row is undecided and in date", () => {
    expect(
      proposalDisplayState({ status: "pending", expiresAt: at(DAY_MS) }, NOW),
    ).toBe("pending");
  });

  // The rule this module exists for: there is no sweep, so an undecided row
  // keeps `status = 'pending'` for ever. Reading the column alone would offer
  // an Approve button the decide path can only refuse.
  it("is expired once a still-pending row is past its expiry", () => {
    expect(
      proposalDisplayState({ status: "pending", expiresAt: at(-1) }, NOW),
    ).toBe("expired");
  });

  it.each(["approved", "rejected", "expired"] as const)(
    "passes the stored %s status straight through",
    (status) => {
      expect(proposalDisplayState({ status, expiresAt: at(DAY_MS) }, NOW)).toBe(
        status,
      );
    },
  );

  it("shows a status it does not recognise as failed, never as actionable", () => {
    // A sixth status could only arrive via a migration; until the UI knows what
    // it means, offering to execute the row is the one unacceptable answer.
    expect(
      proposalDisplayState({ status: "executing", expiresAt: at(DAY_MS) }, NOW),
    ).toBe("failed");
  });

  it("has a pill for every non-pending state", () => {
    for (const state of [
      "approved",
      "rejected",
      "failed",
      "expired",
    ] as const) {
      expect(PROPOSAL_STATE_PILL[state].label.length).toBeGreaterThan(0);
    }
  });
});

describe("proposalExpiryLabel", () => {
  it("counts whole days", () => {
    expect(proposalExpiryLabel(at(6 * DAY_MS), NOW)).toBe("Expires in 6 days");
  });

  it("names tomorrow and today rather than counting to one or zero", () => {
    expect(proposalExpiryLabel(at(DAY_MS), NOW)).toBe("Expires tomorrow");
    expect(proposalExpiryLabel(at(60_000), NOW)).toBe("Expires today");
    expect(proposalExpiryLabel(at(-DAY_MS), NOW)).toBe("Expires today");
  });
});
