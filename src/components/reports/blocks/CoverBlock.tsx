// src/components/reports/blocks/CoverBlock.tsx
import type { ReportBlock } from "@/lib/reports/config";

/**
 * The cover's one-line description of what the reader is holding.
 *
 * A report used to be exactly one board, so the lede could name it inline. It
 * can now cover none, one, or many, and each case needs its own sentence — a
 * single template with a pluralised noun ("across the 5 board(s)") reads like a
 * bug on the one page the reader looks at first. The one-board wording is
 * character-for-character the pre-multi-board sentence: existing reports must
 * print exactly as they did.
 */
function lede(scopeLabel: string, boardCount: number): string {
  const base = "A point-in-time snapshot of scope, progress, and risks";
  if (boardCount === 1) return `${base} across the ${scopeLabel} board.`;
  if (boardCount === 0) return `${base}. No boards are in scope yet.`;
  return scopeLabel
    ? `${base} across ${boardCount} boards in ${scopeLabel}.`
    : `${base} across ${boardCount} boards.`;
}

export function CoverBlock({
  title,
  scopeLabel,
  boardCount,
  orgName,
  options,
}: {
  title: string;
  /** What this report covers — a board name, or a portfolio/selection name. */
  scopeLabel: string;
  boardCount: number;
  orgName: string;
  options: Extract<ReportBlock, { type: "cover" }>["options"];
}) {
  // The footer is a fixed three-column grid, so the first cell states the scope
  // as a FIGURE once there is more than one board: a list of names would either
  // overflow one cell or eat the two the user configured (prepared for / by).
  const foot: { lbl: string; val: string }[] = [
    boardCount === 1
      ? { lbl: "Board", val: scopeLabel }
      : { lbl: "Boards", val: boardCount > 1 ? String(boardCount) : "—" },
  ];
  if (options.preparedFor)
    foot.push({ lbl: "Prepared for", val: options.preparedFor });
  if (options.preparedBy)
    foot.push({ lbl: "Prepared by", val: options.preparedBy });
  if (options.showLogo && foot.length < 3)
    foot.push({ lbl: "Organization", val: orgName });

  return (
    <section className="r-cover">
      <div className="r-cover-top">
        <span className="r-cover-kicker">Status Report</span>
        {options.dateRangeLabel ? (
          <span className="r-cover-kicker">{options.dateRangeLabel}</span>
        ) : null}
      </div>
      <div className="r-cover-mid">
        <h1>{title}</h1>
        <div className="r-accent" />
        <p className="r-cover-lede">{lede(scopeLabel, boardCount)}</p>
      </div>
      <div className="r-cover-foot">
        {foot.slice(0, 3).map((f) => (
          <div key={f.lbl}>
            <div className="r-cf-lbl">{f.lbl}</div>
            <div className="r-cf-val">{f.val}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
