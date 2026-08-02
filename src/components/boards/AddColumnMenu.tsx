"use client";

import { Plus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ColumnKind } from "@/lib/validations/boards";
import { COLUMN_KIND_META, COLUMN_KIND_ORDER } from "@/lib/boards/column-kinds";

export function AddColumnMenu({
  onAdd,
}: {
  onAdd: (kind: ColumnKind) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label="Add column"
          className="text-muted-foreground hover:bg-state-hover hover:text-foreground flex h-full w-11 shrink-0 items-center justify-center border-l"
        >
          <Plus className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 overflow-auto">
        {COLUMN_KIND_ORDER.map((kind) => {
          const { label, Icon } = COLUMN_KIND_META[kind];
          return (
            <DropdownMenuItem key={kind} onSelect={() => onAdd(kind)}>
              <Icon className="size-4" /> {label}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
