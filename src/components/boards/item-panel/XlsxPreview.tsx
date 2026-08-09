"use client";

import { useEffect, useState } from "react";
import { getAttachmentSheetPreview } from "@/lib/collaboration/sheet-preview-actions";
import type { SheetPreview } from "@/lib/boards/spreadsheet/types";
import { cn } from "@/lib/utils";
import { PreviewProgress } from "./PreviewProgress";

/**
 * Spreadsheet preview. The workbook is parsed on the SERVER (see
 * sheet-preview-actions.ts) and arrives as plain strings, so no spreadsheet
 * parser ships to the browser and React escapes every cell on render — there
 * is no HTML-injection surface here by construction.
 *
 * Switching sheets is pure client state over the already-fetched payload:
 * zero additional server round-trips.
 */
type Resolved = {
  id: string;
  sheets: SheetPreview[] | null;
  error: string | null;
};

export function XlsxPreview({ attachmentId }: { attachmentId: string }) {
  // Keyed by attachment id so render can tell "resolved for THIS file" from
  // "stale / still loading" without a synchronous reset in the effect body
  // (same idiom as FilePreviewLightbox's signed-URL state).
  const [resolved, setResolved] = useState<Resolved | null>(null);
  const [active, setActive] = useState(0);

  // Reset the selected sheet when the attachment changes. Adjusting state
  // during render is React's sanctioned alternative to a reset effect.
  const [prevId, setPrevId] = useState(attachmentId);
  if (prevId !== attachmentId) {
    setPrevId(attachmentId);
    setActive(0);
  }

  useEffect(() => {
    let cancelled = false;
    getAttachmentSheetPreview({ attachmentId }).then((res) => {
      if (cancelled) return;
      setResolved(
        res.ok
          ? { id: attachmentId, sheets: res.data.sheets, error: null }
          : { id: attachmentId, sheets: null, error: res.error },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [attachmentId]);

  const current = resolved?.id === attachmentId ? resolved : null;
  const sheets = current?.sheets ?? null;

  if (current?.error)
    return (
      <div className="text-muted-foreground py-12 text-sm">{current.error}</div>
    );
  if (!sheets)
    return (
      <div className="grid h-full place-items-center">
        {/* Parsing happens server-side and reports no progress, so this is
            honestly indeterminate rather than a fake percentage. */}
        <PreviewProgress label="Reading spreadsheet…" />
      </div>
    );
  if (sheets.length === 0)
    return (
      <div className="text-muted-foreground py-12 text-sm">
        This workbook has no sheets.
      </div>
    );

  const sheet = sheets[active] ?? sheets[0];
  const truncated = sheet.rowCount > sheet.grid.length;

  return (
    <div className="flex min-h-0 w-full flex-col gap-2 p-2">
      {/* Reserves a stable scrollbar gutter so switching between a short and a
          long sheet does not shift the grid sideways. */}
      <div data-scroll-container className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-left text-xs">
          <tbody>
            {sheet.grid.map((row, r) => (
              <tr key={r} className={r === 0 ? "bg-surface-muted" : undefined}>
                <td className="text-kicker border-border bg-background sticky left-0 border px-2 py-1 text-right font-mono tabular-nums">
                  {r + 1}
                </td>
                {row.map((cell, c) => (
                  <td
                    key={c}
                    className={cn(
                      "border-border max-w-56 truncate border px-2 py-1",
                      r === 0 && "font-medium",
                    )}
                    title={cell}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex shrink-0 items-center justify-between gap-3">
        <div role="tablist" className="flex min-w-0 gap-1 overflow-x-auto">
          {sheets.map((s, i) => (
            <button
              key={s.name}
              role="tab"
              type="button"
              aria-selected={i === active}
              onClick={() => setActive(i)}
              className={cn(
                "shrink-0 rounded px-2 py-1 text-xs",
                i === active
                  ? "bg-surface-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {s.name}
            </button>
          ))}
        </div>
        {truncated && (
          <span className="text-kicker shrink-0 text-xs">
            Showing {sheet.grid.length.toLocaleString()} of{" "}
            {sheet.rowCount.toLocaleString()} rows
          </span>
        )}
      </div>
    </div>
  );
}
