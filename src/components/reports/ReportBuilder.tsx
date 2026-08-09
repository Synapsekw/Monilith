"use client";
import { useMemo, useState, useTransition } from "react";
import { FileDown, Save, Sparkles } from "lucide-react";
import type { BoardPayload } from "@/lib/boards/queries";
import type { ReportScope } from "@/lib/reports/queries";
import {
  type BoardScope,
  type ChartBlockOptions,
  type ReportConfig,
} from "@/lib/reports/config";
import { deriveRenderData } from "@/lib/reports/render-data";
import { saveReport, exportReportPdf } from "@/lib/reports/actions";
import { draftReportNarrativeAction } from "@/lib/reports/ai-actions";
import type { ReportNarrative } from "@/lib/reports/ai-draft-schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Kicker } from "@/components/ui/kicker";
import { selectClass } from "@/components/boards/automations/builder-utils";
import { SectionRail } from "./SectionRail";
import { PreviewPane } from "./PreviewPane";
import { ChartBlockOptionsEditor } from "./ChartBlockOptions";
import {
  ReportScopePicker,
  type ScopeBoard,
  type ScopePortfolio,
} from "./ReportScopePicker";
import { TemplateActions } from "./TemplateActions";

/**
 * Block types that carry a `boardScope` — the ones that render board-specific
 * content and therefore have to say WHICH board when a report covers several.
 * `kpis` pools by design and `summary`/`notes`/`cover` are report-wide prose,
 * so none of them appear here.
 */
const SCOPED_BLOCKS = [
  "chart",
  "table",
  "group_summaries",
  "appendix",
] as const;
type ScopedBlockType = (typeof SCOPED_BLOCKS)[number];

const SCOPED_LABEL: Record<ScopedBlockType, string> = {
  chart: "Chart",
  table: "Board table",
  group_summaries: "Group summaries",
  appendix: "Appendix",
};

/** The sentinel `<option>` value standing for `{ mode: "all" }`. */
const ALL_BOARDS = "__all";

/** Read a scoped block's current board target, or null when it isn't present. */
export function blockBoardScope(
  config: ReportConfig,
  type: ScopedBlockType,
): BoardScope | null {
  const block = config.blocks.find((b) => b.type === type);
  if (!block) return null;
  switch (block.type) {
    case "chart":
    case "table":
    case "group_summaries":
    case "appendix":
      return block.options.boardScope;
    default:
      return null;
  }
}

/**
 * Re-target a scoped block. Pure and exported so the reducer is testable
 * without mounting the builder — the same shape as `toggleBlock`/`moveBlock`.
 */
export function setBlockBoardScope(
  config: ReportConfig,
  type: ScopedBlockType,
  boardScope: BoardScope,
): ReportConfig {
  return {
    ...config,
    blocks: config.blocks.map((b) => {
      if (b.type !== type) return b;
      // Written out per case rather than over the narrowed union: spreading a
      // union of option objects loses the discriminant TS needs to accept the
      // result as a ReportBlock.
      switch (b.type) {
        case "chart":
          return { ...b, options: { ...b.options, boardScope } };
        case "table":
          return { ...b, options: { ...b.options, boardScope } };
        case "group_summaries":
          return { ...b, options: { ...b.options, boardScope } };
        case "appendix":
          return { ...b, options: { ...b.options, boardScope } };
        default:
          return b;
      }
    }),
  };
}

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

