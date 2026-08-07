import releaseJson from "../../../public/desktop-release.json";
import {
  validateDesktopRelease,
  type DesktopRelease,
} from "./release-contract";

/**
 * The shipped desktop release, for server rendering.
 *
 * Kept OUT of `release-contract.ts` on purpose: `src/proxy.ts` imports that
 * module on every matched request, so it must stay dependency-free and cheap.
 * This file adds an import of the JSON payload and is only pulled in by the
 * Settings page.
 *
 * The JSON is `import`ed rather than read from disk at request time. `public/`
 * is served statically and is not guaranteed to be present in the serverless
 * bundle, so a `readFileSync(process.cwd() + "/public/…")` works locally and
 * can throw in production — the classic version of this bug.
 */
export function getDesktopRelease(): DesktopRelease {
  const problems = validateDesktopRelease(releaseJson);
  if (problems.length > 0) {
    // Loud rather than silent: a malformed contract means the download button
    // points somewhere wrong, and a wrong installer URL is worse than none.
    throw new Error(`Invalid desktop-release.json: ${problems.join("; ")}`);
  }
  return releaseJson as DesktopRelease;
}
