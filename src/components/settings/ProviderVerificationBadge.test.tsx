import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ProviderVerification } from "@/lib/ai/providers/provider-rows";
import {
  ProviderVerificationBadge,
  describeVerification,
} from "@/components/settings/ProviderVerificationBadge";

const NOW = Date.parse("2026-08-26T12:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

function verification(
  o: Partial<ProviderVerification> = {},
): ProviderVerification {
  return {
    lastVerifiedAt: null,
    lastAttemptAt: null,
    status: null,
    error: null,
    ...o,
  };
}

describe("describeVerification", () => {
  it("reads a successful run as verified, with how long ago", () => {
    const d = describeVerification(
      verification({
        status: "ok",
        lastVerifiedAt: daysAgo(2),
        lastAttemptAt: daysAgo(2),
      }),
      NOW,
    );
    expect(d.label).toBe("Verified");
    expect(d.tone).toBe("green");
    expect(d.detail).toBe("2 days ago");
  });

  /**
   * THE SENTENCE THIS FEATURE EXISTS TO SAY. A provider that succeeded a week
   * ago and has failed every run since must read as BOTH — failing now, and
   * stale by a week. Reporting only the attempt stamp would say "checked
   * today"; reporting only the success stamp would say "verified a week ago"
   * and omit that anything is wrong.
   */
  it("says how stale a FAILING provider is, not just that it failed", () => {
    const d = describeVerification(
      verification({
        status: "failed",
        lastVerifiedAt: daysAgo(7),
        lastAttemptAt: daysAgo(0),
        error: "mistral model list returned HTTP 401",
      }),
      NOW,
    );
    expect(d.label).toBe("Check failed");
    expect(d.tone).toBe("red");
    expect(d.detail).toBe("last verified 7 days ago");
    expect(d.reason).toBe("mistral model list returned HTTP 401");
  });

  it("says 'never verified' when a failing provider has never once succeeded", () => {
    const d = describeVerification(
      verification({ status: "failed", lastAttemptAt: daysAgo(0) }),
      NOW,
    );
    expect(d.detail).toBe("never verified");
  });

  it("reads a skipped run as awaiting a key, not as a failure", () => {
    const d = describeVerification(
      verification({
        status: "skipped",
        lastAttemptAt: daysAgo(0),
        error: "No personal API key stored for this provider…",
      }),
      NOW,
    );
    expect(d.label).toBe("Not checked");
    expect(d.tone).toBe("gray");
  });

  it("reads an untouched provider as never checked", () => {
    const d = describeVerification(verification(), NOW);
    expect(d.label).toBe("Never checked");
    expect(d.tone).toBe("gray");
    expect(d.detail).toBeNull();
  });
});

describe("ProviderVerificationBadge", () => {
  it("renders nothing at all when there is no record for the provider", () => {
    // A provider the map does not mention must not sprout an empty badge.
    const { container } = render(
      <ProviderVerificationBadge verification={undefined} nowMs={NOW} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  /**
   * WCAG + colorblindness: the red fill is never the only carrier of "this is
   * broken". The word "Check failed" is in the accessible name, and an icon
   * sits beside it — strip every colour from the page and the state still
   * reads.
   */
  it("states the failure in WORDS, not only in colour", () => {
    render(
      <ProviderVerificationBadge
        verification={verification({
          status: "failed",
          lastVerifiedAt: daysAgo(7),
          error: "mistral model list returned HTTP 401",
        })}
        nowMs={NOW}
      />,
    );
    const badge = screen.getByRole("status");
    expect(badge).toHaveTextContent("Check failed");
    expect(badge).toHaveTextContent("last verified 7 days ago");
    // The provider's own reason is reachable to assistive tech.
    expect(badge).toHaveTextContent("mistral model list returned HTTP 401");
    // The icon is decorative — the words carry the meaning.
    expect(badge.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("shows freshness for a healthy provider", () => {
    render(
      <ProviderVerificationBadge
        verification={verification({
          status: "ok",
          lastVerifiedAt: daysAgo(1),
          lastAttemptAt: daysAgo(1),
        })}
        nowMs={NOW}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Verified");
    expect(screen.getByRole("status")).toHaveTextContent("yesterday");
  });

  it("uses semantic tokens only — no raw palette colours", () => {
    const { container } = render(
      <ProviderVerificationBadge
        verification={verification({ status: "failed" })}
        nowMs={NOW}
      />,
    );
    const classes = Array.from(container.querySelectorAll("*"))
      .map((el) => el.getAttribute("class") ?? "")
      .join(" ");
    expect(classes).not.toMatch(/\b(bg|text|border)-(red|green|slate|zinc)-\d/);
  });
});
