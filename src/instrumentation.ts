// Next 16 instrumentation file convention: register() runs ONCE per server
// instance (next dev / next start / serverless cold start), before requests
// are served — and does NOT run during `next build`. This is what makes the
// lazy server-env schema eager where it matters: a bad env fails the boot
// loudly instead of the first AI call or service-client query. Reference:
// node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md
export async function register(): Promise<void> {
  // Skip the edge pass — the server-only env module is nodejs-runtime code.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Dynamic import inside the runtime guard (documented pattern) keeps
  // env.server out of the edge bundle graph.
  const { getServerEnv, serverEnvSummary } = await import("@/lib/env.server");

  // Throws (via getServerEnv) with an aggregated, var-naming message when the
  // env is invalid → the server refuses to start. Otherwise: one presence-only
  // line naming the active Supabase ref — the .env.local last-wins tripwire.
  console.log(serverEnvSummary());

  // AI generation is an optional feature (AiNotConfiguredError degrades
  // gracefully), so a missing key WARNS in production rather than failing boot.
  if (
    process.env.VERCEL_ENV === "production" &&
    !getServerEnv().ANTHROPIC_API_KEY
  ) {
    console.warn(
      "[env] ANTHROPIC_API_KEY is not set in production — AI dashboard generation is disabled.",
    );
  }
}
