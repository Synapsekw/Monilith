import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Validates that .lighthouserc.json is well-formed and encodes the exact
// Phase-9 performance budget (spec §"Success budget"). Assertions are "warn"
// level — the synthetic Lighthouse run on CI is informational (too noisy to
// block); real enforcement is the field/RUM layer. A budget edit that silently
// drops a metric or changes a threshold value fails here.
type Assertion = [
  level: string,
  opts?: { maxNumericValue?: number; minScore?: number },
];

const raw = readFileSync(resolve(process.cwd(), ".lighthouserc.json"), "utf8");

describe(".lighthouserc.json", () => {
  it("is valid JSON", () => {
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  const config = JSON.parse(raw) as {
    ci: {
      collect: {
        url: string[];
        startServerCommand: string;
        numberOfRuns: number;
      };
      assert: { assertions: Record<string, Assertion> };
    };
  };

  it("collects the landing route with a production server over multiple runs", () => {
    expect(config.ci.collect.url).toContain("http://localhost:3000/");
    expect(config.ci.collect.startServerCommand).toContain("start");
    expect(config.ci.collect.numberOfRuns).toBeGreaterThanOrEqual(3);
  });

  const assertions = config.ci.assert.assertions;

  it("enforces LCP < 1.5s", () => {
    expect(assertions["largest-contentful-paint"]?.[0]).toBe("warn");
    expect(assertions["largest-contentful-paint"]?.[1]?.maxNumericValue).toBe(
      1500,
    );
  });

  it("enforces CLS < 0.1", () => {
    expect(assertions["cumulative-layout-shift"]?.[0]).toBe("warn");
    expect(assertions["cumulative-layout-shift"]?.[1]?.maxNumericValue).toBe(
      0.1,
    );
  });

  it("enforces TTFB (server-response-time) < 200ms", () => {
    expect(assertions["server-response-time"]?.[0]).toBe("warn");
    expect(assertions["server-response-time"]?.[1]?.maxNumericValue).toBe(200);
  });

  it("enforces TBT < 200ms (lab proxy for INP responsiveness)", () => {
    expect(assertions["total-blocking-time"]?.[0]).toBe("warn");
    expect(assertions["total-blocking-time"]?.[1]?.maxNumericValue).toBe(200);
  });

  it("enforces a first-load JS (script size) budget", () => {
    expect(assertions["resource-summary:script:size"]?.[0]).toBe("warn");
    expect(
      assertions["resource-summary:script:size"]?.[1]?.maxNumericValue,
    ).toBeGreaterThan(0);
  });

  it("enforces a performance category score floor", () => {
    expect(assertions["categories:performance"]?.[0]).toBe("warn");
    expect(
      assertions["categories:performance"]?.[1]?.minScore,
    ).toBeGreaterThanOrEqual(0.9);
  });
});
