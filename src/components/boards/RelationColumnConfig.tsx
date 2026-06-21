"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type RelationColumnSettings = {
  target_board_id: string;
  allow_multiple: boolean;
};

/**
 * Config shown when adding a relation column: pick the board to connect to and
 * whether a cell may link multiple items. Confirm is disabled until a target
 * board is chosen (a relation column without a target is meaningless).
 */
export function RelationColumnConfig({
  boards,
  onConfirm,
  onCancel,
}: {
  boards: { id: string; name: string }[];
  onConfirm: (settings: RelationColumnSettings) => void;
  onCancel: () => void;
}) {
  const [targetBoardId, setTargetBoardId] = useState("");
  const [allowMultiple, setAllowMultiple] = useState(true);

  return (
    <div className="flex w-64 flex-col gap-3 p-3">
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-muted-foreground text-xs font-medium">
          Connect to board
        </span>
        <div className="relative">
          <select
            aria-label="Connect to board"
            value={targetBoardId}
            onChange={(e) => setTargetBoardId(e.target.value)}
            className={cn(
              "border-border bg-background text-foreground h-9 w-full appearance-none rounded-md border pr-8 pl-3 text-sm",
              "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
              targetBoardId === "" && "text-muted-foreground",
            )}
          >
            <option value="">Select a board…</option>
            {boards.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <ChevronDown
            aria-hidden
            className="text-muted-foreground pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2"
          />
        </div>
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={allowMultiple}
          onChange={(e) => setAllowMultiple(e.target.checked)}
          className="accent-primary size-4"
        />
        Allow linking multiple items
      </label>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={!targetBoardId}
          onClick={() =>
            onConfirm({
              target_board_id: targetBoardId,
              allow_multiple: allowMultiple,
            })
          }
        >
          Add column
        </Button>
      </div>
    </div>
  );
}
