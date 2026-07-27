// Supabase project refs for this app's known environments. NOT secrets — the
// ref is the subdomain of every client-visible Supabase URL. Single source of
// truth for (a) the boot-time "which project am I pointed at?" label
// (src/lib/env.server.ts) and (b) the integration-teardown deny-list
// (src/test/integration-env.ts). Beware the .env.local duplicate-key/last-wins
// gotcha: these labels are how a silent repoint becomes visible.
export const SUPABASE_PROJECT_REFS = {
  dev: "hjqcahbbbdaknbbnfnvl",
  prod: "jzsyqhxynswolgijkktn",
} as const;

export type SupabaseTargetLabel = "dev" | "prod" | "unknown";

/** Classify a Supabase URL as the known dev project, the known prod project,
 *  or unknown (test projects, localhost, absent). */
export function labelSupabaseTarget(
  url: string | undefined,
): SupabaseTargetLabel {
  if (!url) return "unknown";
  if (url.includes(SUPABASE_PROJECT_REFS.prod)) return "prod";
  if (url.includes(SUPABASE_PROJECT_REFS.dev)) return "dev";
  return "unknown";
}

/**
 * May the Tier-2 tenant-isolation fixtures be asserted against this URL?
 *
 * This is the deliberate INVERSE of the Tier-1 deny-list in
 * `src/test/integration-env.ts`, and the asymmetry is the whole point:
 *
 *   - Tier 1 (`*.integration.test.ts`) PROVISIONS users and runs a destructive
 *     `@example.com` purge, so DEV and PROD are both **denied** to it.
 *   - Tier 2 (`*.fixtures.test.ts`) writes nothing — it signs in as two
 *     permanent seeded users and asserts what RLS refuses them — so DEV is the
 *     one project it is **allowed** to aim at, because DEV is where those
 *     fixtures are seeded.
 *
 * PROD is refused with no override: production must never grow a pair of
 * known-password accounts. An unknown ref (a throwaway project, localhost) is
 * refused too — it has no fixtures, so every isolation assertion would pass
 * vacuously against rows that do not exist.
 */
export function allowsTier2Fixtures(url: string | undefined): boolean {
  return labelSupabaseTarget(url) === "dev";
}
