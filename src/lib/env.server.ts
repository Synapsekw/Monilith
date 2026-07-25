import "server-only";
import { z } from "zod";
import { env } from "@/lib/env";
import { labelSupabaseTarget } from "@/lib/supabase/project-refs";

// Server-only environment. The `server-only` import (built into Next 16) makes
// any client-component import a BUILD error, so these vars can never reach a
// browser bundle. Parsing is LAZY + memoized (not import-time) on purpose:
// `next build` must not require secrets, and unit tests mutate process.env.
// Eagerness is provided by src/instrumentation.ts register(), which forces the
// first parse at server boot.
const serverEnvSchema = z.object({
  // Core infrastructure (service client, provisioning) — the server must not
  // boot without it. min(1) also rejects the empty string a duplicate
  // .env.local key (last-wins) can leave behind.
  SUPABASE_SERVICE_ROLE_KEY: z
    .string()
    .min(1, "SUPABASE_SERVICE_ROLE_KEY is required"),
  // Optional feature (AI dashboard generation): absent → the app boots and
  // credential resolution throws AiNotConfiguredError on use. Non-empty when set.
  ANTHROPIC_API_KEY: z
    .string()
    .min(1, "ANTHROPIC_API_KEY must be non-empty when set")
    .optional(),
  // Optional feature (E5 · F15 semantic search): the FIXED platform embedding
  // key. Semantic search needs one model for the whole corpus, so embeddings do
  // NOT use org/user BYO keys — they use this platform key, independent of any
  // org's ai_mode. Absent → the embedding client throws AiNotConfiguredError on
  // use (semantic surfaces degrade); the app still boots and CI stays green.
  OPENAI_EMBEDDING_API_KEY: z
    .string()
    .min(1, "OPENAI_EMBEDDING_API_KEY must be non-empty when set")
    .optional(),
  // Optional feature (E5 agentic + semantic): the single shared secret that signs
  // every in-DB `pg_net → service endpoint` hop. The DB reads the same value from
  // Vault (`ai_pgnet_hmac_secret`) and HMAC-signs the body; each route handler
  // re-verifies with this env var (verifyBody). Shared by /api/ai/automation-step
  // + /api/ai/autopilot (F13/F14) and /api/ai/embed (F15 sweep + backfill). Absent
  // → those endpoints 503 (no verification key); the app still boots and CI stays
  // green.
  AI_PGNET_HMAC_SECRET: z
    .string()
    .min(32, "AI_PGNET_HMAC_SECRET must be at least 32 chars when set")
    .optional(),
  // Optional feature (weekly health digest): all absent → the digest
  // self-disables (route 503s; no email). CI/boot stays green without them.
  DIGEST_SECRET: z
    .string()
    .min(32, "DIGEST_SECRET must be at least 32 chars when set")
    .optional(),
  RESEND_API_KEY: z
    .string()
    .min(1, "RESEND_API_KEY must be non-empty when set")
    .optional(),
  APP_BASE_URL: z
    .string()
    .url("APP_BASE_URL must be an absolute URL when set")
    .optional(),
  DIGEST_FROM_EMAIL: z
    .string()
    .email("DIGEST_FROM_EMAIL must be an email when set")
    .optional(),
  // Optional ops lever for ALL app-level rate limits in
  // src/lib/rate-limit/auth-rate-limit.ts — the four auth server actions AND
  // the public OAuth dynamic-registration endpoint (/api/oauth/register).
  // Multiplies every compiled default limit (e.g. "2" doubles all caps, "0.5"
  // halves them). Absent → 1× defaults. Feature works fully without it, like
  // the DIGEST_* optionals above. Name kept AUTH_-prefixed for continuity —
  // renaming it would break already-provisioned Vercel envs.
  AUTH_RATE_LIMIT_MULTIPLIER: z.coerce
    .number()
    .positive("AUTH_RATE_LIMIT_MULTIPLIER must be a positive number when set")
    .optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | null = null;

/** Parse (once) and return the validated server env. Throws one aggregated
 *  error naming every missing/invalid var. */
export function getServerEnv(): ServerEnv {
  if (cached) return cached;
  // Static property access so the reads are analyzable (matches env.ts style).
  const parsed = serverEnvSchema.safeParse({
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    OPENAI_EMBEDDING_API_KEY: process.env.OPENAI_EMBEDDING_API_KEY,
    AI_PGNET_HMAC_SECRET: process.env.AI_PGNET_HMAC_SECRET,
    DIGEST_SECRET: process.env.DIGEST_SECRET,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    APP_BASE_URL: process.env.APP_BASE_URL,
    DIGEST_FROM_EMAIL: process.env.DIGEST_FROM_EMAIL,
    AUTH_RATE_LIMIT_MULTIPLIER: process.env.AUTH_RATE_LIMIT_MULTIPLIER,
  });
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid server environment variables:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Test-only: clear the memo so a test can re-parse a mutated process.env. */
export function resetServerEnvForTests(): void {
  cached = null;
}

/** True when running on a serverless platform (Vercel / AWS Lambda). Used to
 *  pick the bundled @sparticuz/chromium binary vs. a local Chrome. Not part of
 *  the validated schema — it's optional runtime detection, absent = local. */
export function isServerlessRuntime(): boolean {
  return Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.VERCEL);
}

/** One presence-only boot line: which Supabase project is active (the
 *  last-wins .env.local tripwire) and which server secrets are set. Never
 *  prints values. Throws (via getServerEnv) when the env is invalid. */
export function serverEnvSummary(): string {
  const server = getServerEnv();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const ref = new URL(url).hostname.split(".")[0];
  const label = labelSupabaseTarget(url).toUpperCase();
  const anthropic = server.ANTHROPIC_API_KEY ? "present" : "absent";
  return `[env] supabase ref ${ref} (${label}) · service role: present · anthropic: ${anthropic}`;
}
