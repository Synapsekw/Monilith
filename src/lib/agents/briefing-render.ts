import type { Briefing } from "./briefing";

/**
 * Email-safe briefing body: table layout, inline styles, light-mode only, every
 * user-provided string escaped. Visual language matches `lib/digest/render.ts`
 * and the branded auth templates — dark ink on white, minimal chrome.
 *
 * Pure and dependency-free so it is trivially unit-testable. NOTE: both the item
 * names and the model-written summary are untrusted (item names are authored by
 * other people; the summary is model output over those names), so BOTH are
 * escaped before they reach the HTML.
 */

export type BriefingEmailInput = {
  agentName: string;
  briefing: Briefing;
  appBaseUrl: string;
  unsubscribeUrl: string;
  /**
   * Deep link to the thread this briefing was posted into, or undefined when
   * the write failed and there is nothing to link to. SECURITY: built
   * upstream (send.ts) from APP_BASE_URL plus a uuid and nothing else — not
   * HTML-escaped here for the same reason unsubscribeUrl isn't: nothing
   * user-editable ever reaches it.
   */
  threadUrl?: string;
  /** The model's prose summary of the briefing. */
  summary: string;
};

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const cellStyle = "padding:6px 12px;font-size:13px;color:#333;";

export function renderBriefingHtml(input: BriefingEmailInput): string {
  const {
    agentName,
    briefing,
    appBaseUrl,
    unsubscribeUrl,
    threadUrl,
    summary,
  } = input;

  const sections = briefing.groups
    .map((g) => {
      const rows = g.items
        .map(
          (i) => `<tr>
      <td style="${cellStyle}"><strong>${escapeHtml(i.itemName)}</strong><br />
        <span style="color:#777;">${escapeHtml(i.boardName)}</span></td>
      <td style="${cellStyle}text-align:right;">${escapeHtml(i.dueDate ?? "—")}</td>
    </tr>`,
        )
        .join("");
      return `<h3 style="font-size:14px;margin:20px 0 6px;">${escapeHtml(g.label)}</h3>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>`;
    })
    .join("");

  const empty = `<p style="font-size:14px;color:#555;">Nothing is assigned to you right now.</p>`;

  return `<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:640px;margin:0 auto;padding:24px;background:#fff;">
  <p style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#999;margin:0 0 4px;">${escapeHtml(agentName)}</p>
  <h1 style="font-size:20px;margin:0 0 12px;color:#111;">Your briefing for ${escapeHtml(briefing.today)}</h1>
  <p style="font-size:14px;color:#333;line-height:1.5;">${escapeHtml(summary)}</p>
  ${briefing.groups.length > 0 ? sections : empty}
  <p style="margin-top:28px;font-size:12px;color:#888;">
    ${threadUrl ? `<a href="${threadUrl}" style="color:#5b6fd6;">Open this briefing</a>\n    &middot; ` : ""}<a href="${appBaseUrl}/my-work" style="color:#5b6fd6;">Open My Work</a>
    &middot; <a href="${unsubscribeUrl}" style="color:#888;">Unsubscribe from briefings</a>
  </p>
</div>`;
}

export function renderBriefingText(input: BriefingEmailInput): string {
  const { agentName, briefing, unsubscribeUrl, threadUrl, summary } = input;
  const lines: string[] = [
    `${agentName} — briefing for ${briefing.today}`,
    "",
    summary,
    "",
  ];
  if (briefing.groups.length === 0) {
    lines.push("Nothing is assigned to you right now.");
  } else {
    for (const g of briefing.groups) {
      lines.push(g.label);
      for (const i of g.items) {
        lines.push(`  - ${i.itemName} (${i.boardName}) ${i.dueDate ?? "—"}`);
      }
      lines.push("");
    }
  }
  if (threadUrl) {
    lines.push(`Open this briefing: ${threadUrl}`);
  }
  lines.push(`Unsubscribe: ${unsubscribeUrl}`);
  return lines.join("\n");
}
