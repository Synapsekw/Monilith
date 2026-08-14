import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { getServerEnv } from "@/lib/env.server";
import { unsubscribeSignature } from "@/lib/digest/token";
import { renderBriefingHtml, renderBriefingText } from "./briefing-render";
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
  args: {
    agent: UserAgentRow;
    /** The fire date this run covers, `YYYY-MM-DD`. Was `briefing.today`. */
    fireDate: string;
    /** The agent's OWN report of what it did — `runAgentLoop`'s text. */
    summary: string;
    /** How many actions the run queued for the owner to approve. */
    proposalCount: number;
    threadId?: string | null;
  },
): Promise<{ emailed: boolean }> {
  const { agent, fireDate, summary, proposalCount, threadId } = args;
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
    // SECURITY: same rule as unsubscribeUrl — this is APP_BASE_URL plus a uuid
    // and nothing else. Never interpolate agent.name, instructions, or item
    // text into a URL that briefing-render.ts does not HTML-escape.
    const threadUrl = threadId ? `${APP_BASE_URL}/ask/${threadId}` : undefined;
    const input = {
      agentName: agent.name,
      today: fireDate,
      appBaseUrl: APP_BASE_URL as string,
      unsubscribeUrl,
      threadUrl,
      summary,
      proposalCount,
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
        subject: `${agent.name}: your briefing for ${fireDate}`,
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
    // The overdue/today/week tallies are gone with the fixed briefing payload:
    // the agent now decides what its run is ABOUT, so there is no longer a
    // fixed set of counts to report. `proposalCount` replaces them because it
    // is the one number that demands an action from the recipient.
    payload: { agentName: agent.name, proposalCount },
  });
  if (notifyError) throw new Error(`sendBriefingEmail: ${notifyError.message}`);

  return { emailed };
}
