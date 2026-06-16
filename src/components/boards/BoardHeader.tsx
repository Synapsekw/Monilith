"use client";

import { ViewSwitcher } from "@/components/boards/ViewSwitcher";
import type { BoardView } from "@/lib/boards/queries";

export function BoardHeader({
  boardId,
  boardName,
  views,
  selectedViewId,
}: {
  boardId: string;
  boardName: string;
  views: BoardView[];
  selectedViewId: string;
}) {
  return (
    <header className="flex flex-col gap-2 border-b px-6 py-2">
      <h1 className="text-xl font-semibold tracking-tight">{boardName}</h1>
      <ViewSwitcher
        boardId={boardId}
        views={views}
        selectedViewId={selectedViewId}
      />
    </header>
  );
}
