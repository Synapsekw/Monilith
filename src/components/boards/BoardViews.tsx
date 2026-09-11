"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";

import { BoardTable } from "@/components/boards/BoardTable";
import { ItemPanel } from "@/components/boards/item-panel/ItemPanel";
import { PresenceFlashMessage } from "@/components/boards/presence/PresenceFlashMessage";
import { OfflinePersistence } from "@/components/offline/OfflinePersistence";
import type { EditorMember } from "@/components/boards/cells/editors";
import type { BoardAccess, HeaderGrant } from "@/components/boards/BoardHeader";
import type { BoardPayload } from "@/lib/boards/queries";
import {
  BoardPresenceProvider,
  type BoardPresenceContextValue,
} from "@/lib/boards/presence-context";
import {
  BoardViewPrefsProvider,
  useBoardViewPrefs,
} from "@/lib/boards/view-prefs-context";
import type { ResolvedBoardViewPrefs } from "@/lib/validations/view-prefs";
import {
  BoardIntelligenceProvider,
  IntelToneFrame,
} from "@/lib/boards/intelligence/context";
import { useBoardVisitTouch } from "@/lib/boards/intelligence/use-board-visit";
import { useBoardCache } from "@/lib/boards/use-board-cache";
import { useIsOfflineRender } from "@/lib/offline/offline-render-context";
import { useBoardSnapshot } from "@/lib/offline/snapshot";
import { usePresenceFocusStore } from "@/lib/boards/presence-focus-store";
import { useBoardPresence } from "@/lib/boards/use-board-presence";
import { useBoardRealtime } from "@/lib/boards/use-board-realtime";
import { useLwwFlash } from "@/lib/boards/use-lww-flash";
import { resolveSelectedView } from "@/lib/boards/views";

/**
 * Neutral full-area placeholder shown while a lazily-loaded view chunk streams
 * in. Mirrors the board route's `loading.tsx` skeleton tokens (no new visual
 * design — see AGENTS.md); the board shell (header) is owned by each view, so a
 * simple block is enough to avoid a jarring blank on first switch to a view.
 */
function ViewSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading view"
      className="flex h-full flex-col gap-4 p-6"
    >
      <div className="bg-muted h-8 w-48 animate-pulse rounded-md" />
      <div className="bg-muted/40 h-full w-full animate-pulse rounded-md" />
    </div>
  );
}

