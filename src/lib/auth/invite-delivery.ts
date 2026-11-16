import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { INVITE_CONFIRM_PATH } from "@/lib/auth/invite-paths";
import { getAppOrigin } from "@/lib/auth/origin";
import { renderInviteNotice } from "@/lib/email/invite-notice";
import { sendEmail } from "@/lib/email/send";
import type { Database } from "@/types/database.types";

/**
 * What actually reached the invitee:
 * - `invite_email`: a new address; Supabase sent the invite email (the link
 *   creates their session and takes them to set a password).
 * - `notice_email`: the address already has an account; we emailed them a
 *   notice, and the invitation waits in their notifications.
 * - `in_app`: the address already has an account and no email went out (email
 *   is not configured, or the send failed); the invitation waits in their
 *   notifications only.
 * - `failed`: a new address, and the invite email could not be sent.
 */
export type InviteDelivery =
  "invite_email" | "notice_email" | "in_app" | "failed";

export type InviteContext = {
  email: string;
  inviterName?: string | null;
  orgName?: string | null;
  folderName?: string | null;
  /** Prefix for the server log line, e.g. "inviteToFolder". */
  scope: string;
};

/** The inviter's display name for an email: their name, else their email. */
export function inviterLabel(
  user:
    | { email?: string | null; user_metadata?: Record<string, unknown> | null }
    | null
    | undefined,
): string | null {
  const meta = user?.user_metadata ?? {};
  for (const value of [meta.full_name, meta.name, user?.email]) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function isAlreadyRegistered(error: { message: string; code?: string }) {
  return (
    error.code === "email_exists" || /already.*regist/i.test(error.message)
  );
}

/**
 * Tell an invited person about an invitation that is ALREADY recorded. Never
 * throws and never fails the invite: the invitation row is the source of
 * truth and is redeemed on sign-in whatever happens here.
 *
 * `svc` must be the service-role client (the auth admin API); the caller has
 * already verified the inviter's permission.
 */
export async function deliverInvite(
  svc: SupabaseClient<Database>,
  ctx: InviteContext,
): Promise<InviteDelivery> {
  const origin = await getAppOrigin();
  const { error } = await svc.auth.admin.inviteUserByEmail(ctx.email, {
    // The hosted email template builds the link itself from the token hash
    // (supabase/templates/invite.html); this is the same destination, kept in
    // the allow-list so `{{ .RedirectTo }}` is usable too.
    redirectTo: `${origin}${INVITE_CONFIRM_PATH}`,
  });
  if (!error) return "invite_email";

  if (!isAlreadyRegistered(error)) {
    console.error(`[${ctx.scope}] invite email delivery failed`, {
      error: error.message,
    });
    return "failed";
  }

  // Supabase emails only new addresses. Someone who already has an account
  // gets our own notice, when email is configured.
  const sent = await sendEmail({
    to: ctx.email,
    ...renderInviteNotice({
      inviterName: ctx.inviterName,
      orgName: ctx.orgName,
      folderName: ctx.folderName,
      appBaseUrl: origin,
    }),
  });
  return sent === "sent" ? "notice_email" : "in_app";
}
