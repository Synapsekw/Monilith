import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { provisionAccountForUser } from "@/lib/auth/provision";
import { redeemInvitationsForUser } from "@/lib/auth/redeem";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data.user) {
      // Redeem invitations FIRST; only self-provision a new org if none were redeemed.
      const redeemed = await redeemInvitationsForUser(supabase);
      if (redeemed === 0) {
        await provisionAccountForUser(supabase, data.user);
      }
    }
  }

  return NextResponse.redirect(new URL(next, origin));
}
