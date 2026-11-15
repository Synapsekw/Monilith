import "server-only";
import { headers } from "next/headers";
import { getServerEnv } from "@/lib/env.server";

/**
 * The canonical origin used to build links we put in emails (confirmation,
 * recovery, invitations).
 *
 * Security: the `Origin`/`Host` request headers are client-controllable, so a
 * poisoned host could make an emailed link point at an attacker origin. We
 * therefore PREFER the operator-set `APP_BASE_URL` env, which is not
 * attacker-controllable. We fall back to the request headers ONLY when
 * `APP_BASE_URL` is unset — this keeps local dev and Vercel preview deployments
 * working, where the per-deployment URL isn't known ahead of time (and those
 * origins are trusted). In production, set `APP_BASE_URL` to the canonical app
 * URL so the header path is never taken.
 */
export async function getAppOrigin(): Promise<string> {
  const configured = getServerEnv().APP_BASE_URL;
  if (configured) return configured.replace(/\/+$/, "");

  const headerStore = await headers();
  const origin = headerStore.get("origin");
  if (origin) return origin;

  const host = headerStore.get("host") ?? "localhost:3000";
  const protocol = host.startsWith("localhost") ? "http" : "https";
  return `${protocol}://${host}`;
}
