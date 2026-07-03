/** The UTC Monday..Sunday week containing `now`. The digest's stats window is a
 * trailing 7 days at send time; this period is only the idempotency key
 * (digest_runs unique (org_id, period_start)). */
export type DigestPeriod = { periodStart: string; periodEnd: string };

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
