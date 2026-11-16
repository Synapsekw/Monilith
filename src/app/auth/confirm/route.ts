import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { INVITE_SET_PASSWORD_PATH } from "@/lib/auth/invite-paths";

/**
 * Landing route for the link in the INVITE email
 * (`supabase/templates/invite.html`):
 *
 *   /auth/confirm?token_hash=<hash>&type=invite
 *
 * `inviteUserByEmail` runs with the service role, so there is no PKCE code
 * verifier in the invitee's browser and `/auth/callback` (which handles only
 * `?code=`) cannot finish it: the default link ends with the session in the URL
 * fragment, which a server never sees. Verifying the token hash here is the
 * documented server-side flow: `verifyOtp` creates the session and writes its
 * cookies through the server client.
 *
 * The invited account has no password yet, so it goes straight to the
 * set-password step. Approval and invitation redemption are NOT done here:
 * after the password is saved the person lands on `/pending-approval` (an
 * invited outsider still waits for a platform admin), and the existing setup
 * (`finishAccountSetup`) redeems the invitation once they are approved.
 *
 * Only `type=invite` is accepted. Signup confirmation and password recovery
 * keep using `/auth/callback`.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");

  const bounce = () =>
    NextResponse.redirect(new URL("/login?error=invite_link", origin));

  if (!tokenHash || type !== "invite") return bounce();

  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({
    type: "invite",
    token_hash: tokenHash,
  });
  // Expired, already used, or forged: no session was created.
  if (error || !data.user) return bounce();

  return NextResponse.redirect(new URL(INVITE_SET_PASSWORD_PATH, origin));
}
