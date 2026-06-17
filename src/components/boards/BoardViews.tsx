"use client";

import { useSearchParams } from "next/navigation";

import { BoardTable } from "@/components/boards/BoardTable";
import { CalendarBoard } from "@/components/boards/CalendarBoard";
import { GanttBoard } from "@/components/boards/GanttBoard";
import { KanbanBoard } from "@/components/boards/KanbanBoard";
import { ItemPanel } from "@/components/boards/item-panel/ItemPanel";
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
  currentUserId,
}: {
  payload: BoardPayload;
  members: EditorMember[];
  initialViewId: string;
  currentUserId: string;
}) {
  useBoardCache(payload.board.id, payload as unknown as BoardCache);
  useBoardRealtime(payload.board.id);
  const searchParams = useSearchParams();
  const requested = searchParams.get("view") ?? initialViewId;
  const selected = resolveSelectedView(payload.views, requested || undefined);
  const activeViewId = selected?.id ?? payload.views[0]?.id ?? "";

  // The detail panel opens via `?item=` (History API → no RSC refetch, same as
  // `?view=`). The open item's name/fields come from the already-loaded cache.
  const openItemId = searchParams.get("item");
  const openItem = openItemId
    ? (payload.items.find((i) => i.id === openItemId) ?? null)
    : null;

  function closeItem() {
    const url = new URL(window.location.href);
    url.searchParams.delete("item");
    window.history.pushState({}, "", url);
  }

  const view =
    selected?.kind === "kanban" ? (
      <KanbanBoard
        payload={payload}
        members={members}
        selectedViewId={activeViewId}
      />
    ) : selected?.kind === "calendar" ? (
      <CalendarBoard
        payload={payload}
        members={members}
        selectedViewId={activeViewId}
      />
    ) : selected?.kind === "timeline" ? (
      <GanttBoard
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

  return (
    <>
      {view}
      <ItemPanel
        itemId={openItem?.id ?? null}
        itemName={openItem?.name ?? ""}
        orgId={payload.board.org_id}
        boardId={payload.board.id}
        currentUserId={currentUserId}
        columns={payload.columns}
        members={members.map((m) => ({
          userId: m.userId,
          fullName: m.fullName,
        }))}
        onClose={closeItem}
      />
    </>
  );
}
