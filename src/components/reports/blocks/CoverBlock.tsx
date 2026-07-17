// src/components/reports/blocks/CoverBlock.tsx
import type { ReportBlock } from "@/lib/reports/config";

export function CoverBlock({
  title,
  boardName,
  orgName,
  options,
}: {
  title: string;
  boardName: string;
  orgName: string;
  options: Extract<ReportBlock, { type: "cover" }>["options"];
}) {
  const foot: { lbl: string; val: string }[] = [
    { lbl: "Board", val: boardName },
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
        <p className="r-cover-lede">
          A point-in-time snapshot of scope, progress, and risks across the{" "}
          {boardName} board.
        </p>
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
