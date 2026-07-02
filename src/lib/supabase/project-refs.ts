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
