export type RunActionOutcome = { type: string; outcome: string };

/** Relative "x min ago" using Intl.RelativeTimeFormat. `nowMs` injectable for tests. */
export function timeAgo(iso: string, nowMs: number = Date.now()): string {
  const diffSec = Math.round((nowMs - new Date(iso).getTime()) / 1000);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];
  for (const [unit, secs] of units) {
    if (Math.abs(diffSec) >= secs)
      return rtf.format(-Math.floor(diffSec / secs), unit);
  }
  return "just now";
}

const NOTIFY: Record<string, string> = {
  sent: "notified",
  skipped_dup: "already notified",
  skipped_no_recipient: "no recipient",
  skipped_self: "skipped (self)",
};
const SET_OPTION: Record<string, string> = {
  set: "set status",
  skipped_equal: "status unchanged",
};

function describeAction(a: RunActionOutcome): string {
  if (a.type === "notify") return NOTIFY[a.outcome] ?? a.outcome;
  if (a.type === "set_option") return SET_OPTION[a.outcome] ?? a.outcome;
  return `${a.type}: ${a.outcome}`;
}

/** Human one-liner for a run's outcome. */
export function formatRunSummary(
  status: string,
  actions: RunActionOutcome[],
): string {
  if (status === "blocked") return "Condition not met — skipped";
  if (status === "error") return "Error while running";
  if (!actions.length) return "Ran, no actions";
  return actions.map(describeAction).join(" · ");
}