/**
 * The report builder: a config rail beside a live preview of the printed
 * document.
 *
 * PERFORMANCE & DATA-FETCHING BUDGET (AGENTS.md working agreement #5)
 *
 * FIRST PAINT loads everything: the page fetches one `BoardPayload` per bound
 * board plus the people-name map, and hands them down as `payloads` /
 * `peopleNames`. That is the ONLY read.
 *
 * EVERY IN-PAGE INTERACTION — toggling a section, reordering blocks, editing
 * the summary or the title, changing chart options, re-targeting a block at a
 * different board — mutates `config` in local state and re-derives the document
 * from the payloads ALREADY IN MEMORY. Zero server round-trips. There is no
 * `<Link>`, no `router.push`, and no `router.refresh` on any of those paths,
 * because an RSC navigation would re-run every query on this page
 * (`vault/decisions/2026-06-16-gotcha-09-rsc-nav-refetch-on-view-switch.md`).
 * No builder state is URL-visible either — it is unsaved edit state, not a
 * shareable view — so there is nothing here that would tempt a navigation. If
 * that ever changes, it must go through `window.history.pushState`, never a
 * router navigation.
 *
 * THREE CONTROLS DO CHANGE SERVER DATA and are correctly transactional: Save
 * (`saveReport`), the scope picker (`setReportScope`, which then refreshes
 * because the set of boards to load has genuinely changed) and Save as
 * template. Export and the AI draft call the server too, but neither
 * invalidates the page.
 *
 * PARITY: the preview is derived with `deriveRenderData` — the exact function
 * the PDF export runs server-side. Hand-rolling the derivation here is what
 * would let the preview and the printed document drift apart.
 */
