/**
 * The web app's half of the macOS desktop-shell contract.
 *
 * The shell (a SEPARATE repo — see `./README.md`) fetches
 * `DESKTOP_RELEASE_PATH` at boot and refuses to run if its own version is below
 * `minSupportedShell`. Everything this repo owes the shell is declared here so
 * the surface can be read in one place instead of being reconstructed from a
 * static file in `public/`, a route exemption in `proxy.ts` and a test filed
 * under `src/app/`.
 *
 * Deliberately dependency-free (no Zod): `src/proxy.ts` imports
 * `DESKTOP_RELEASE_PATH` and runs on every matched request, so this module must
 * stay cheap to load. The values it validates are a static file WE author and a
 * test asserts on — not untrusted request input, which is what the Zod-at-
 * boundaries rule is about.
 */

/**
 * Public URL of the version contract. Must stay in sync with the real file at
 * `public/desktop-release.json`; `release-contract.test.ts` asserts they agree.
 */
export const DESKTOP_RELEASE_PATH = "/desktop-release.json";

/** Path of the shipped file on disk, relative to the repo root. */
export const DESKTOP_RELEASE_FILE = ["public", "desktop-release.json"] as const;

export type DesktopRelease = {
  /** A shell older than this hard-blocks with an update prompt. */
  minSupportedShell: string;
  /** Newest shell the deployed web app is known to work with. */
  latestShell: string;
  notes: string;
};

const SEMVER = /^\d+\.\d+\.\d+$/;

/**
 * Compare two `major.minor.patch` versions numerically.
 *
 * String comparison is wrong here — lexically `"1.0.10" < "1.0.9"` — and being
 * wrong in this particular comparison hard-blocks every installed desktop app.
 *
 * Returns <0 if a < b, 0 if equal, >0 if a > b.
 */
export function compareShellVersions(a: string, b: string): number {
  const [aMajor, aMinor, aPatch] = a.split(".").map(Number);
  const [bMajor, bMinor, bPatch] = b.split(".").map(Number);

  if (aMajor !== bMajor) return aMajor - bMajor;
  if (aMinor !== bMinor) return aMinor - bMinor;
  return aPatch - bPatch;
}

/**
 * Validate an arbitrary parsed JSON value as a `DesktopRelease`.
 *
 * Returns the list of problems; empty means valid. A typo in either version
 * bricks every installed shell, so shape is asserted rather than assumed.
 */
export function validateDesktopRelease(value: unknown): string[] {
  const problems: string[] = [];

  if (typeof value !== "object" || value === null) {
    return ["not an object"];
  }
  const record = value as Record<string, unknown>;

  for (const field of ["minSupportedShell", "latestShell"] as const) {
    const raw = record[field];
    if (typeof raw !== "string") {
      problems.push(`${field} must be a string`);
    } else if (!SEMVER.test(raw)) {
      problems.push(`${field} must be major.minor.patch, got "${raw}"`);
    }
  }
  if (typeof record.notes !== "string") {
    problems.push("notes must be a string");
  }

  if (problems.length === 0) {
    const { minSupportedShell, latestShell } = record as DesktopRelease;
    if (compareShellVersions(minSupportedShell, latestShell) > 0) {
      // Every installed shell would hard-block and point at a version that does
      // not exist.
      problems.push(
        `minSupportedShell (${minSupportedShell}) must be <= latestShell (${latestShell})`,
      );
    }
  }

  return problems;
}
