"use client";
import { useMemo, useState, useTransition } from "react";
import { FileDown, Save, Sparkles } from "lucide-react";
import type { BoardPayload } from "@/lib/boards/queries";
import {
  type ChartBlockOptions,
  type ReportConfig,
} from "@/lib/reports/config";
import {
  computeGroupSummaries,
  computeKpis,
  shapeReport,
} from "@/lib/reports/shape";
import { computeChartSeries } from "@/lib/reports/chart-data";
import { saveReport } from "@/lib/reports/actions";
import { exportReportPdf } from "@/lib/reports/actions";
import { draftReportNarrativeAction } from "@/lib/reports/ai-actions";
import type { ReportNarrative } from "@/lib/reports/ai-draft-schema";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Kicker } from "@/components/ui/kicker";
import { SectionRail } from "./SectionRail";
import { PreviewPane } from "./PreviewPane";
import { ChartBlockOptionsEditor } from "./ChartBlockOptions";

/**
 * Fold the AI narrative into a single editable summary string: the summary, then
 * (when non-empty) "Highlights:" / "Risks:" as bulleted lines. v1 does NOT
 * auto-populate the spotlight block's itemIds — fuzzy name→id matching is
 * unreliable, so highlights/risks are surfaced as editable text instead.
 */
function composeSummaryText(data: ReportNarrative): string {
  let text = data.summary;
  if (data.highlights.length > 0) {
    text +=
      "\n\nHighlights:\n" + data.highlights.map((h) => `- ${h}`).join("\n");
  }
  if (data.risks.length > 0) {
    text += "\n\nRisks:\n" + data.risks.map((r) => `- ${r}`).join("\n");
  }
  return text;
}

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
  const [aiError, setAiError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const summaryBlock = config.blocks.find((b) => b.type === "summary");
  const summaryText =
    summaryBlock && summaryBlock.type === "summary"
      ? summaryBlock.options.text
      : "";

  const chartBlock = config.blocks.find((b) => b.type === "chart");
  const chartOptions =
    chartBlock && chartBlock.type === "chart" ? chartBlock.options : null;

  function setChartOptions(next: ChartBlockOptions) {
    setConfig((prev) => ({
      ...prev,
      blocks: prev.blocks.map((b) =>
        b.type === "chart" ? { ...b, options: next } : b,
      ),
    }));
  }

  // Writes back into the summary block's options.text, leaving other blocks
  // unchanged. Manual editing works with no AI — the textarea is always usable.
  function setSummaryText(text: string, aiGenerated: boolean) {
    setConfig((prev) => ({
      ...prev,
      blocks: prev.blocks.map((b) =>
        b.type === "summary"
          ? { ...b, options: { ...b.options, text, aiGenerated } }
          : b,
      ),
    }));
  }

  function draftWithAi() {
    start(async () => {
      setAiError(null);
      const res = await draftReportNarrativeAction({ boardId });
      if (!res.ok) {
        setAiError(res.error);
        return;
      }
      setSummaryText(composeSummaryText(res.data), true);
    });
  }

  // Shaped client-side once; preview re-renders from local state (0 round-trips).
  const names = useMemo(
    () => new Map(Object.entries(peopleNames)),
    [peopleNames],
  );
  const model = useMemo(() => shapeReport(payload, names), [payload, names]);
  const kpis = useMemo(() => computeKpis(payload, names), [payload, names]);
  const summaries = useMemo(() => computeGroupSummaries(payload), [payload]);
  // Derived from the SAME in-memory payload — 0 server round-trips on every
  // chart option change (working agreement #5).
  const chartSeries = useMemo(
    () =>
      chartOptions ? computeChartSeries(payload, names, chartOptions) : null,
    [payload, names, chartOptions],
  );

  return (
    <div className="grid h-full grid-cols-[320px_1fr]">
      <div className="flex flex-col gap-4 overflow-auto border-r p-4">
        <section className="bg-surface rounded-lg border p-3">
          <Kicker className="mb-2 block">Sections</Kicker>
          <SectionRail config={config} onChange={setConfig} />
        </section>
        {chartOptions ? (
          <section className="bg-surface rounded-lg border p-3">
            <Kicker className="mb-2 block">Chart</Kicker>
            <ChartBlockOptionsEditor
              options={chartOptions}
              columns={payload.columns}
              onChange={setChartOptions}
            />
          </section>
        ) : null}
        {/* Per-block option editors (summary/notes text, table orientation, spotlight picker)
            are added here; keep each a small controlled input writing into `config`. */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="report-summary">Executive summary</Label>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={pending}
              onClick={draftWithAi}
            >
              <Sparkles data-icon="inline-start" />
              Draft with AI
            </Button>
          </div>
          <Textarea
            id="report-summary"
            value={summaryText}
            onChange={(e) => setSummaryText(e.target.value, false)}
            rows={8}
            className="resize-y"
            placeholder="Write an executive summary, or draft one with AI…"
          />
          {aiError ? (
            <p role="alert" className="text-destructive text-xs">
              {aiError}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <Button
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
              <Save data-icon="inline-start" />
              Save
            </Button>
            <Button
              type="button"
              variant="outline"
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
              <FileDown data-icon="inline-start" />
              Export PDF
            </Button>
          </div>
          {error ? (
            <p role="alert" className="text-destructive text-xs">
              {error}
            </p>
          ) : null}
        </div>
      </div>
      <div className="h-full">
        <PreviewPane
          config={config}
          model={model}
          kpis={kpis}
          groupSummaries={summaries}
          chartSeries={chartSeries}
          boardName={payload.board.name}
          orgName={orgName}
        />
      </div>
    </div>
  );
}
