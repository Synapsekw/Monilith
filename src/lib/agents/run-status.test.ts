import { describe, it, expect } from "vitest";
import {
  agentRunDisplayStatus,
  agentRunStatusColor,
  agentRunStatusLabel,
  describeAgentRun,
  CLAIM_PLACEHOLDER,
  STALE_CLAIM_MS,
  type AgentRunLike,
} from "./run-status";

const NOW = Date.parse("2026-08-02T09:00:00.000Z");

function run(over: Partial<AgentRunLike> = {}): AgentRunLike {
  return {
    status: "ran",
    error: null,
    createdAt: new Date(NOW).toISOString(),
    ...over,
  };
}

describe("agentRunDisplayStatus", () => {
  it("maps a finished run to ran", () => {
    expect(agentRunDisplayStatus(run(), NOW)).toBe("ran");
  });

  it("maps a gated run to skipped", () => {
    expect(
      agentRunDisplayStatus(
        run({ status: "skipped", error: "Daily agent run limit reached." }),
        NOW,
      ),
    ).toBe("skipped");
  });

  it("maps a genuine error to error", () => {
    expect(
      agentRunDisplayStatus(run({ status: "error", error: "boom" }), NOW),
    ).toBe("error");
  });

  // The crux: the endpoint claims its fire slot by writing status='error' with
  // the placeholder BEFORE any spend, so a healthy in-flight run is
  // indistinguishable from a failure on `status` alone.
  it("maps a freshly claimed run to running, not error", () => {
    expect(
      agentRunDisplayStatus(
        run({ status: "error", error: CLAIM_PLACEHOLDER }),
        NOW + 1_000,
      ),
    ).toBe("running");
  });

  it("maps a claim that never finalised to incomplete once it is stale", () => {
    expect(
      agentRunDisplayStatus(
        run({ status: "error", error: CLAIM_PLACEHOLDER }),
        NOW + STALE_CLAIM_MS + 1,
      ),
    ).toBe("incomplete");
  });

  it("treats the staleness boundary as still running", () => {
    expect(
      agentRunDisplayStatus(
        run({ status: "error", error: CLAIM_PLACEHOLDER }),
        NOW + STALE_CLAIM_MS - 1,
      ),
    ).toBe("running");
  });

  // A stored error that merely resembles the sentinel is a real failure — the
  // route compares with ===, so this must too.
  it("does not treat a near-miss of the placeholder as in-flight", () => {
    expect(
      agentRunDisplayStatus(
        run({ status: "error", error: `${CLAIM_PLACEHOLDER} (retry)` }),
        NOW,
      ),
    ).toBe("error");
  });

  it("never leaves an unparseable timestamp permanently 'running'", () => {
    expect(
      agentRunDisplayStatus(
        { status: "error", error: CLAIM_PLACEHOLDER, createdAt: "not a date" },
        NOW,
      ),
    ).toBe("incomplete");
  });
});

describe("presentation", () => {
  it("gives every display status a label and a status token", () => {
    for (const s of [
      "ran",
      "skipped",
      "running",
      "incomplete",
      "error",
    ] as const) {
      expect(agentRunStatusLabel(s)).toBeTruthy();
      expect(agentRunStatusColor(s)).toBeTruthy();
    }
  });

  it("uses distinct colours for in-flight, incomplete and failed", () => {
    const colors = [
      agentRunStatusColor("running"),
      agentRunStatusColor("incomplete"),
      agentRunStatusColor("error"),
    ];
    expect(new Set(colors).size).toBe(3);
  });
});

describe("describeAgentRun", () => {
  it("summarises a successful run", () => {
    expect(describeAgentRun(run(), NOW)).toBe("Briefing sent");
  });

  // The reason is the point: a skipped run that says only "Skipped" is exactly
  // as silent as no run history at all.
  it("surfaces the stored reason for a skipped run", () => {
    const reason = "Personal agents currently require an Anthropic key.";
    expect(
      describeAgentRun(run({ status: "skipped", error: reason }), NOW),
    ).toBe(reason);
  });

  it("surfaces the stored reason for a failed run", () => {
    expect(
      describeAgentRun(
        run({ status: "error", error: "getaddrinfo ENOTFOUND" }),
        NOW,
      ),
    ).toBe("getaddrinfo ENOTFOUND");
  });

  it("explains an in-flight run without calling it a failure", () => {
    const text = describeAgentRun(
      run({ status: "error", error: CLAIM_PLACEHOLDER }),
      NOW + 1_000,
    );
    expect(text).toMatch(/still running/i);
    expect(text).not.toMatch(/fail/i);
  });

  it("says plainly that a stale claim sent nothing", () => {
    expect(
      describeAgentRun(
        run({ status: "error", error: CLAIM_PLACEHOLDER }),
        NOW + STALE_CLAIM_MS + 1,
      ),
    ).toMatch(/never finished/i);
  });

  it("truncates a pathologically long reason", () => {
    const text = describeAgentRun(
      run({ status: "error", error: "x".repeat(1000) }),
      NOW,
    );
    expect(text.length).toBeLessThan(200);
    expect(text.endsWith("…")).toBe(true);
  });

  it("still says something when an error row records no reason", () => {
    expect(
      describeAgentRun(run({ status: "error", error: null }), NOW),
    ).toMatch(/no reason recorded/i);
  });
});
