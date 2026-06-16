"use client";

import { useSearchParams } from "next/navigation";

import { BoardTable } from "@/components/boards/BoardTable";
import { CalendarBoard } from "@/components/boards/CalendarBoard";
import { GanttBoard } from "@/components/boards/GanttBoard";
import { KanbanBoard } from "@/components/boards/KanbanBoard";
import type { EditorMember } from "@/components/boards/cells/editors";
import type { BoardCache } from "@/lib/boards/cache";
import type { BoardPayload } from "@/lib/boards/queries";
import { useBoardCache } from "@/lib/boards/use-board-cache";
import { useBoardRealtime } from "@/lib/boards/use-board-realtime";
import { resolveSelectedView } from "@/lib/boards/views";

/**
 * Client-side view router for a board. Reads the active view from the `?view=`
 * search param so switching tabs (which updates the URL via
 * `window.history.pushState` in {@link ViewSwitcher}) re-renders here *without*
 * re-running the server component — no board/shell refetch on every switch.
 *
 * `initialViewId` is the server-resolved default and is only used as a fallback
 * when the URL carries no `?view=` param (e.g. a bare `/boards/[id]` link).
 *
 * The realtime channel is owned here so that switching view kinds does not
 * tear down and re-subscribe the `board:<id>` channel.
 */
export function BoardViews({
  payload,
  members,
  initialViewId,
}: {
  payload: BoardPayload;
  members: EditorMember[];
  initialViewId: string;
}) {
  useBoardCache(payload.board.id, payload as unknown as BoardCache);
  useBoardRealtime(payload.board.id);
  const searchParams = useSearchParams();
  const requested = searchParams.get("view") ?? initialViewId;
  const selected = resolveSelectedView(payload.views, requested || undefined);
  const activeViewId = selected?.id ?? payload.views[0]?.id ?? "";

  if (selected?.kind === "kanban") {
    return (
      <KanbanBoard
        payload={payload}
        members={members}
        selectedViewId={activeViewId}
      />
    );
  }

  if (selected?.kind === "calendar") {
    return (
      <CalendarBoard
        payload={payload}
        members={members}
        selectedViewId={activeViewId}
      />
    );
  }

  if (selected?.kind === "timeline") {
    return (
      <GanttBoard
        payload={payload}
        members={members}
        selectedViewId={activeViewId}
      />
    );
  }

  return (
    <BoardTable
      payload={payload}
      members={members}
      selectedViewId={activeViewId}
    />
  );
}
