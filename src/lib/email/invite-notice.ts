import { escapeHtml } from "@/lib/digest/render";

export type InviteNoticeInput = {
  /** Display name of the person who sent the invitation, when known. */
  inviterName?: string | null;
  orgName?: string | null;
  /** Set when the invitation is to one folder rather than the whole org. */
  folderName?: string | null;
  /** Absolute app origin, no trailing slash. */
  appBaseUrl: string;
};

/** "Ann invited you to the folder Launch in Acme" (plain text, unescaped). */
export function inviteNoticeHeadline(input: InviteNoticeInput): string {
  const who = input.inviterName?.trim() || "Someone";
  const org = input.orgName?.trim() || "an organization";
  return input.folderName?.trim()
    ? `${who} invited you to the folder ${input.folderName.trim()} in ${org}`
    : `${who} invited you to ${org}`;
}

/**
 * The email for an invitee who ALREADY has an account. Supabase sends its
 * invite email only to new addresses, so without this an existing user got
 * nothing. They accept from the notifications bell after signing in, so the
 * link goes to the app, not to a one-time token.
 */
export function renderInviteNotice(input: InviteNoticeInput): {
  subject: string;
  html: string;
  text: string;
} {
  const headline = inviteNoticeHeadline(input);
  const url = `${input.appBaseUrl}/home`;
  const body =
    "Sign in to MONOLITH and open your notifications to accept or decline the invitation.";
  const footer =
    "If you weren't expecting this invitation, you can safely ignore this email.";

  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:40px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;background-color:#ffffff;border:1px solid #e4e4e7;border-radius:14px;overflow:hidden;">
            <tr>
              <td style="padding:32px 36px 8px 36px;">
                <img src="${escapeHtml(input.appBaseUrl)}/email/monolith-logo@2x.png" alt="MONOLITH" width="160" style="display:block;border:0;outline:none;text-decoration:none;height:auto;" />
              </td>
            </tr>
            <tr>
              <td style="padding:16px 36px 0 36px;">
                <h1 style="margin:0;font-size:20px;line-height:28px;font-weight:700;color:#18181b;">${escapeHtml(headline)}</h1>
                <p style="margin:12px 0 0 0;font-size:15px;line-height:24px;color:#52525b;">${body}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 36px 8px 36px;">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td align="center" style="border-radius:10px;background-color:#18181b;">
                      <a href="${escapeHtml(url)}" target="_blank" style="display:inline-block;padding:12px 28px;font-size:15px;font-weight:600;line-height:20px;color:#ffffff;text-decoration:none;border-radius:10px;">Open MONOLITH</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 36px 32px 36px;">
                <hr style="border:none;border-top:1px solid #e4e4e7;margin:0 0 16px 0;" />
                <p style="margin:0;font-size:12px;line-height:18px;color:#a1a1aa;">${footer}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return {
    subject: headline,
    html,
    text: `${headline}\n\n${body}\n\n${url}\n\n${footer}\n`,
  };
}
