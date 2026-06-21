"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type MirrorRelationOption = {
  id: string;
  name: string;
  target_board_id: string;
};

export type MirrorTargetColumn = {
  id: string;
  name: string;
  kind: string;
};

export type MirrorColumnSettings = {
  source_relation_column_id: string;
  target_column_id: string;
};

/**
 * Config shown when adding a mirror column. Two dependent selects: first pick a
 * relation column on this board, then pick a column on that relation's target
 * board to mirror. Target columns are fetched lazily once a relation is chosen.
 * Confirm is disabled until both are set. If the board has no relation column,
 * an empty state is shown (a mirror needs a relation to hang off of).
 */
export function MirrorColumnConfig({
  relationColumns,
  loadTargetColumns,
  onConfirm,
  onCancel,
}: {
  relationColumns: MirrorRelationOption[];
  loadTargetColumns: (
    targetBoardId: string,
  ) => Promise<MirrorTargetColumn[]>;
  onConfirm: (settings: MirrorColumnSettings) => void;
  onCancel: () => void;
}) {
  const [sourceRelationId, setSourceRelationId] = useState("");
  const [targetColumnId, setTargetColumnId] = useState("");
  const [targetColumns, setTargetColumns] = useState<MirrorTargetColumn[]>([]);
  const [loading, setLoading] = useState(false);

  if (relationColumns.length === 0) {
    return (
      <div className="flex w-72 flex-col gap-3 p-3">
        <p className="text-muted-foreground text-sm">
          Add a Relation column first — a mirror column reflects a field from a
          board you&apos;re connected to.
        </p>
        <div className="flex justify-end">
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  async function handleRelationChange(relationId: string) {
    setSourceRelationId(relationId);
    // Picking a new relation invalidates the previously chosen target column.
    setTargetColumnId("");
    setTargetColumns([]);

    if (relationId === "") return;

    const relation = relationColumns.find((c) => c.id === relationId);
    if (!relation) return;

    setLoading(true);
    try {
      const cols = await loadTargetColumns(relation.target_board_id);
      setTargetColumns(cols);
    } finally {
      setLoading(false);
    }
  }

  const canConfirm = sourceRelationId !== "" && targetColumnId !== "";

  return (
    <div className="flex w-72 flex-col gap-3 p-3">
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-muted-foreground text-xs font-medium">
          Source relation
        </span>
        <div className="relative">
          <select
            aria-label="Source relation"
            value={sourceRelationId}
            onChange={(e) => void handleRelationChange(e.target.value)}
            className={cn(
              "border-border bg-background text-foreground h-9 w-full appearance-none rounded-md border pr-8 pl-3 text-sm",
              "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
              sourceRelationId === "" && "text-muted-foreground",
            )}
          >
            <option value="">Select a relation…</option>
            {relationColumns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <ChevronDown
            aria-hidden
            className="text-muted-foreground pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2"
          />
        </div>
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-muted-foreground text-xs font-medium">
          Column to mirror
        </span>
        <div className="relative">
          <select
            aria-label="Column to mirror"
            value={targetColumnId}
            onChange={(e) => setTargetColumnId(e.target.value)}
            disabled={sourceRelationId === "" || loading}
            className={cn(
              "border-border bg-background text-foreground h-9 w-full appearance-none rounded-md border pr-8 pl-3 text-sm",
              "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
              "disabled:cursor-not-allowed disabled:opacity-50",
              targetColumnId === "" && "text-muted-foreground",
            )}
          >
            <option value="">
              {loading ? "Loading columns…" : "Select a column…"}
            </option>
            {targetColumns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <ChevronDown
            aria-hidden
            className="text-muted-foreground pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2"
          />
        </div>
      </label>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={!canConfirm}
          onClick={() =>
            onConfirm({
              source_relation_column_id: sourceRelationId,
              target_column_id: targetColumnId,
            })
          }
        >
          Add column
        </Button>
      </div>
    </div>
  );
}
