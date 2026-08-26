"use client";

import type { ReactNode } from "react";
import { ChevronDown, ChevronRight, Folder, FolderOpen } from "lucide-react";
import { useUIStore } from "@/stores/ui";
import { BoardFolderMenu } from "@/components/boards/BoardFolderMenu";

/**
 * One collapsible folder in the Boards nav. Open/closed state reuses
 * `useUIStore.collapsedSections` (the same persisted map `NavSection` uses),
 * keyed `folder:<id>` — so toggling a folder is 0 server round-trips and
 * survives a reload. Default open (absent key).
 */
export function BoardFolderRow({
  folder,
  count,
  children,
}: {
  folder: { id: string; name: string };
  count: number;
  children: ReactNode;
}) {
  const collapsedSections = useUIStore((s) => s.collapsedSections);
  const toggleSection = useUIStore((s) => s.toggleSection);
  const key = `folder:${folder.id}`;
  const open = !collapsedSections[key];
  const bodyId = `board-folder-${folder.id}`;

  return (
    <div className="flex flex-col gap-0.5">
      <div className="group/folder text-muted-foreground hover:bg-state-hover hover:text-foreground flex items-center rounded-md pr-1 transition-colors">
        <button
          type="button"
          onClick={() => toggleSection(key)}
          aria-expanded={open}
          aria-controls={bodyId}
          aria-label={`${open ? "Collapse" : "Expand"} ${folder.name}`}
          className="flex size-6 shrink-0 items-center justify-center rounded"
        >
          {open ? (
            <ChevronDown className="size-3.5" />
          ) : (
            <ChevronRight className="size-3.5" />
          )}
        </button>
        {open ? (
          <FolderOpen className="mr-1.5 size-3.5 shrink-0" aria-hidden />
        ) : (
          <Folder className="mr-1.5 size-3.5 shrink-0" aria-hidden />
        )}
        <button
          type="button"
          onClick={() => toggleSection(key)}
          aria-expanded={open}
          aria-controls={bodyId}
          className="min-w-0 flex-1 truncate py-1 pr-1 text-left text-xs"
        >
          {folder.name}
        </button>
        <span className="text-3xs text-muted-foreground mr-0.5 shrink-0 tabular-nums">
          {count}
        </span>
        <BoardFolderMenu folder={folder} />
      </div>
      <div id={bodyId} hidden={!open} className="flex flex-col gap-0.5 pl-3">
        {children}
      </div>
    </div>
  );
}
