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
  // getAnthropicClient() throws AiNotConfiguredError on use. Non-empty when set.
  ANTHROPIC_API_KEY: z
    .string()
    .min(1, "ANTHROPIC_API_KEY must be non-empty when set")
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
    DIGEST_SECRET: process.env.DIGEST_SECRET,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    APP_BASE_URL: process.env.APP_BASE_URL,
    DIGEST_FROM_EMAIL: process.env.DIGEST_FROM_EMAIL,
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