// Only one view renders at a time (keyed on `selected.kind`), yet a static
// import ships all four renderers on every board load. BoardTable is the default
// view and stays static (first paint); the other three are code-split and
// fetched only when the user switches to them. `ssr: false` is valid here —
// BoardViews is a Client Component (see next/dist/docs lazy-loading). Mirrors
// the DashboardWidget.tsx / FilePreviewLightbox.tsx idiom.
const KanbanBoard = dynamic(
  () => import("@/components/boards/KanbanBoard").then((m) => m.KanbanBoard),
  { ssr: false, loading: () => <ViewSkeleton /> },
);
const CalendarBoard = dynamic(
  () =>
    import("@/components/boards/CalendarBoard").then((m) => m.CalendarBoard),
  { ssr: false, loading: () => <ViewSkeleton /> },
);
const GanttBoard = dynamic(
  () => import("@/components/boards/GanttBoard").then((m) => m.GanttBoard),
  { ssr: false, loading: () => <ViewSkeleton /> },
);

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
  access,
  grants,
  viewPrefs,
  lastSeenAt,
}: {
  payload: BoardPayload;
  members: EditorMember[];
  initialViewId: string;
  currentUserId: string;
  access: BoardAccess;
  grants: HeaderGrant[];
  /** The caller's saved arrangement, read server-side so nothing flashes. */
  viewPrefs: ResolvedBoardViewPrefs;
  /** board_visits.last_seen_at for the caller (null = first visit). Feeds "changed since". */
  lastSeenAt: string | null;
}) {
  useBoardCache(payload.board.id, payload);

  // True only when this tree is the `/offline` route's replay of a cached
  // board (see offline-render-context.tsx). Gates the pieces below that are
  // only correct when there is a network: the snapshot write, persistence
  // subscription, and the realtime/presence channels.
  const isOfflineRender = useIsOfflineRender();

  // Record what this board needs to re-render with no network. `currentUserId`
  // is already a prop here, so persistence needs no layout change and no extra
  // read to learn who is signed in.
  useBoardSnapshot({ payload, members, initialViewId, currentUserId });

  const selfMember = members.find((m) => m.userId === currentUserId);
  const self = {
    userId: currentUserId,
    name: selfMember?.fullName ?? selfMember?.email ?? "Someone",
    avatarUrl: selfMember?.avatarUrl ?? null,
  };
  const presence = useBoardPresence(payload.board.id, self, {
    enabled: !isOfflineRender,
  });

  // Last-write-wins flash: when a remote change lands on the cell the local user
  // currently has focused, briefly highlight it and surface an attributed
  // message. The realtime channel feeds `onRemoteChange`; `flashTargetId` flows
  // into the presence context so `FlashHighlight` can pick it up per-cell.
  const flash = useLwwFlash(presence);
  useBoardRealtime(payload.board.id, {
    onRemoteChange: flash.onRemoteChange,
    enabled: !isOfflineRender,
  });

  const presenceValue: BoardPresenceContextValue = {
    ...presence,
    flashTargetId: flash.flashTargetId,
  };

  // Feed the subscribable presence focus store (consumed by the per-cell
  // PresenceRing/FlashHighlight/usePresenceFocus). This is what lets a remote
  // focus heartbeat re-render only the affected cell instead of every cell that
  // previously read focus/flash off this component's context value. The context
  // above still carries the roster for the (non-hot) avatar bars.
  const syncPresence = usePresenceFocusStore((s) => s.syncPresence);
  useEffect(() => {
    syncPresence({
      focusMap: presence.focusMap,
      flashTargetId: flash.flashTargetId,
      selfUserId: presence.selfUserId,
      setFocus: presence.setFocus,
    });
  }, [
    syncPresence,
    presence.focusMap,
    presence.selfUserId,
    presence.setFocus,
    flash.flashTargetId,
  ]);
  useEffect(() => () => usePresenceFocusStore.getState().reset(), []);

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
        currentUserId={currentUserId}
        access={access}
        grants={grants}
      />
    ) : selected?.kind === "calendar" ? (
      <CalendarBoard
        payload={payload}
        members={members}
        selectedViewId={activeViewId}
        access={access}
        grants={grants}
        currentUserId={currentUserId}
      />
    ) : selected?.kind === "timeline" ? (
      <GanttBoard
        payload={payload}
        members={members}
        selectedViewId={activeViewId}
        access={access}
        grants={grants}
        currentUserId={currentUserId}
      />
    ) : (
      <BoardTable
        payload={payload}
        members={members}
        selectedViewId={activeViewId}
        currentUserId={currentUserId}
        access={access}
        grants={grants}
      />
    );

  return (
    // OUTSIDE the presence provider so every view *and* the item panel can read
    // the saved arrangement.
    <BoardViewPrefsProvider boardId={payload.board.id} initial={viewPrefs}>
      <ActiveViewRecorder viewId={activeViewId} />
      {/* INSIDE the view-prefs provider: it reads the board filter state (the
            `intel=` chip) through useBoardFilterSort. */}
      <BoardIntelligenceProvider
        boardId={payload.board.id}
        initialData={payload}
        members={members}
        lastSeenAt={lastSeenAt}
        currentUserId={currentUserId}
      >
        <BoardPresenceProvider value={presenceValue}>
          <OfflinePersistence userId={currentUserId} />
          <BoardVisitTouch
            boardId={payload.board.id}
            enabled={!isOfflineRender}
          />
          <IntelToneFrame>{view}</IntelToneFrame>
          <PresenceFlashMessage message={flash.lastMessage} />
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
              avatarUrl: m.avatarUrl,
            }))}
            createdBy={openItem?.created_by ?? null}
            createdAt={openItem?.created_at ?? null}
            onClose={closeItem}
          />
        </BoardPresenceProvider>
      </BoardIntelligenceProvider>
    </BoardViewPrefsProvider>
  );
}

/**
 * Records the active view whenever it changes. A separate component because it
 * must sit INSIDE BoardViewPrefsProvider, which BoardViews itself renders.
 * Renders nothing; `setActiveViewId` is a no-op when the value is unchanged, so
 * the initial mount does not cause a write.
 */
function ActiveViewRecorder({ viewId }: { viewId: string }) {
  const { setActiveViewId } = useBoardViewPrefs();
  useEffect(() => {
    if (viewId) setActiveViewId(viewId);
  }, [viewId, setActiveViewId]);
  return null;
}

/**
 * Stamps the visit (board_visits) once per visit — hidden tab, pagehide or
 * unmount. A component, not a bare hook call, so the offline replay can
 * disable it without a conditional hook. Renders nothing.
 */
function BoardVisitTouch({
  boardId,
  enabled,
}: {
  boardId: string;
  enabled: boolean;
}) {
  useBoardVisitTouch(boardId, enabled);
  return null;
}