export function ReportBuilder({
  reportId,
  initialName,
  initialConfig,
  payloads,
  peopleNames,
  scopeLabel,
  omittedBoardCount,
  orgName,
  canEdit,
  scope,
  boardId,
  portfolioId,
  boundBoardIds,
  pickableBoards,
  portfolios,
}: {
  reportId: string;
  initialName: string;
  initialConfig: ReportConfig;
  /** One payload per READABLE bound board, in bound order. May be empty. */
  payloads: BoardPayload[];
  peopleNames: Map<string, string>;
  scopeLabel: string;
  omittedBoardCount: number;
  orgName: string;
  canEdit: boolean;
  scope: ReportScope;
  boardId: string | null;
  portfolioId: string | null;
  boundBoardIds: string[];
  pickableBoards: ScopeBoard[];
  portfolios: ScopePortfolio[];
}) {
  const [config, setConfig] = useState(initialConfig);
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
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

  function edit(next: ReportConfig) {
    setSaved(false);
    setConfig(next);
  }

  function setChartOptions(next: ChartBlockOptions) {
    edit({
      ...config,
      blocks: config.blocks.map((b) =>
        b.type === "chart" ? { ...b, options: next } : b,
      ),
    });
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
    setSaved(false);
  }

  function draftWithAi() {
    start(async () => {
      setAiError(null);
      const res = await draftReportNarrativeAction({ reportId });
      if (!res.ok) {
        setAiError(res.error);
        return;
      }
      setSummaryText(composeSummaryText(res.data), true);
    });
  }

  /**
   * THE ONE DERIVATION. Memoized on the payloads + the config, so a config edit
   * costs a pure recompute over data already in the browser and nothing else.
   * Same function the PDF export runs — see the parity note above.
   */
  const derived = useMemo(
    () => deriveRenderData(payloads, peopleNames, config),
    [payloads, peopleNames, config],
  );

  const renderBoards = derived.boards;
  // A single-board report must look EXACTLY as it did before multi-board
  // existed, so the per-block board targets only appear once there is a genuine
  // choice to make.
  const multiBoard = renderBoards.length > 1;

  /**
   * Columns offered to the chart's source picker. Chart sources are board-local
   * ids, so the list follows the chart's own target: its pinned board, or the
   * first bound board when it charts them all.
   */
  const chartColumns = useMemo(() => {
    const target = chartOptions?.boardScope;
    const pinned =
      target && target.mode === "board"
        ? payloads.find((p) => p.board.id === target.boardId)
        : undefined;
    return (pinned ?? payloads[0])?.columns ?? [];
  }, [payloads, chartOptions]);

  const disabled = !canEdit;

  return (
    <div className="grid h-full grid-cols-[320px_1fr]">
      <div
        data-scroll-container
        className="flex flex-col gap-4 overflow-auto border-r p-4"
      >
        <div className="flex flex-col gap-1">
          <Kicker>Report</Kicker>
          <p className="text-muted-foreground text-xs">
            Covers {scopeLabel}
            {omittedBoardCount > 0
              ? ` · ${omittedBoardCount} ${omittedBoardCount === 1 ? "board" : "boards"} omitted — no access`
              : ""}
          </p>
          {disabled ? (
            <p className="text-muted-foreground text-xs">
              You have view access. Export works; edits can&apos;t be saved.
            </p>
          ) : null}
        </div>

        {/*
          One `disabled` fieldset gates every config control at once. A viewer
          sees the whole builder — nothing is hidden — but cannot start an edit
          they would not be allowed to save.
        */}
        <fieldset
          disabled={disabled}
          className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0"
        >
          <legend className="sr-only">Report configuration</legend>
          <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="report-name">Report name</Label>
              <Input
                id="report-name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setSaved(false);
                }}
                placeholder="Status Report"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="report-title">Title on the cover</Label>
              <Input
                id="report-title"
                value={config.title}
                onChange={(e) => edit({ ...config, title: e.target.value })}
                placeholder="Status Report"
              />
            </div>
          </div>

          <section className="bg-surface rounded-lg border p-3">
            <Kicker className="mb-2 block">Scope</Kicker>
            <ReportScopePicker
              reportId={reportId}
              scope={scope}
              boardId={boardId}
              portfolioId={portfolioId}
              boundBoardIds={boundBoardIds}
              boards={pickableBoards}
              portfolios={portfolios}
              disabled={disabled}
            />
          </section>

          <section className="bg-surface rounded-lg border p-3">
            <Kicker className="mb-2 block">Sections</Kicker>
            <SectionRail config={config} onChange={edit} />
          </section>

          {multiBoard ? (
            <section className="bg-surface rounded-lg border p-3">
              <Kicker className="mb-2 block">Board targets</Kicker>
              <div className="flex flex-col gap-3">
                {SCOPED_BLOCKS.map((type) => {
                  const block = config.blocks.find((b) => b.type === type);
                  if (!block || !block.enabled) return null;
                  const current = blockBoardScope(config, type);
                  if (!current) return null;
                  const value =
                    current.mode === "board" ? current.boardId : ALL_BOARDS;
                  return (
                    <label key={type} className="text-sm">
                      {SCOPED_LABEL[type]}
                      <select
                        aria-label={`${SCOPED_LABEL[type]} board`}
                        className={selectClass}
                        value={value}
                        onChange={(e) =>
                          edit(
                            setBlockBoardScope(
                              config,
                              type,
                              e.target.value === ALL_BOARDS
                                ? { mode: "all" }
                                : { mode: "board", boardId: e.target.value },
                            ),
                          )
                        }
                      >
                        <option value={ALL_BOARDS}>All boards</option>
                        {renderBoards.map((b) => (
                          <option key={b.boardId} value={b.boardId}>
                            {b.boardName}
                          </option>
                        ))}
                      </select>
                    </label>
                  );
                })}
                <p className="text-muted-foreground text-xs">
                  Key metrics always pool across every board in the report.
                </p>
              </div>
            </section>
          ) : null}

          {chartOptions ? (
            <section className="bg-surface rounded-lg border p-3">
              <Kicker className="mb-2 block">Chart</Kicker>
              <ChartBlockOptionsEditor
                options={chartOptions}
                columns={chartColumns}
                onChange={setChartOptions}
              />
            </section>
          ) : null}

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
        </fieldset>

        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={disabled || pending}
              onClick={() =>
                start(async () => {
                  setError(null);
                  const res = await saveReport({ reportId, name, config });
                  if (res.ok) setSaved(true);
                  else setError(res.error);
                })
              }
            >
              <Save data-icon="inline-start" />
              {saved ? "Saved" : "Save"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  setError(null);
                  const res = await exportReportPdf({ reportId });
                  if (res.ok)
                    download(res.data.base64, res.data.mime, res.data.fileName);
                  else setError(res.error);
                })
              }
            >
              <FileDown data-icon="inline-start" />
              Export PDF
            </Button>
            <TemplateActions
              reportId={reportId}
              reportName={name}
              disabled={disabled}
            />
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
          boards={renderBoards}
          totals={derived.totals}
          pooledChartSeries={derived.pooledChartSeries}
          scopeLabel={scopeLabel}
          omittedBoardCount={omittedBoardCount}
          orgName={orgName}
        />
      </div>
    </div>
  );
}
