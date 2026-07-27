import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import { currentDigestPeriod } from "@/lib/digest/period";

/**
 * File a `blocked` run in the digest ledger when the digest cannot start because
 * it is not provisioned.
 *
 * Why this exists: production went three weeks without a single digest and
 * nothing said so. `_health_digest_ping` raised a NOTICE (persisted nowhere) and
 * pg_cron recorded the job as `succeeded`, while `digest_runs` stayed empty —
 * indistinguishable from "no orgs needed a digest". A `blocked` row makes the
 * skip a fact you can query, and the warn makes it a fact you can grep.
 *
 * Never throws: observability must not become the reason a run fails. A partial
 * unique index on `(period_start) where org_id is null` bounds this to one row
 * per ISO week, so the duplicate-key conflict is the normal path from day two
 * onward — and an unauthenticated caller cannot grow the table.
 */
export async function recordDigestBlocked(
  reason: string,
  now: Date = new Date(),
): Promise<void> {
  console.warn(`[digest] run blocked — no digest will be sent: ${reason}`);

  const period = currentDigestPeriod(now);
  try {
    const { error } = await createServiceClient().from("digest_runs").insert({
      org_id: null,
      period_start: period.periodStart,
      period_end: period.periodEnd,
      status: "blocked",
      error: reason,
      completed_at: now.toISOString(),
    });
    // 23505 = already recorded for this period; that is the expected steady state.
    if (error && error.code !== "23505") {
      console.error(`[digest] could not record blocked run: ${error.message}`);
    }
  } catch (err) {
    console.error(
      `[digest] could not record blocked run: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}
