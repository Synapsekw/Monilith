import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  compareShellVersions,
  DESKTOP_RELEASE_FILE,
  DESKTOP_RELEASE_PATH,
  validateDesktopRelease,
} from "./release-contract";

function readShippedRelease(): unknown {
  return JSON.parse(
    readFileSync(join(process.cwd(), ...DESKTOP_RELEASE_FILE), "utf8"),
  );
}

describe("desktop-release.json", () => {
  it("matches the declared contract", () => {
    // The shell hard-blocks when it is below `minSupportedShell`, so a typo here
    // bricks every installed desktop app. Shape is asserted, not assumed — and
    // asserted against the SAME validator the contract module exports, so the
    // file and the type cannot drift apart.
    expect(validateDesktopRelease(readShippedRelease())).toEqual([]);
  });

  it("is served at the path the contract advertises", () => {
    // `proxy.ts` allowlists DESKTOP_RELEASE_PATH; if the file were renamed
    // without updating the constant, the shell would 307 to /login at boot.
    expect(DESKTOP_RELEASE_PATH).toBe(`/${DESKTOP_RELEASE_FILE[1]}`);
    expect(DESKTOP_RELEASE_FILE[0]).toBe("public");
  });
});

describe("validateDesktopRelease", () => {
  const valid = {
    minSupportedShell: "1.0.0",
    latestShell: "1.2.0",
    notes: "n",
  };

  it("accepts a well-formed contract", () => {
    expect(validateDesktopRelease(valid)).toEqual([]);
  });

  it("rejects a non-semver version", () => {
    expect(
      validateDesktopRelease({ ...valid, latestShell: "1.2" }),
    ).toContainEqual(expect.stringContaining("latestShell"));
  });

  it("rejects a missing field", () => {
    expect(
      validateDesktopRelease({ minSupportedShell: "1.0.0", notes: "n" }),
    ).toContainEqual(expect.stringContaining("latestShell"));
  });

  it("rejects minSupportedShell newer than latestShell", () => {
    // This state hard-blocks every installed shell and points it at a version
    // that does not exist.
    expect(
      validateDesktopRelease({
        ...valid,
        minSupportedShell: "2.0.0",
        latestShell: "1.9.9",
      }),
    ).toContainEqual(expect.stringContaining("must be <="));
  });

  it("rejects a non-object", () => {
    expect(validateDesktopRelease(null)).toEqual(["not an object"]);
    expect(validateDesktopRelease("1.0.0")).toEqual(["not an object"]);
  });
});

describe("compareShellVersions", () => {
  it("orders patch numbers numerically, not lexically", () => {
    // Lexical string comparison would wrongly say "1.0.10" < "1.0.9".
    expect(compareShellVersions("1.0.10", "1.0.9")).toBeGreaterThan(0);
    expect(compareShellVersions("1.0.9", "1.0.10")).toBeLessThan(0);
  });

  it("handles equal versions", () => {
    expect(compareShellVersions("1.0.0", "1.0.0")).toBe(0);
  });

  it("orders by major version first", () => {
    expect(compareShellVersions("2.0.0", "1.9.9")).toBeGreaterThan(0);
  });

  it("orders by minor version when major is equal", () => {
    expect(compareShellVersions("1.2.0", "1.1.9")).toBeGreaterThan(0);
  });
});
