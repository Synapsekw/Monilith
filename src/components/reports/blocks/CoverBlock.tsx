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
  return (
    <section className="r-cover">
      {options.preparedFor ? (
        <div className="r-kicker">
          Prepared for {options.preparedFor}
          {options.dateRangeLabel ? ` · ${options.dateRangeLabel}` : ""}
        </div>
      ) : null}
      <h1>{title}</h1>
      <div className="r-accent" />
      <div style={{ color: "var(--muted)", fontSize: 12 }}>
        {boardName}
        {options.preparedBy ? ` · Prepared by ${options.preparedBy}` : ""}
        {options.showLogo ? ` · ${orgName}` : ""}
      </div>
    </section>
  );
}
