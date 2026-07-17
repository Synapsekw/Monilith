// src/components/reports/blocks/NotesBlock.tsx
import type { ReportBlock } from "@/lib/reports/config";
export function NotesBlock({
  options,
}: {
  options: Extract<ReportBlock, { type: "notes" }>["options"];
}) {
  if (!options.text.trim()) return null;
  return (
    <section className="r-section">
      <div className="r-kicker">Notes</div>
      <p className="r-narrative">{options.text}</p>
    </section>
  );
}
