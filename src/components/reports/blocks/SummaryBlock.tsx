// src/components/reports/blocks/SummaryBlock.tsx
import type { ReportBlock } from "@/lib/reports/config";
export function SummaryBlock({
  options,
}: {
  options: Extract<ReportBlock, { type: "summary" }>["options"];
}) {
  if (!options.text.trim()) return null;
  return (
    <section className="r-section">
      <div className="r-kicker">Executive summary</div>
      <p className="r-narrative">{options.text}</p>
    </section>
  );
}
