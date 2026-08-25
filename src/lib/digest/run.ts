import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import { getServerEnv } from "@/lib/env.server";
import { currentDigestPeriod, digestWindowStart } from "@/lib/digest/period";
import { unsubscribeSignature } from "@/lib/digest/token";
import { renderDigestHtml, renderDigestText } from "@/lib/digest/render";
import { generateDigestNarrative } from "@/lib/digest/narrative";
import {
  digestBoardRowSchema,
  type DigestBoardRow,
} from "@/lib/validations/digest";

const ORG_LIMIT = 200;
const RECIPIENT_CAP = 200;
const RESEND_BATCH_MAX = 100;
const STALE_CLAIM_MS = 60 * 60 * 1000;

export type DigestRunSummary = {
  processed: number;
  sent: number;
  skipped: number;
  failed: number;
};

type ServiceClient = ReturnType<typeof createServiceClient>;
type Recipient = { userId: string; email: string | null; optOut: boolean };
type Totals = {
  newCount: number;
  incompleteCount: number;
  overdueCount: number;
};

/**
 * Weekly digest pass. Idempotent per (org, ISO week) via digest_runs' unique
 * claim — the daily cron ping retries failed/unclaimed orgs all week. Ordering
 * inside an org is deliberate: email first, notifications after email success
 * (or email-disabled), so a retry can never duplicate notifications.
 */
export async function runWeeklyDigest(
  now: Date = new Date(),
): Promise<DigestRunSummary> {
  const supabase = createServiceClient();
  const period = currentDigestPeriod(now);
  // One period, always — independent of how long digest_runs has been empty.
  const since = digestWindowStart(now).toISOString();
  const summary: DigestRunSummary = {
    processed: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
  };

  const { data: orgs, error: orgsError } = await supabase
    .from("organizations")
    .select("id, name")
    .order("created_at", { ascending: true })
    .limit(ORG_LIMIT);
  if (orgsError)
    throw new Error(`digest: orgs read failed: ${orgsError.message}`);

  for (const org of orgs ?? []) {
    const claimed = await claimRun(supabase, org.id, period, now);
    if (!claimed) {
      summary.skipped += 1;
      continue;
    }
    summary.processed += 1;
    try {
      const outcome = await processOrg(
        supabase,
        org,
        since,
        period,
        claimed.id,
      );
      summary[outcome] += 1;
    } catch (err) {
      summary.failed += 1;
      await supabase
        .from("digest_runs")
        .update({
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
          completed_at: new Date().toISOString(),
        })
        .eq("id", claimed.id);
    }
  }
  return summary;
}

/** Insert the pending claim; on conflict, reclaim only if stale-pending. */
async function claimRun(
  supabase: ServiceClient,
  orgId: string,
  period: { periodStart: string; periodEnd: string },
  now: Date,
): Promise<{ id: string } | null> {
  const { data, error } = await supabase
    .from("digest_runs")
    .insert({
      org_id: orgId,
      period_start: period.periodStart,
      period_end: period.periodEnd,
      status: "pending",
    })
    .select("id")
    .single();
  if (!error) return data;
  if (error.code !== "23505") throw new Error(error.message);

  const { data: existing } = await supabase
    .from("digest_runs")
    .select("id, status, created_at")
    .eq("org_id", orgId)
    .eq("period_start", period.periodStart)
    .single();
  const stale =
    existing?.status === "pending" &&
    existing.created_at !== null &&
    now.getTime() - new Date(existing.created_at).getTime() > STALE_CLAIM_MS;
  if (!existing || !stale) return null;
  // Guarded reclaim: only flips a still-pending row (a concurrent finisher wins).
  const { data: reclaimed } = await supabase
    .from("digest_runs")
    .update({ created_at: now.toISOString() })
    .eq("id", existing.id)
    .eq("status", "pending")
    .select("id")
    .single();
  return reclaimed ?? null;
}

