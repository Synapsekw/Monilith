import type { DigestBoardRow } from "@/lib/validations/digest";

export type DigestEmailInput = {
  orgName: string;
  periodStart: string;
  totals: { newCount: number; incompleteCount: number; overdueCount: number };
  boards: DigestBoardRow[];
  appBaseUrl: string;
  unsubscribeUrl: string;
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

function boardRowHtml(b: DigestBoardRow): string {
  const samples = [
    b.newSample.length > 0
      ? `New: ${b.newSample.map(escapeHtml).join(", ")}`
      : "",
    b.incompleteSample.length > 0
      ? `Incomplete: ${b.incompleteSample.map(escapeHtml).join(", ")}`
      : "",
  ]
    .filter(Boolean)
    .join(" &middot; ");
  return `<tr>
    <td style="${cellStyle}"><strong>${escapeHtml(b.boardName)}</strong>${
      samples ? `<br /><span style="color:#777;">${samples}</span>` : ""
    }</td>
    <td style="${cellStyle}text-align:right;">${b.newItems}</td>
    <td style="${cellStyle}text-align:right;">${b.incompleteItems}</td>
    <td style="${cellStyle}text-align:right;">${b.overdueItems}</td>
  </tr>`;
}

/** Email-safe digest body: table layout, inline styles, light-mode only, every
 * user-provided string escaped. Visual language matches the branded auth
 * templates in supabase/templates/ — dark ink on white, minimal chrome. */
export function renderDigestHtml(input: DigestEmailInput): string {
  const { totals } = input;
  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f6f6f6;font-family:Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:8px;border:1px solid #e5e5e5;">
      <tr><td style="padding:24px;">
        <h1 style="margin:0 0 4px;font-size:18px;color:#111;">Weekly plan health &mdash; ${escapeHtml(input.orgName)}</h1>
        <p style="margin:0 0 16px;font-size:13px;color:#777;">Week of ${escapeHtml(input.periodStart)}</p>
        <p style="margin:0 0 16px;font-size:14px;color:#333;">
          <strong>${totals.newCount}</strong> new activities &middot;
          <strong>${totals.incompleteCount}</strong> structurally incomplete &middot;
          <strong>${totals.overdueCount}</strong> overdue
        </p>
        <table role="presentation" width="100%" style="border-collapse:collapse;border-top:1px solid #eee;">
          <tr>
            <th style="${cellStyle}text-align:left;color:#777;">Board</th>
            <th style="${cellStyle}text-align:right;color:#777;">New</th>
            <th style="${cellStyle}text-align:right;color:#777;">Incomplete</th>
            <th style="${cellStyle}text-align:right;color:#777;">Overdue</th>
          </tr>
          ${input.boards.map(boardRowHtml).join("\n")}
        </table>
        <p style="margin:20px 0 0;">
          <a href="${input.appBaseUrl}/dashboards" style="font-size:13px;color:#111;">Open your dashboards &rarr;</a>
        </p>
        <p style="margin:20px 0 0;font-size:11px;color:#999;">
          You receive this weekly digest as a member of ${escapeHtml(input.orgName)} on Pulse.
          <a href="${input.unsubscribeUrl}" style="color:#999;">Unsubscribe</a>
        </p>
      </td></tr>
    </table>
  </body>
</html>`;
}

export function renderDigestText(input: DigestEmailInput): string {
  const { totals } = input;
  const lines = [
    `Weekly plan health - ${input.orgName} (week of ${input.periodStart})`,
    ``,
    `${totals.newCount} new activities, ${totals.incompleteCount} structurally incomplete, ${totals.overdueCount} overdue`,
    ``,
    ...input.boards.map(
      (b) =>
        `- ${b.boardName}: ${b.newItems} new, ${b.incompleteItems} incomplete, ${b.overdueItems} overdue`,
    ),
    ``,
    `Open your dashboards: ${input.appBaseUrl}/dashboards`,
    `Unsubscribe: ${input.unsubscribeUrl}`,
  ];
  return lines.join("\n");
}
