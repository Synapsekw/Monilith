"use client";

import { Plus } from "lucide-react";

export function AddGroupRow({ onAdd }: { onAdd: () => void }) {
  return (
    <button
      type="button"
      onClick={onAdd}
      className="text-muted-foreground hover:text-foreground hover:bg-surface focus-visible:ring-ring sticky left-0 flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none"
    >
      <Plus className="size-4 shrink-0" aria-hidden />
      Add group
    </button>
  );
}
