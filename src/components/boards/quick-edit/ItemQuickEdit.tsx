"use client";

import { useState } from "react";
import { ArrowUpRight } from "lucide-react";
import type { CacheColumn } from "@/lib/boards/cache";
import type { ColumnOption } from "@/lib/validations/boards";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  StatusOptionList,
  parsePercentInput,
} from "@/components/boards/cells/editors/status-options";

export type QuickEditTarget = { itemId: string; anchorRect: DOMRect };

/**
 * The quick-edit "peek" for Calendar events and Gantt bars: edit Status and
 * % complete in place (one Server Action per commit, optimistic via the board
 * mutations), with an Open affordance to the full ItemPanel. Callers must not
 * render it when BOTH columns are null — fall back to opening the ItemPanel
 * directly (spec §4.1 empty-capability rule).
 *
 * No `autoFocus` anywhere inside: opening the peek must not pop the iPad
 * keyboard — it only appears when the user taps the % field.
 */
export function ItemQuickEdit({
  target,
  itemName,
  statusColumn,
  percentColumn,
  statusValue,
  percentValue,
  setCell,
  clearCellValue,
  onOpenItem,
  onClose,
}: {
  target: QuickEditTarget;
  itemName: string;
  statusColumn: CacheColumn | null;
  percentColumn: CacheColumn | null;
  statusValue: { optionId: string | null } | null;
  percentValue: { percent: number } | null;
  setCell: (vars: { itemId: string; columnId: string; value: unknown }) => void;
  clearCellValue: (vars: { itemId: string; columnId: string }) => void;
  onOpenItem: (itemId: string) => void;
  onClose: () => void;
}) {
  const { itemId, anchorRect } = target;
  const options =
    (statusColumn?.settings as { options?: ColumnOption[] } | null)?.options ??
    [];
  const [pctRaw, setPctRaw] = useState(
    percentValue ? String(percentValue.percent) : "",
  );

  function commitPercent() {
    if (!percentColumn) return;
    const parsed = parsePercentInput(pctRaw);
    if (parsed.kind === "invalid") {
      // Revert to the last committed value, mirroring the table editor.
      setPctRaw(percentValue ? String(percentValue.percent) : "");
      return;
    }
    if (parsed.kind === "clear") {
      // Emptying a previously-set cell clears it; empty-to-empty is a no-op.
      if (percentValue) clearCellValue({ itemId, columnId: percentColumn.id });
      return;
    }
    // Reflect the clamped value so a typed "150" reads back as "100".
    setPctRaw(String(parsed.percent));
    setCell({
      itemId,
      columnId: percentColumn.id,
      value: { percent: parsed.percent },
    });
  }

  return (
    <Popover
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      {/* Fixed-position anchor at the tapped chip/bar's rect — keeps the
          chips/bars dumb (they pass a rect up) while the surface portals to
          the body, escaping the calendar/gantt overflow-auto containers. */}
      <PopoverAnchor asChild>
        <div
          aria-hidden
          style={{
            position: "fixed",
            left: anchorRect.left,
            top: anchorRect.top,
            width: anchorRect.width,
            height: anchorRect.height,
            pointerEvents: "none",
          }}
        />
      </PopoverAnchor>
      <PopoverContent
        role="dialog"
        aria-label={`Edit ${itemName}`}
        align="start"
        sideOffset={4}
        className="flex max-h-[min(22rem,var(--radix-popover-content-available-height))] w-auto max-w-[18rem] min-w-[14rem] flex-col gap-2 overflow-auto p-2"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate text-sm font-medium">
            {itemName}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="shrink-0 pointer-coarse:min-h-11"
            onClick={() => {
              onOpenItem(itemId);
              onClose();
            }}
          >
            <ArrowUpRight className="size-3.5" aria-hidden />
            Open
          </Button>
        </div>

        {statusColumn && (
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground text-xs">
              {statusColumn.name}
            </span>
            <div
              className="flex flex-col gap-0.5"
              role="listbox"
              aria-label={statusColumn.name}
            >
              <StatusOptionList
                options={options}
                selected={statusValue?.optionId ?? null}
                onSelect={(optionId) =>
                  setCell({
                    itemId,
                    columnId: statusColumn.id,
                    value: { optionId },
                  })
                }
                onClear={() =>
                  clearCellValue({ itemId, columnId: statusColumn.id })
                }
              />
            </div>
          </div>
        )}

        {percentColumn && (
          <div className="flex flex-col gap-1">
            <label
              htmlFor={`quick-edit-pct-${itemId}`}
              className="text-muted-foreground text-xs"
            >
              {percentColumn.name}
            </label>
            <Input
              id={`quick-edit-pct-${itemId}`}
              type="number"
              min={0}
              max={100}
              value={pctRaw}
              onChange={(e) => setPctRaw(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitPercent();
                }
              }}
              onBlur={commitPercent}
              className="h-8 tabular-nums pointer-coarse:min-h-11"
            />
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
