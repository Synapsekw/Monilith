import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { getServerEnv } from "@/lib/env.server";
import { unsubscribeSignature } from "@/lib/digest/token";
import { renderBriefingHtml, renderBriefingText } from "./briefing-render";
import type { Briefing } from "./briefing";
import type { UserAgentRow } from "./agents-db";

/**
 * Deliver one agent's briefing. Ordering mirrors `runWeeklyDigest`
 * (`src/lib/digest/run.ts`): email first, in-app notification only after the
 * email succeeds (or when email is disabled) — so a retried run can never
 * produce a duplicate notification.
 *
 * `notifications.kind` gained `'agent_briefing'` via
 * `supabase/migrations/20260801095917_agent_briefing_notification_kind.sql`
 * (applied to DEV; `src/types/database.types.ts` regenerated in 786fe9df),
 * so the insert below is a normal typed write, not a cast.
 *
 * On an environment with no RESEND_API_KEY (currently production) the email
 * half sends nothing — deliberately not an error — and the notification is
 * still written, since it is production's only delivery channel today.
 */
export async function sendBriefingEmail(
  svc: SupabaseClient<Database>,
  args: { agent: UserAgentRow; briefing: Briefing; summary: string },
): Promise<{ emailed: boolean }> {
  const { agent, briefing, summary } = args;
  const { RESEND_API_KEY, DIGEST_SECRET, APP_BASE_URL, DIGEST_FROM_EMAIL } =
    getServerEnv();

  const { data: profile, error } = await svc
    .from("profiles")
    .select("email, email_briefing_opt_out")
    .eq("id", agent.owner_id)
    .maybeSingle();
  if (error) throw new Error(`sendBriefingEmail: ${error.message}`);

  const canEmail =
    Boolean(RESEND_API_KEY && DIGEST_SECRET && APP_BASE_URL) &&
    Boolean(profile?.email) &&
    profile?.email_briefing_opt_out !== true;

  let emailed = false;
  if (canEmail) {
    // SECURITY: this URL is built from APP_BASE_URL + the owner's uuid + an
    // HMAC signature ONLY. Never interpolate agent.name, agent.instructions,
    // or any item text here — briefing-render.ts deliberately does not
    // HTML-escape appBaseUrl/unsubscribeUrl (they're trusted precisely
    // because nothing user-editable ever reaches them; keep it that way).
    const unsubscribeUrl =
      `${APP_BASE_URL}/api/digest/unsubscribe?uid=${agent.owner_id}` +
      `&kind=briefing&sig=${unsubscribeSignature(DIGEST_SECRET as string, agent.owner_id)}`;
    const input = {
      agentName: agent.name,
      briefing,
      appBaseUrl: APP_BASE_URL as string,
      unsubscribeUrl,
      summary,
    };
    const from =
      DIGEST_FROM_EMAIL ?? `digest@${new URL(APP_BASE_URL as string).hostname}`;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [profile!.email],
        subject: `${agent.name}: your briefing for ${briefing.today}`,
        html: renderBriefingHtml(input),
        text: renderBriefingText(input),
        headers: { "List-Unsubscribe": `<${unsubscribeUrl}>` },
      }),
    });
    if (!res.ok) {
      throw new Error(`resend failed: ${res.status} ${await res.text()}`);
    }
    emailed = true;
  }

  // Notification AFTER email success (or when email is disabled/unconfigured)
  // — never before, so a retried run can't duplicate it. Independent of the
  // recipient's email opt-out: mirrors runWeeklyDigest, which writes
  // notifications for every recipient regardless of their email preference —
  // only the email SEND is gated by opt-out, not the in-app record.
  const { error: notifyError } = await svc.from("notifications").insert({
    recipient_id: agent.owner_id,
    org_id: agent.org_id,
    actor_id: null,
    kind: "agent_briefing",
    payload: {
      agentName: agent.name,
      overdue: briefing.totals.overdue,
      today: briefing.totals.today,
      week: briefing.totals.week,
    },
  });
  if (notifyError) throw new Error(`sendBriefingEmail: ${notifyError.message}`);

  return { emailed };
}
