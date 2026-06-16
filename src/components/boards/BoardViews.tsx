"use client";

import { useSearchParams } from "next/navigation";

import { BoardTable } from "@/components/boards/BoardTable";
import { KanbanBoard } from "@/components/boards/KanbanBoard";
import type { EditorMember } from "@/components/boards/cells/editors";
import type { BoardPayload } from "@/lib/boards/queries";
import { resolveSelectedView } from "@/lib/boards/views";

/**
 * Client-side view router for a board. Reads the active view from the `?view=`
 * search param so switching tabs (which updates the URL via
 * `window.history.pushState` in {@link ViewSwitcher}) re-renders here *without*
 * re-running the server component — no board/shell refetch on every switch.
 *
 * `initialViewId` is the server-resolved default and is only used as a fallback
 * when the URL carries no `?view=` param (e.g. a bare `/boards/[id]` link).
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
  const searchParams = useSearchParams();
  const requested = searchParams.get("view") ?? initialViewId;
  const selected = resolveSelectedView(payload.views, requested || undefined);
  const activeViewId = selected?.id ?? payload.views[0]?.id ?? "";

  return selected?.kind === "kanban" ? (
    <KanbanBoard
      payload={payload}
      members={members}
      selectedViewId={activeViewId}
    />
  ) : (
    <BoardTable
      payload={payload}
      members={members}
      selectedViewId={activeViewId}
    />
  );
}
