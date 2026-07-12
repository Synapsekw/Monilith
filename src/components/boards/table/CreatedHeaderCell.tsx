"use client";

import { User } from "lucide-react";

/** Read-only static header cell for the two virtual creation-metadata columns. */
export function CreatedHeaderCell({
  icon: Icon,
  label,
}: {
  icon: typeof User;
  label: string;
}) {
  return (
    <div className="text-kicker flex items-center gap-1.5 border-l px-3">
      <Icon className="size-3.5" />
      <span className="truncate font-mono text-[10.5px] font-medium tracking-[0.12em] uppercase">
        {label}
      </span>
    </div>
  );
}
