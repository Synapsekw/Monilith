"use client";
import { useMemo, useState, useTransition } from "react";
import type { BoardPayload } from "@/lib/boards/queries";
import { type ReportConfig } from "@/lib/reports/config";
import {
  computeGroupSummaries,
  computeKpis,
  shapeReport,
} from "@/lib/reports/shape";
import { saveReport } from "@/lib/reports/actions";
import { exportReportPdf } from "@/lib/reports/actions";
import { SectionRail } from "./SectionRail";
import { PreviewPane } from "./PreviewPane";

function download(base64: string, mime: string, fileName: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export function ReportBuilder({
  reportId,
  boardId,
  initialName,
  initialConfig,
  payload,
  peopleNames,
  orgName,
}: {
  reportId: string;
  boardId: string;
  initialName: string;
  initialConfig: ReportConfig;
  payload: BoardPayload;
  peopleNames: Record<string, string>;
  orgName: string;
}) {
  const [config, setConfig] = useState(initialConfig);
  const [name] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Shaped client-side once; preview re-renders from local state (0 round-trips).
  const names = useMemo(
    () => new Map(Object.entries(peopleNames)),
    [peopleNames],
  );
  const model = useMemo(() => shapeReport(payload, names), [payload, names]);
  const kpis = useMemo(() => computeKpis(payload, names), [payload, names]);
  const summaries = useMemo(() => computeGroupSummaries(payload), [payload]);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "320px 1fr",
        height: "100%",
      }}
    >
      <div
        style={{
          padding: 16,
          overflow: "auto",
          borderRight: "1px solid var(--border, #333)",
        }}
      >
        <SectionRail config={config} onChange={setConfig} />
        {/* Per-block option editors (summary/notes text, table orientation, spotlight picker)
            are added here; keep each a small controlled input writing into `config`. */}
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                setError(null);
                const res = await saveReport({
                  reportId,
                  boardId,
                  name,
                  config,
                });
                if (!res.ok) setError(res.error);
              })
            }
          >
            Save
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                setError(null);
                const res = await exportReportPdf({ reportId, boardId });
                if (res.ok)
                  download(res.data.base64, res.data.mime, res.data.fileName);
                else setError(res.error);
              })
            }
          >
            Export PDF
          </button>
        </div>
        {error ? (
          <p role="alert" style={{ color: "#e5484d" }}>
            {error}
          </p>
        ) : null}
      </div>
      <div style={{ height: "100%" }}>
        <PreviewPane
          config={config}
          model={model}
          kpis={kpis}
          groupSummaries={summaries}
          boardName={payload.board.name}
          orgName={orgName}
        />
      </div>
    </div>
  );
}
