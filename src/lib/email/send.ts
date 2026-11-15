import "server-only";
import { getServerEnv } from "@/lib/env.server";

export type SendEmailResult = "sent" | "disabled" | "failed";

const SEND_TIMEOUT_MS = 8000;

/**
 * Send one transactional email through Resend (the same provider and sender
 * rule as the weekly digest in `src/lib/digest/run.ts`).
 *
 * Email is an optional feature: without `RESEND_API_KEY` and `APP_BASE_URL`
 * this returns "disabled" and sends nothing. It never throws — a provider
 * error, a timeout or a network failure is "failed" — so the action that
 * called it can carry on with its in-app path.
 */
export async function sendEmail(message: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<SendEmailResult> {
  const { RESEND_API_KEY, APP_BASE_URL, DIGEST_FROM_EMAIL } = getServerEnv();
  if (!RESEND_API_KEY || !APP_BASE_URL) return "disabled";
  const from = DIGEST_FROM_EMAIL ?? `digest@${new URL(APP_BASE_URL).hostname}`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error("[sendEmail] provider refused the message", {
        status: res.status,
      });
      return "failed";
    }
    return "sent";
  } catch (err) {
    console.error("[sendEmail] request failed", {
      error: err instanceof Error ? err.message : "unknown",
    });
    return "failed";
  }
}
