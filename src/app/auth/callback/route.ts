import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  resolveAccountApproval,
  PENDING_APPROVAL_PATH,
  type ApprovalStatus,
} from "@/lib/auth/approval";
import { finishAccountSetup } from "@/lib/auth/finish-setup";
import { safeNextPath } from "@/lib/auth/next-path";

function isChangePasswordPath(next: string): boolean {
  return (
    next === "/change-password" ||
    next.startsWith("/change-password?") ||
    next.startsWith("/change-password/")
  );
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"));

  // Send the user to a login page that renders an actionable error instead of
  // silently redirecting to `next`. Carry `next` through so re-signing in still
  // resumes the original destination (e.g. an in-flight OAuth authorize request).
  const provisioningBounce = () => {
    const bounce = new URL("/login", origin);
    bounce.searchParams.set("error", "provisioning");
    if (next !== "/") bounce.searchParams.set("next", next);
    return NextResponse.redirect(bounce);
  };

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data.user) {
      // An account not yet approved by a platform admin skips setup entirely
      // (the membership trigger would refuse its org anyway) and waits. A
      // failed status read never lets the account through.
      let status: ApprovalStatus;
      try {
        status = await resolveAccountApproval(data.user.id);
      } catch {
        return provisioningBounce();
      }
      if (status !== "approved") {
        // A password-recovery link must still reach /change-password: bouncing
        // it to the waiting screen would swallow it. `next` is already the
        // output of safeNextPath (same-origin, rooted); no setup runs.
        if (isChangePasswordPath(next)) {
          return NextResponse.redirect(new URL(next, origin));
        }
        return NextResponse.redirect(new URL(PENDING_APPROVAL_PATH, origin));
      }

      // Redeem invitations FIRST; only self-provision a new org if none were
      // redeemed. A failed provision leaves the user with zero orgs — don't
      // drop them into a broken empty app shell.
      const setup = await finishAccountSetup(data.user, supabase);
      if (!setup.ok) return provisioningBounce();
    }
  }

  return NextResponse.redirect(new URL(next, origin));
}
