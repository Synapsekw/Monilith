import "server-only";
import { isIP } from "node:net";
import { z } from "zod";

export const monoEnvironmentSchema = z.object({
  MONO_SITE_ORIGIN: z.string().max(300).optional(),
  MONO_SESSION_SECRET: z.string().max(1024).optional(),
  MONO_OPENAI_API_KEY: z.string().max(1024).optional(),
  MONO_BOT_WEBHOOK_URL: z.string().max(2048).optional(),
  MONO_BOT_ALLOWED_HOST: z.string().max(253).optional(),
  MONO_BOT_WEBHOOK_KEY: z.string().max(1024).optional(),
  MONO_BOT_AUTHORIZATION: z.string().max(1200).optional(),
  MONO_CALLBACKS_ENABLED: z.enum(["true", "false", ""]).optional(),
  MONO_REPORTING_ENABLED: z.enum(["true", "false", ""]).optional(),
  VERCEL: z.string().optional(),
  VERCEL_ENV: z.string().optional(),
  VERCEL_URL: z.string().max(253).optional(),
});
export type MonoEnvironment = z.infer<typeof monoEnvironmentSchema>;

/** Never derive a trust boundary from request Host/forwarded headers. */
export function resolveMonoOrigin(
  env: MonoEnvironment,
  allowLocal = false,
): string | null {
  let configured = env.MONO_SITE_ORIGIN;
  if (!configured && env.VERCEL_ENV === "preview" && env.VERCEL_URL) {
    if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.vercel\.app$/i.test(env.VERCEL_URL))
      throw new Error("Invalid preview origin");
    configured = `https://${env.VERCEL_URL}`;
  }
  if (!configured) return null;
  const url = new URL(configured);
  const local =
    allowLocal &&
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1"].includes(url.hostname);
  if (
    (!local && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    configured.replace(/\/$/, "") !== url.origin
  )
    throw new Error("Invalid Mono origin");
  return url.origin;
}

export function monoClientIp(
  request: Request,
  env: Pick<MonoEnvironment, "VERCEL"> | NodeJS.ProcessEnv,
): string {
  // Vercel owns this header, unlike visitor-supplied x-forwarded-for through
  // another proxy. https://vercel.com/docs/headers/request-headers
  if (env.VERCEL !== "1") return "unknown";
  const ip = request.headers.get("x-vercel-forwarded-for")?.trim();
  return ip && isIP(ip) ? ip : "unknown";
}
