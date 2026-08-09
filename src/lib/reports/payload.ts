import "server-only";

/**
 * Loading side of a report's scope: given a report row and the caller's already
 * derived {@link ReportAccess}, fetch exactly the board data the caller is
 * allowed to see and name what the document covers.
 *
 * Kept separate from `render-data.ts` on purpose: this half touches the
 * database (hence `server-only`), the other half is pure and shared with the
 * client builder. `exportReportPdf` composes the two.
 */
import { getBoardPayload, type BoardPayload } from "@/lib/boards/queries";
import { resolvePeopleNames } from "@/lib/boards/people-names";
import { resolveActiveOrg } from "@/lib/org/active";
import { getPortfolio } from "@/lib/portfolios/queries";
import type { ReportAccess } from "@/lib/reports/access";
import { REPORT_BOARDS_LIMIT, type ReportRow } from "@/lib/reports/queries";

export type ReportScopeContext = {
  /** Only boards the caller can read, in bound order. Nulls are dropped. */
  payloads: BoardPayload[];
  /** `userId → display name`, merged across every loaded board. */
  peopleNames: Map<string, string>;
  /** What the report covers — board name, portfolio name, or the report's own. */
  scopeLabel: string;
  /** Bound boards NOT in `payloads`. Disclosed on the page, never hidden. */
  omittedBoardCount: number;
  /** Organization display name for the cover. `""` when there is no org. */
  orgName: string;
};

/**
 * The board name to print for a single-board report: the home board's, falling
 * back to the first payload (a `board`-scoped report whose home board somehow
 * is not the first bound row) and finally to "".
 */
function boardScopeLabel(report: ReportRow, payloads: BoardPayload[]): string {
  const home = payloads.find((p) => p.board.id === report.boardId);
  return (home ?? payloads[0])?.board.name ?? "";
}

export async function loadReportScopeContext(
  report: ReportRow,
  access: ReportAccess,
): Promise<ReportScopeContext> {
  // Bounded read (AGENTS.md working agreement #5): a report can bind at most
  // REPORT_BOARDS_LIMIT boards, and `resolveReportBoardIds` already caps at the
  // same number — this second cap is what keeps the fan-out bounded even if a
  // caller hands us an access object built somewhere else. Boards past the cap
  // are counted as omitted below, so the document discloses the truncation
  // instead of silently under-reporting.
  const boardIds = access.readableBoardIds.slice(0, REPORT_BOARDS_LIMIT);

  const [rawPayloads, org, portfolio] = await Promise.all([
    // Concurrent, not sequential: N boards must cost 1 round-trip of latency.
    Promise.all(boardIds.map((id) => getBoardPayload(id))),
    resolveActiveOrg(),
    report.scope === "portfolio" && report.portfolioId
      ? getPortfolio(report.portfolioId)
      : Promise.resolve(null),
  ]);

  const payloads = rawPayloads.filter((p): p is BoardPayload => p !== null);

  // `resolvePeopleNames` is per-payload; run them concurrently and merge. A
  // later board's name for the same user id simply wins — both come from the
  // same RLS-scoped `profiles` read, so they agree.
  const nameMaps = await Promise.all(
    payloads.map((p) => resolvePeopleNames(p)),
  );
  const peopleNames = new Map<string, string>();
  for (const m of nameMaps) {
    for (const [id, name] of m) peopleNames.set(id, name);
  }

  const scopeLabel =
    report.scope === "board"
      ? boardScopeLabel(report, payloads)
      : report.scope === "portfolio"
        ? (portfolio?.name ?? "")
        : report.scope === "boards"
          ? report.name
          : ""; // template — covers no boards, so there is nothing to name.

  return {
    payloads,
    peopleNames,
    scopeLabel,
    // Unreadable boards (access) + everything readable we could not load:
    // a payload that came back null, and anything past REPORT_BOARDS_LIMIT.
    omittedBoardCount:
      access.omittedCount + (access.readableBoardIds.length - payloads.length),
    // Fall back to "" — NEVER to a board name. v1 fell back to
    // `payload.board.name`, which printed a board where the organization goes.
    orgName: org?.name ?? "",
  };
}
