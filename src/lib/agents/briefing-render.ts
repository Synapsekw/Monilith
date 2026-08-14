/**
 * Email-safe run report: inline styles, light-mode only, every user-provided
 * string escaped. Visual language matches `lib/digest/render.ts` and the
 * branded auth templates — dark ink on white, minimal chrome.
 *
 * Pure and dependency-free so it is trivially unit-testable.
 *
 * WHAT CHANGED WITH THE TOOL LOOP: there is no longer an item TABLE to render.
 * The agent no longer receives a pre-built briefing payload — it reads what it
 * needs through tools and writes its own report — so the email carries the
 * model's prose, plus a pointer to anything the agent asked permission for.
 * `summary` is still untrusted (it is model output over item names authored by
 * other people) and is still escaped before it reaches the HTML.
 */

export type BriefingEmailInput = {
  agentName: string;
  /** The fire date this run covers, `YYYY-MM-DD`. */
  today: string;
  /** The model's own report of what it did. Untrusted; escaped below. */
  summary: string;
  /**
   * How many actions the run wanted to take but held no grant for. Zero on the
   * overwhelmingly common path, and the whole approval block is omitted then —
   * an email that says "0 actions await your approval" trains people to ignore
   * the line that matters.
   */
  proposalCount: number;
  appBaseUrl: string;
  unsubscribeUrl: string;
  /**
   * Deep link to the thread this report was posted into, or undefined when
   * the write failed and there is nothing to link to. SECURITY: built
   * upstream (send.ts) from APP_BASE_URL plus a uuid and nothing else — not
   * HTML-escaped here for the same reason unsubscribeUrl isn't: nothing
   * user-editable ever reaches it.
   */
  threadUrl?: string;
};

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * The one sentence that tells an owner a run is waiting on them, in two halves
 * because the HTML emphasises the first and the text alternative cannot.
 *
 * BOTH renderers build from these — the HTML used to inline the same words and
 * the shared helper's "cannot drift" claim was simply false, which is worse
 * than no helper at all: it invites an edit here on the belief that both
 * alternatives of the email will follow.
 */
export function approvalHeadline(count: number): string {
  return `${count} actions await your approval.`;
}

export const APPROVAL_CTA = "Open the run in Settings → Agents to review them.";

/** The plain-text form: both halves, one sentence. */
export function approvalLine(count: number): string {
  return `${approvalHeadline(count)} ${APPROVAL_CTA}`;
}

export function renderBriefingHtml(input: BriefingEmailInput): string {
  const {
    agentName,
    today,
    summary,
    proposalCount,
    appBaseUrl,
    unsubscribeUrl,
    threadUrl,
  } = input;

  const approval =
    proposalCount > 0
      ? `\n  <p style="font-size:14px;color:#333;line-height:1.5;background:#f6f6fb;border-left:3px solid #5b6fd6;padding:10px 12px;margin:16px 0;"><strong>${escapeHtml(approvalHeadline(proposalCount))}</strong> ${escapeHtml(APPROVAL_CTA)}</p>`
      : "";

  return `<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:640px;margin:0 auto;padding:24px;background:#fff;">
  <p style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#999;margin:0 0 4px;">${escapeHtml(agentName)}</p>
  <h1 style="font-size:20px;margin:0 0 12px;color:#111;">Your briefing for ${escapeHtml(today)}</h1>
  <p style="font-size:14px;color:#333;line-height:1.5;">${escapeHtml(summary)}</p>${approval}
  <p style="margin-top:28px;font-size:12px;color:#888;">
    ${threadUrl ? `<a href="${threadUrl}" style="color:#5b6fd6;">Open this briefing</a>\n    &middot; ` : ""}<a href="${appBaseUrl}/my-work" style="color:#5b6fd6;">Open My Work</a>
    &middot; <a href="${unsubscribeUrl}" style="color:#888;">Unsubscribe from briefings</a>
  </p>
</div>`;
}

export function renderBriefingText(input: BriefingEmailInput): string {
  const {
    agentName,
    today,
    summary,
    proposalCount,
    unsubscribeUrl,
    threadUrl,
  } = input;
  const lines: string[] = [
    `${agentName} — briefing for ${today}`,
    "",
    summary,
    "",
  ];
  if (proposalCount > 0) {
    lines.push(approvalLine(proposalCount), "");
  }
  if (threadUrl) {
    lines.push(`Open this briefing: ${threadUrl}`);
  }
  lines.push(`Unsubscribe: ${unsubscribeUrl}`);
  return lines.join("\n");
}
