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
 * (`src/lib/digest/run.ts`): email first; an in-app notification would be
 * written only after the email succeeds (or when email is disabled), so a
 * retried run can never produce a duplicate notification.
 *
 * BLOCKED — the in-app notification is NOT written yet (2026-08-01):
 * `notifications.kind` is the Postgres enum `public.notification_kind`
 * (created in `supabase/migrations/20260617100000_notifications.sql`), and
 * its current values — confirmed both in that migration and in the
 * generated `Database["public"]["Enums"]["notification_kind"]` union in
 * `src/types/database.types.ts` — are only:
 *   'mention' | 'assigned' | 'update_on_item' | 'automation'
 *   | 'feedback_response' | 'health_digest' | 'account_deleted'
 * There is no `'agent_briefing'` value. Adding one needs its own migration
 * (`alter type public.notification_kind add value if not exists
 * 'agent_briefing';`), which is out of this task's scope — Task 9 owns only
 * route.ts/summarise.ts/send.ts, not `supabase/migrations/` (sibling tasks
 * are actively editing that directory in this same worktree). Writing the
 * insert anyway would either fail typecheck (the generated Insert type is a
 * closed union, not a plain string) or, if cast away with `as never`, fail
 * at runtime on every real send — AFTER the email has already gone out —
 * which would misreport a successful send as `status: "error"` in the
 * `user_agent_runs` audit row. So this function ships the real, user-visible
 * behaviour (the email) and intentionally defers the supplementary in-app
 * notification. Once the enum migration lands, add back here, right after
 * the `emailed` block:
 *
 *   const { error: notifyError } = await svc.from("notifications").insert({
 *     recipient_id: agent.owner_id,
 *     org_id: agent.org_id,
 *     actor_id: null,
 *     kind: "agent_briefing",
 *     payload: {
 *       agentName: agent.name,
 *       overdue: briefing.totals.overdue,
 *       today: briefing.totals.today,
 *       week: briefing.totals.week,
 *     },
 *   });
 *   if (notifyError) throw new Error(`sendBriefingEmail: ${notifyError.message}`);
 *
 * (Column is `recipient_id`, not `user_id` — the brief's sample used the
 * wrong column name; `notifications` has no `user_id` column, see the
 * migration above.)
 *
 * On an environment with no RESEND_API_KEY (currently production) this
 * sends nothing — deliberately not an error.
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

  return { emailed };
}