async function processOrg(
  supabase: ServiceClient,
  org: { id: string; name: string },
  since: string,
  period: { periodStart: string },
  runId: string,
): Promise<"sent" | "skipped"> {
  const { data: raw, error } = await supabase.rpc("_org_health_digest", {
    p_org_id: org.id,
    p_since: since,
  });
  if (error) throw new Error(`_org_health_digest: ${error.message}`);

  const boards: DigestBoardRow[] = (raw ?? []).map((r) =>
    digestBoardRowSchema.parse({
      boardId: r.board_id,
      boardName: r.board_name,
      totalItems: r.total_items,
      doneItems: r.done_items,
      overdueItems: r.overdue_items,
      incompleteItems: r.incomplete_items,
      newItems: r.new_items,
      newSample: r.new_sample,
      incompleteSample: r.incomplete_sample,
    }),
  );
  const totals: Totals = boards.reduce(
    (t, b) => ({
      newCount: t.newCount + b.newItems,
      incompleteCount: t.incompleteCount + b.incompleteItems,
      overdueCount: t.overdueCount + b.overdueItems,
    }),
    { newCount: 0, incompleteCount: 0, overdueCount: 0 },
  );

  if (
    totals.newCount === 0 &&
    totals.incompleteCount === 0 &&
    totals.overdueCount === 0
  ) {
    await supabase
      .from("digest_runs")
      .update({
        status: "skipped",
        stats: totals,
        completed_at: new Date().toISOString(),
      })
      .eq("id", runId);
    return "skipped";
  }

  // Members: owner/admin/member (guests excluded — spec Open question 5).
  // org_members → profiles has no declared FK in database.types.ts, so a
  // PostgREST embed won't typecheck; two-query JS join matches the existing
  // pattern in getWidgetSeries / listOrgMembersCached.
  const { data: members, error: mErr } = await supabase
    .from("org_members")
    .select("user_id, role")
    .eq("org_id", org.id)
    .in("role", ["owner", "admin", "member"])
    .limit(RECIPIENT_CAP);
  if (mErr) throw new Error(`members read: ${mErr.message}`);
  const userIds = (members ?? []).map((m) => m.user_id);

  const profileById = new Map<
    string,
    { email: string | null; optOut: boolean }
  >();
  if (userIds.length > 0) {
    const { data: profiles, error: pErr } = await supabase
      .from("profiles")
      .select("id, email, email_digest_opt_out")
      .in("id", userIds);
    if (pErr) throw new Error(`profiles read: ${pErr.message}`);
    for (const p of profiles ?? [])
      profileById.set(p.id, {
        email: p.email,
        optOut: p.email_digest_opt_out,
      });
  }
  const recipients: Recipient[] = userIds.map((id) => ({
    userId: id,
    email: profileById.get(id)?.email ?? null,
    optOut: profileById.get(id)?.optOut ?? false,
  }));

  const narrative = await generateDigestNarrative(org.id, boards, totals);

  // 1) Email first (skipped entirely when the provider isn't configured).
  const emailSentCount = await sendEmails(
    org,
    boards,
    totals,
    period,
    recipients,
    narrative,
  );

  // 2) Notifications after email success — a retry can't duplicate them.
  const payload = {
    ...totals,
    periodStart: period.periodStart,
    ...(narrative ? { narrative } : {}),
  };
  const rows = recipients.map((r) => ({
    org_id: org.id,
    recipient_id: r.userId,
    actor_id: null,
    kind: "health_digest" as const,
    payload,
  }));
  if (rows.length > 0) {
    const { error: nErr } = await supabase.from("notifications").insert(rows);
    if (nErr) throw new Error(`notifications insert: ${nErr.message}`);
  }

  await supabase
    .from("digest_runs")
    .update({
      status: "sent",
      stats: { ...totals, boards: boards.length },
      email_sent_count: emailSentCount,
      narrative,
      completed_at: new Date().toISOString(),
    })
    .eq("id", runId);
  return "sent";
}

/** Returns the number of emails accepted by Resend; 0 in in-app-only mode. */
async function sendEmails(
  org: { name: string },
  boards: DigestBoardRow[],
  totals: Totals,
  period: { periodStart: string },
  recipients: Recipient[],
  narrative: string | null,
): Promise<number> {
  const { RESEND_API_KEY, DIGEST_SECRET, APP_BASE_URL, DIGEST_FROM_EMAIL } =
    getServerEnv();
  if (!RESEND_API_KEY || !DIGEST_SECRET || !APP_BASE_URL) return 0;
  const from = DIGEST_FROM_EMAIL ?? `digest@${new URL(APP_BASE_URL).hostname}`;

  const emailable = recipients.filter((r) => r.email !== null && !r.optOut);
  const messages = emailable.map((r) => {
    const unsubscribeUrl = `${APP_BASE_URL}/api/digest/unsubscribe?uid=${r.userId}&sig=${unsubscribeSignature(DIGEST_SECRET, r.userId)}`;
    const input = {
      orgName: org.name,
      periodStart: period.periodStart,
      totals,
      boards,
      appBaseUrl: APP_BASE_URL,
      unsubscribeUrl,
      ...(narrative ? { narrative } : {}),
    };
    return {
      from,
      to: [r.email as string],
      subject: `Your weekly ${org.name} plan health digest`,
      html: renderDigestHtml(input),
      text: renderDigestText(input),
      headers: { "List-Unsubscribe": `<${unsubscribeUrl}>` },
    };
  });

  for (let i = 0; i < messages.length; i += RESEND_BATCH_MAX) {
    const chunk = messages.slice(i, i + RESEND_BATCH_MAX);
    const res = await fetch("https://api.resend.com/emails/batch", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(chunk),
    });
    if (!res.ok) {
      throw new Error(`resend batch failed: ${res.status} ${await res.text()}`);
    }
  }
  return messages.length;
}
