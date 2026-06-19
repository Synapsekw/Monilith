import { describe, it, expect } from "vitest";
import { timeAgo, formatRunSummary } from "./automation-runs";

describe("timeAgo", () => {
  it("formats minutes/hours/days ago", () => {
    const now = Date.now();
    expect(timeAgo(new Date(now - 5 * 60_000).toISOString(), now)).toMatch(
      /5 min/,
    );
    expect(timeAgo(new Date(now - 3 * 3_600_000).toISOString(), now)).toMatch(
      /3 hour/,
    );
    expect(timeAgo(new Date(now - 2 * 86_400_000).toISOString(), now)).toMatch(
      /2 day/,
    );
  });
  it("handles just-now", () => {
    const now = Date.now();
    expect(timeAgo(new Date(now - 2_000).toISOString(), now)).toMatch(
      /now|sec/i,
    );
  });
});

describe("formatRunSummary", () => {
  it("blocked → condition message", () => {
    expect(formatRunSummary("blocked", [])).toMatch(/condition not met/i);
  });
  it("error → error message", () => {
    expect(formatRunSummary("error", [])).toMatch(/error/i);
  });
  it("ran → joins action outcomes", () => {
    const s = formatRunSummary("ran", [
      { type: "notify", outcome: "sent" },
      { type: "set_option", outcome: "skipped_equal" },
    ]);
    expect(s).toMatch(/notified/i);
    expect(s).toMatch(/unchanged|skipped/i);
  });
  it("ran with no actions → 'ran, no actions'", () => {
    expect(formatRunSummary("ran", [])).toMatch(/no action/i);
  });
});

describe("call_webhook outcome formatting", () => {
  const cases: [string, string][] = [
    ["queued", "webhook queued"],
    ["delivered_200", "webhook delivered (200)"],
    ["delivered_204", "webhook delivered (204)"],
    ["failed_500", "webhook failed (500)"],
    ["failed_404", "webhook failed (404)"],
    ["failed_network", "webhook failed (no response)"],
    ["blocked_unsafe_url", "webhook blocked: unsafe URL"],
  ];
  it.each(cases)("renders %s as %s", (outcome, expected) => {
    expect(formatRunSummary("ran", [{ type: "call_webhook", outcome }])).toBe(
      expected,
    );
  });
});
