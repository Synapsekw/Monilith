import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

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
});
