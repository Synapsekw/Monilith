"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ColorChip } from "@/components/ui/color-chip";
import { EmptyState } from "@/components/ui/empty-state";

/** A status/dropdown option, resolved from `columns.settings.options`. */
export type TargetOption = { id: string; label: string; color: string };

/** One classified row, as returned by `classifyColumn`. */
export type PreviewRow = {
  itemId: string;
  itemName: string;
  sourceText: string;
  proposedOptionId: string | null;
};

type RowState = { accepted: boolean; optionId: string | null };

function initialRows(preview: readonly PreviewRow[]): Record<string, RowState> {
  return Object.fromEntries(
    preview.map((row) => [
      row.itemId,
      {
        accepted: row.proposedOptionId != null,
        optionId: row.proposedOptionId,
      },
    ]),
  );
}

/**
 * Preview-and-apply grid for Smart Fill: one row per classified item, an
 * accept checkbox (on by default when the AI proposed a match), and a select
 * to override or clear the proposed option. Purely client state — the parent
 * ({@link SmartFillDialog}) owns the actual `applyColumnFill` call and passes
 * it in as `onApply`, receiving only the accepted `{itemId, optionId}` rows.
 */
export function SmartFillGrid({
  preview,
  options,
  warnings = [],
  applying = false,
  applyError = null,
  onApply,
  onBack,
}: {
  preview: PreviewRow[];
  options: TargetOption[];
  warnings?: string[];
  applying?: boolean;
  applyError?: string | null;
  onApply: (assignments: { itemId: string; optionId: string }[]) => void;
  onBack: () => void;
}) {
  const [rows, setRows] = useState<Record<string, RowState>>(() =>
    initialRows(preview),
  );

  const optionById = useMemo(
    () => new Map(options.map((o) => [o.id, o])),
    [options],
  );

  const accepted = Object.entries(rows).filter(
    ([, r]) => r.accepted && r.optionId,
  );

  function toggle(itemId: string, checked: boolean) {
    setRows((prev) => ({
      ...prev,
      [itemId]: { ...prev[itemId], accepted: checked },
    }));
  }

  function setOption(itemId: string, optionId: string) {
    setRows((prev) => ({
      ...prev,
      [itemId]: { accepted: optionId !== "", optionId: optionId || null },
    }));
  }

  function apply() {
    onApply(
      accepted.map(([itemId, r]) => ({
        itemId,
        optionId: r.optionId as string,
      })),
    );
  }

  if (preview.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <EmptyState variant="inline">
          Nothing to classify — every row was empty or unresolved.
        </EmptyState>
        <div className="flex justify-end">
          <Button type="button" variant="outline" onClick={onBack}>
            Back
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {warnings.length > 0 ? (
        <ul className="bg-status-yellow/15 text-status-yellow flex flex-col gap-1 rounded-md px-3 py-2 text-xs">
          {warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      ) : null}

      <div className="max-h-96 overflow-y-auto rounded-md border">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-surface-muted border-b">
              <th className="w-8 px-2 py-2" aria-hidden />
              <th className="px-2 py-2 text-left font-medium">Item</th>
              <th className="px-2 py-2 text-left font-medium">Source text</th>
              <th className="px-2 py-2 text-left font-medium">
                Proposed value
              </th>
            </tr>
          </thead>
          <tbody>
            {preview.map((row) => {
              const state = rows[row.itemId] ?? {
                accepted: false,
                optionId: null,
              };
              const option = state.optionId
                ? optionById.get(state.optionId)
                : undefined;
              return (
                <tr key={row.itemId} className="border-b last:border-0">
                  <td className="px-2 py-1.5 align-top">
                    <input
                      type="checkbox"
                      aria-label={`Accept ${row.itemName}`}
                      checked={state.accepted}
                      disabled={!state.optionId}
                      onChange={(e) => toggle(row.itemId, e.target.checked)}
                      className="border-input accent-primary size-3.5 shrink-0 rounded-sm"
                    />
                  </td>
                  <td className="text-foreground px-2 py-1.5 align-top">
                    {row.itemName}
                  </td>
                  <td className="text-muted-foreground max-w-64 truncate px-2 py-1.5 align-top">
                    {row.sourceText}
                  </td>
                  <td className="px-2 py-1.5 align-top">
                    <div className="flex items-center gap-2">
                      {option ? (
                        <ColorChip color={option.color}>
                          {option.label}
                        </ColorChip>
                      ) : (
                        <span className="text-muted-foreground text-xs">
                          No match
                        </span>
                      )}
                      <select
                        aria-label={`Value for ${row.itemName}`}
                        value={state.optionId ?? ""}
                        onChange={(e) => setOption(row.itemId, e.target.value)}
                        className="border-input focus-visible:border-ring focus-visible:ring-ring/50 dark:bg-input/30 h-7 rounded-md border bg-transparent px-1.5 text-xs outline-none focus-visible:ring-2"
                      >
                        <option value="">— none —</option>
                        {options.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {applyError ? (
        <p role="alert" className="text-destructive text-sm">
          {applyError}
        </p>
      ) : null}

      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="outline"
          onClick={onBack}
          disabled={applying}
        >
          Back
        </Button>
        <Button
          type="button"
          onClick={apply}
          disabled={accepted.length === 0 || applying}
        >
          {applying ? "Applying…" : `Apply ${accepted.length}`}
        </Button>
      </div>
    </div>
  );
}
