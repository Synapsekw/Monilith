// src/components/reports/blocks/SpotlightBlock.tsx
import { Fragment } from "react";
import type { ReportBlock } from "@/lib/reports/config";
import type { ReportModel } from "@/lib/reports/shape";
export function SpotlightBlock({
  model,
  options,
}: {
  model: ReportModel;
  options: Extract<ReportBlock, { type: "spotlight" }>["options"];
}) {
  const byId = new Map(
    model.groups.flatMap((g) => g.rows).map((r) => [r.item.id, r]),
  );
  const rows = options.itemIds
    .map((id) => byId.get(id))
    .filter((r): r is NonNullable<typeof r> => Boolean(r));
  if (!rows.length) return null;
  return (
    <section className="r-section">
      <div className="r-kicker">Spotlight</div>
      {rows.map((r) => (
        <div key={r.item.id} className="r-record">
          <div className="nm">{r.item.name}</div>
          <div className="r-kv">
            {model.columns.map((c) => (
              <Fragment key={c.id}>
                <div className="k">{c.name}</div>
                <div>{r.cells.get(c.id) ?? ""}</div>
              </Fragment>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
