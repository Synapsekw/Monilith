import { connection, NextResponse } from "next/server";
import { verifyUnsubscribeSignature } from "@/lib/digest/token";
import { getServerEnv } from "@/lib/env.server";
import { createServiceClient } from "@/lib/supabase/service";

const page = (msg: string) => `<!doctype html>
<html><body style="font-family:Helvetica,Arial,sans-serif;padding:48px;color:#111;">
  <h1 style="font-size:18px;">Monolith</h1><p style="font-size:14px;">${msg}</p>
</body></html>`;

/**
 * One-click unsubscribe from the weekly digest email (linked from every
 * digest email + the List-Unsubscribe header). HMAC-gated single-purpose flag
 * flip: no session required (industry norm), can only ever set the opt-out to
 * true, idempotent, reveals no data. Invalid signature → 400, no side effect.
 */
export async function GET(req: Request) {
  // Stop build-time prerendering before touching server env — a GET handler
  // with no detected request-time API otherwise prerenders during `next
  // build`, where CI has no secrets and getServerEnv() fails the build.
  await connection();
  const env = getServerEnv();
  const url = new URL(req.url);
  const uid = url.searchParams.get("uid") ?? "";
  const sig = url.searchParams.get("sig") ?? "";

  if (
    !env.DIGEST_SECRET ||
    !uid ||
    !verifyUnsubscribeSignature(env.DIGEST_SECRET, uid, sig)
  ) {
    return new NextResponse(page("This unsubscribe link is not valid."), {
      status: 400,
      headers: { "Content-Type": "text/html" },
    });
  }

  const supabase = createServiceClient();
  const { error } = await supabase
    .from("profiles")
    .update({ email_digest_opt_out: true })
    .eq("id", uid);
  if (error) {
    return new NextResponse(page("Something went wrong — try again later."), {
      status: 500,
      headers: { "Content-Type": "text/html" },
    });
  }
  return new NextResponse(
    page(
      "You're unsubscribed from the weekly digest email. You can turn it back on any time in Settings.",
    ),
    { status: 200, headers: { "Content-Type": "text/html" } },
  );
}
