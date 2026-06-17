"use client";

import {
  Plus,
  Type,
  CircleDot,
  Users,
  Calendar,
  Hash,
  Tags,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ColumnKind } from "@/lib/validations/boards";

const KINDS: { kind: ColumnKind; label: string; Icon: typeof Type }[] = [
  { kind: "text", label: "Text", Icon: Type },
  { kind: "status", label: "Status", Icon: CircleDot },
  { kind: "people", label: "People", Icon: Users },
  { kind: "date", label: "Date", Icon: Calendar },
  { kind: "numbers", label: "Numbers", Icon: Hash },
  { kind: "dropdown", label: "Dropdown", Icon: Tags },
];

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
          className="text-muted-foreground hover:bg-accent hover:text-foreground flex h-full w-11 shrink-0 items-center justify-center border-l"
        >
          <Plus className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {KINDS.map(({ kind, label, Icon }) => (
          <DropdownMenuItem key={kind} onSelect={() => onAdd(kind)}>
            <Icon className="size-4" /> {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
