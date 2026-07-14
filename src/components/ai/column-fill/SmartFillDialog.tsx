"use client";

import { useState, useTransition } from "react";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { applyColumnFill, classifyColumn } from "@/lib/ai/column-fill/actions";
import type { CacheColumn } from "@/lib/boards/cache";
import {
  SmartFillGrid,
  type PreviewRow,
  type TargetOption,
} from "./SmartFillGrid";

/** `columns.settings` is untyped `Json` — the subset every column-fill caller
 *  reads (status/dropdown share `options: [{id,label,color}]`). */
function columnOptions(column: CacheColumn): TargetOption[] {
  const options = (column.settings as { options?: TargetOption[] } | null)
    ?.options;
  return Array.isArray(options) ? options : [];
}

/**
 * Lazy "Smart fill…" dialog, opened from a text column's header menu:
 * up-front privacy notice → target status/dropdown column picker → Classify
 * → {@link SmartFillGrid} preview-and-apply. Classification and apply both go
 * through the `column-fill` Server Actions — this component owns only the UI
 * state (picked target, preview, pending/error), never a raw fetch/write.
 */
export function SmartFillDialog({
  boardId,
  sourceColumn,
  targetColumns,
  onClose,
}: {
  boardId: string;
  sourceColumn: CacheColumn;
  targetColumns: CacheColumn[];
  onClose: () => void;
}) {
  // Defensive filter — callers are expected to pass only status/dropdown
  // columns, but the picker never shows a column Smart Fill can't target.
  const pickable = targetColumns.filter(
    (c) => c.kind === "status" || c.kind === "dropdown",
  );

  const [targetColumnId, setTargetColumnId] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [classifyError, setClassifyError] = useState<string | null>(null);
  const [isClassifying, startClassify] = useTransition();
  const [applyError, setApplyError] = useState<string | null>(null);
  const [isApplying, startApply] = useTransition();

  const targetColumn = pickable.find((c) => c.id === targetColumnId) ?? null;
  const step: "picker" | "preview" = preview ? "preview" : "picker";

  function classify() {
    if (!targetColumnId || isClassifying) return;
    setClassifyError(null);
    startClassify(async () => {
      const res = await classifyColumn({
        boardId,
        sourceColumnId: sourceColumn.id,
        targetColumnId,
      });
      if (!res.ok) {
        setClassifyError(res.error);
        return;
      }
      setPreview(res.data.preview);
      setWarnings(res.data.warnings);
    });
  }

  function apply(assignments: { itemId: string; optionId: string }[]) {
    if (!targetColumnId || assignments.length === 0) return;
    setApplyError(null);
    startApply(async () => {
      const res = await applyColumnFill({ targetColumnId, assignments });
      if (!res.ok) {
        setApplyError(res.error);
        return;
      }
      onClose();
    });
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Smart fill “{sourceColumn.name}”</DialogTitle>
          <DialogDescription>
            {step === "picker"
              ? "Classify this column's text into a status or dropdown column with AI."
              : `Review the proposed values for “${targetColumn?.name ?? ""}” before applying.`}
          </DialogDescription>
        </DialogHeader>

        {step === "picker" ? (
          <div className="flex flex-col gap-4">
            <div className="bg-surface-muted border-border flex gap-2 rounded-lg border p-3">
              <ShieldAlert className="text-muted-foreground size-4 shrink-0" />
              <p className="text-muted-foreground text-xs">
                The text in “{sourceColumn.name}” will be sent to our AI
                provider (Anthropic) to classify each row. No data is used to
                train models.
              </p>
            </div>

            <fieldset className="flex flex-col gap-1">
              <legend className="text-kicker mb-1.5 font-mono text-[10.5px] font-medium tracking-[0.12em] uppercase">
                Fill into
              </legend>
              {pickable.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  Add a status or dropdown column to this board first.
                </p>
              ) : (
                pickable.map((c) => (
                  <label
                    key={c.id}
                    className="hover:border-border-hover has-checked:border-border has-checked:bg-accent flex cursor-pointer items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-sm"
                  >
                    <input
                      type="radio"
                      name="smart-fill-target"
                      value={c.id}
                      checked={targetColumnId === c.id}
                      onChange={() => setTargetColumnId(c.id)}
                      className="accent-primary size-3.5"
                    />
                    {c.name}
                  </label>
                ))
              )}
            </fieldset>

            {classifyError ? (
              <p role="alert" className="text-destructive text-sm">
                {classifyError}
              </p>
            ) : null}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="button"
                onClick={classify}
                disabled={
                  !targetColumnId || isClassifying || pickable.length === 0
                }
              >
                {isClassifying ? "Classifying…" : "Classify"}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <SmartFillGrid
            preview={preview ?? []}
            options={targetColumn ? columnOptions(targetColumn) : []}
            warnings={warnings}
            applying={isApplying}
            applyError={applyError}
            onApply={apply}
            onBack={() => {
              setPreview(null);
              setWarnings([]);
              setApplyError(null);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
