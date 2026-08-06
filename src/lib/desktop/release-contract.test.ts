import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Compares two semantic versions numerically.
 * String comparison would be wrong: lexically "1.0.10" < "1.0.9".
 * This function parses each version into major.minor.patch and compares
 * them numerically, which is the only correct way to order semver.
 *
 * Returns: negative if a < b, 0 if a === b, positive if a > b
 */
function compareSemver(a: string, b: string): number {
  const [aMajor, aMinor, aPatch] = a.split(".").map(Number);
  const [bMajor, bMinor, bPatch] = b.split(".").map(Number);

  if (aMajor !== bMajor) return aMajor - bMajor;
  if (aMinor !== bMinor) return aMinor - bMinor;
  return aPatch - bPatch;
}

describe("desktop-release.json", () => {
  it("declares semver-shaped shell versions", () => {
    const raw = readFileSync(
      join(process.cwd(), "public", "desktop-release.json"),
      "utf8",
    );
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    // The shell hard-blocks when it is below `minSupportedShell`, so a typo
    // here bricks every installed desktop app. Shape is asserted, not assumed.
    expect(typeof parsed.minSupportedShell).toBe("string");
    expect(typeof parsed.latestShell).toBe("string");
    expect(parsed.minSupportedShell).toMatch(/^\d+\.\d+\.\d+$/);
    expect(parsed.latestShell).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("ensures minSupportedShell <= latestShell", () => {
    const raw = readFileSync(
      join(process.cwd(), "public", "desktop-release.json"),
      "utf8",
    );
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    const minSupported = parsed.minSupportedShell as string;
    const latest = parsed.latestShell as string;

    // If minSupportedShell > latestShell, every installed desktop app
    // hard-blocks with an update prompt pointing to a version that doesn't
    // exist. This is a catastrophic state we must prevent.
    expect(compareSemver(minSupported, latest)).toBeLessThanOrEqual(0);
  });
});

describe("compareSemver", () => {
  it("correctly orders versions with different patch numbers", () => {
    // Lexical string comparison would wrongly say "1.0.10" < "1.0.9"
    expect(compareSemver("1.0.10", "1.0.9")).toBeGreaterThan(0);
    expect(compareSemver("1.0.9", "1.0.10")).toBeLessThan(0);
  });

  it("handles equal versions", () => {
    expect(compareSemver("1.0.0", "1.0.0")).toBe(0);
  });

  it("orders by major version first", () => {
    expect(compareSemver("2.0.0", "1.9.9")).toBeGreaterThan(0);
  });

  it("orders by minor version when major is equal", () => {
    expect(compareSemver("1.2.0", "1.1.9")).toBeGreaterThan(0);
  });
});
