import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getServerEnv } from "@/lib/env.server";
import { runWeeklyDigest } from "@/lib/digest/run";
import { recordDigestBlocked } from "@/lib/digest/blocked";

/** Constant-time bearer check — the secret is never logged. */
function authorized(req: Request, secret: string): boolean {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(token);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Cron target for the weekly health digest (pg_cron → pg_net → here, daily at
 * 07:00 UTC). Idempotent per (org, ISO week) via the digest_runs claim, so the
 * daily ping is a cheap no-op after a successful send and an automatic retry
 * after a failed one.
 *
 * Until DIGEST_SECRET is provisioned this 503s — and files a `blocked` run so
 * the outage is visible in the ledger instead of looking like a quiet week. A
 * wrong token is NOT recorded: that is an unauthenticated caller's problem, not
 * a provisioning gap, and recording it would let anyone write the ledger.
 */
export async function POST(req: Request) {
  const env = getServerEnv();
  if (!env.DIGEST_SECRET) {
    await recordDigestBlocked("DIGEST_SECRET is not configured");
    return NextResponse.json(
      { error: "digest not provisioned", status: "blocked" },
      { status: 503 },
    );
  }
  if (!authorized(req, env.DIGEST_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const summary = await runWeeklyDigest();
  return NextResponse.json(summary);
}
