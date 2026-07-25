import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { provisionAccountForUser } from "@/lib/auth/provision";
import { redeemInvitationsForUser } from "@/lib/auth/redeem";
import { safeNextPath } from "@/lib/auth/next-path";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data.user) {
      // Redeem invitations FIRST; only self-provision a new org if none were redeemed.
      const redeemed = await redeemInvitationsForUser(supabase);
      if (redeemed === 0) {
        const { error: provisionError } = await provisionAccountForUser(
          supabase,
          data.user,
        );
        // A failed provision leaves the user with zero orgs. Don't drop them
        // into a broken empty app shell — send them to a login page that
        // renders an actionable error instead of silently redirecting to `next`.
        // Carry `next` through so re-signing in still resumes the original
        // destination (e.g. an in-flight OAuth authorize request).
        if (provisionError) {
          const bounce = new URL("/login", origin);
          bounce.searchParams.set("error", "provisioning");
          if (next !== "/") bounce.searchParams.set("next", next);
          return NextResponse.redirect(bounce);
        }
      }
    }
  }

  return NextResponse.redirect(new URL(next, origin));
}
