import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { provisionAccountForUser } from "@/lib/auth/provision";
import { redeemInvitationsForUser } from "@/lib/auth/redeem";

/**
 * Sanitize the `next` redirect target. Only same-origin, absolute-path
 * destinations are allowed — everything else falls back to "/". This closes an
 * open-redirect: `?next=//evil.com`, `?next=/\evil.com`, and any absolute URL
 * (`https://evil.com`) would otherwise resolve off-site through
 * `new URL(next, origin)`.
 */
export function safeNextPath(next: string | null): string {
  if (!next) return "/";
  // Must start with a single "/" — reject "//host" (protocol-relative) and
  // "/\host" (browsers normalize backslashes to slashes). Reject anything that
  // isn't rooted at "/" (e.g. "https://evil.com", "evil.com").
  if (!next.startsWith("/")) return "/";
  if (next.startsWith("//")) return "/";
  if (next.startsWith("/\\")) return "/";
  return next;
}

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
        if (provisionError) {
          return NextResponse.redirect(
            new URL("/login?error=provisioning", origin),
          );
        }
      }
    }
  }

  return NextResponse.redirect(new URL(next, origin));
}
