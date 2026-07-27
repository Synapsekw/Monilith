/** The UTC Monday..Sunday week containing `now`. The digest's stats window is a
 * trailing 7 days at send time; this period is only the idempotency key
 * (digest_runs unique (org_id, period_start)). */
export type DigestPeriod = { periodStart: string; periodEnd: string };

/** One period. The digest reports this much activity and no more. */
export const DIGEST_WINDOW_DAYS = 7;

/**
 * Start of the window the digest reports on — always exactly one period back.
 *
 * Deliberately a pure function of `now`: it is NOT derived from the previous
 * `digest_runs` row. That is the whole safety property. With `digest_runs`
 * empty — a fresh org, or a deployment where `digest_secret` was never
 * provisioned — the first run reports the current period only, never a replay
 * of everything since the feature shipped.
 */
export function digestWindowStart(now: Date = new Date()): Date {
  return new Date(now.getTime() - DIGEST_WINDOW_DAYS * 24 * 60 * 60 * 1000);
}

export function currentDigestPeriod(now: Date = new Date()): DigestPeriod {
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const sinceMonday = (d.getUTCDay() + 6) % 7; // Mon=0 .. Sun=6
  d.setUTCDate(d.getUTCDate() - sinceMonday);
  const periodStart = d.toISOString().slice(0, 10);
  d.setUTCDate(d.getUTCDate() + 6);
  return { periodStart, periodEnd: d.toISOString().slice(0, 10) };
}
