export type TimeEntryLike = {
  started_at: string;
  ended_at: string | null;
  duration_secs: number | null;
};

/**
 * Parse a human duration into seconds. Accepts "1h 30m", "90m", "1.5h",
 * "2:30" (h:mm), and a bare number (minutes). Returns null on empty / junk /
 * non-positive input. Pure.
 */
export function parseDuration(input: string): number | null {
  const s = input.trim().toLowerCase();
  if (!s) return null;

  // h:mm clock form
  const clock = /^(\d+):([0-5]?\d)$/.exec(s);
  if (clock) {
    const secs = Number(clock[1]) * 3600 + Number(clock[2]) * 60;
    return secs > 0 ? secs : null;
  }

  // bare number ⇒ minutes
  if (/^\d+(\.\d+)?$/.test(s)) {
    const secs = Math.round(Number(s) * 60);
    return secs > 0 ? secs : null;
  }

  // h/m units, in any order
  let secs = 0;
  let matched = false;
  for (const m of s.matchAll(/(\d+(?:\.\d+)?)\s*([hm])/g)) {
    matched = true;
    const n = Number(m[1]);
    secs += m[2] === "h" ? n * 3600 : n * 60;
  }
  if (!matched) return null;
  secs = Math.round(secs);
  return secs > 0 ? secs : null;
}

/** Format seconds as "2h 45m" / "4h" / "15m" (drops zero parts). Pure. */
export function formatDuration(totalSecs: number): string {
  const secs = Math.max(0, Math.floor(totalSecs));
  const h = Math.floor(secs / 3600);
  const m = Math.round((secs % 3600) / 60);
  const parts: string[] = [];
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  return parts.length ? parts.join(" ") : "0m";
}

/**
 * Total tracked seconds for a set of entries: completed durations plus the live
 * elapsed time of any running entry (ended_at null), computed against `nowMs`.
 * Pure — caller supplies the clock so it stays testable.
 */
export function trackedSeconds(
  entries: readonly TimeEntryLike[],
  nowMs: number,
): number {
  let total = 0;
  for (const e of entries) {
    if (e.ended_at == null) {
      total += Math.max(
        0,
        Math.floor((nowMs - Date.parse(e.started_at)) / 1000),
      );
    } else {
      total += e.duration_secs ?? 0;
    }
  }
  return total;
}
