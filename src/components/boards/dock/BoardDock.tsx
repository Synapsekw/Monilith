"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PanelRightClose, PanelRightOpen, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { AskChat } from "@/components/ai/ask/AskChat";
import type { UIMessage } from "@/components/ai/ask/MessageList";
import type { BoardThreadRow } from "@/lib/ai/ask/board-threads";
import { setThreadVisibility } from "@/lib/ai/ask/conversation-actions";
import { loadDockThreads, loadThreadMessages } from "./dock-actions";
import { AgentSwitcher, type DockAgent } from "./AgentSwitcher";
import { DockThreadList } from "./DockThreadList";
import {
  clampDockWidth,
  useDockState,
  useNarrowViewport,
  DOCK_MAX_WIDTH,
  DOCK_MIN_WIDTH,
} from "./use-dock-state";

/** One arrow press of resize. Coarse enough to get somewhere, fine enough to aim. */
const RESIZE_STEP = 16;

/**
 * Put the open thread in the URL, MERGING into whatever is already there.
 *
 * Client-only: Next.js 16 reflects `replaceState` into `useSearchParams()` with
 * no RSC re-run, which is how the board switches views without refetching
 * (gotcha-09). That is also why this must merge rather than replace — the
 * board's own `?view=` lives in the same query string, and overwriting it would
 * silently throw the user back to the default view every time they opened a
 * thread.
 */
function syncThreadParam(conversationId: string | null) {
  const params = new URLSearchParams(window.location.search);
  if (conversationId) params.set("thread", conversationId);
  else params.delete("thread");
  const query = params.toString();
  window.history.replaceState(
    null,
    "",
    query ? `?${query}` : window.location.pathname,
  );
}

/**
 * What went wrong, and what retrying it would mean. Carrying the kind is what
 * lets "Try again" re-run the read that actually failed rather than always
 * re-running the list.
 */
type Failure =
  | { kind: "threads"; message: string }
  | { kind: "thread"; conversationId: string; message: string }
  | { kind: "share"; message: string }
  | null;

type DockBodyProps = {
  agents: DockAgent[];
  agentNames: Record<string, string>;
  /** Persona shown in the switcher: the open thread's, or the next thread's. */
  switcherValue: string | null;
  /** A thread is open, so its persona is fixed on the conversation row. */
  switcherLocked: boolean;
  onAgentChange: (agentId: string | null) => void;
  onNew: () => void;
  /** Omitted inside the Sheet, which brings its own close affordance. */
  onClose?: () => void;
  error: string | null;
  /** Absent when the failure has nothing to retry (an optimistic write that
   *  already rolled itself back). */
  onRetry?: () => void;
  loading: boolean;
  boardThreads: BoardThreadRow[];
  agentThreads: BoardThreadRow[];
  activeId: string | null;
  currentUserId: string;
  onSelectThread: (id: string) => void;
  onToggleShare: (thread: BoardThreadRow) => void;
  sharingId: string | null;
  threadLoading: boolean;
  readOnly: boolean;
  boardId: string;
  messages: UIMessage[];
  agentId: string | null;
  /** Identity of the CHAT INSTANCE, not of the conversation — see `chatKey`. */
  chatKey: string;
  onStarted: (conversationId: string) => void;
  onTurnComplete: () => void;
};

/**
 * Header + thread list + chat — the dock's whole interior.
 *
 * Extracted so the desktop column and the mobile Sheet render ONE
 * implementation. Below `md` a 320px column beside a board leaves neither
 * usable, so the surface changes; what is inside it must not.
 */
function DockBody({
  agents,
  agentNames,
  switcherValue,
  switcherLocked,
  onAgentChange,
  onNew,
  onClose,
  error,
  onRetry,
  loading,
  boardThreads,
  agentThreads,
  activeId,
  currentUserId,
  onSelectThread,
  onToggleShare,
  sharingId,
  threadLoading,
  readOnly,
  boardId,
  messages,
  agentId,
  chatKey,
  onStarted,
  onTurnComplete,
}: DockBodyProps) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center gap-1.5 border-b px-2 py-1.5">
        <AgentSwitcher
          agents={agents}
          value={switcherValue}
          disabled={switcherLocked}
          onChange={onAgentChange}
        />
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0"
          onClick={onNew}
          disabled={activeId === null}
        >
          <Plus className="size-3.5" /> New
        </Button>
        {onClose && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Close agent dock"
            className="shrink-0"
            onClick={onClose}
          >
            <PanelRightClose className="size-4" />
          </Button>
        )}
      </header>

      {error && (
        <div className="flex shrink-0 items-center gap-2 border-b px-2 py-1.5">
          <p className="text-destructive min-w-0 flex-1 text-xs">{error}</p>
          {onRetry && (
            <Button variant="ghost" size="xs" onClick={onRetry}>
              Try again
            </Button>
          )}
        </div>
      )}

      {/* Bounded on purpose: the transcript is the point of the dock, and a
          thread list that grows without limit would push it off the panel. */}
      <div className="max-h-48 shrink-0 overflow-y-auto border-b p-1.5">
        {loading ? (
          <div className="flex flex-col gap-1.5 p-1">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-4/5" />
            <Skeleton className="h-6 w-3/5" />
          </div>
        ) : (
          <DockThreadList
            boardThreads={boardThreads}
            agentThreads={agentThreads}
            activeId={activeId}
            currentUserId={currentUserId}
            agentNames={agentNames}
            sharingId={sharingId}
            onSelect={onSelectThread}
            onToggleShare={onToggleShare}
          />
        )}
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {threadLoading ? (
          <div
            role="status"
            aria-busy="true"
            aria-label="Loading thread"
            className="flex flex-col gap-3 p-4"
          >
            <Skeleton className="h-4 w-2/3 self-end" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
          </div>
        ) : readOnly ? (
          <p className="text-muted-foreground p-4 text-sm">
            This thread was shared with the board. You can read it, but only its
            owner can reply.
          </p>
        ) : (
          <AskChat
            // Keyed on the CHAT INSTANCE, never on `activeId`.
            //
            // AskChat calls `onStarted` the moment createConversation resolves
            // — BEFORE the stream opens — so `activeId` flips from null to the
            // new id in the middle of a live turn. Keying on it would unmount
            // the running chat and mount a fresh one with `initialMessages`
            // still `[]`, and since that prop is snapshotted at mount with no
            // re-sync, the user's question and the streaming answer would be
            // gone for good. The instance id changes only where a reset is
            // actually wanted: selecting a thread, starting a new one, or
            // switching persona.
            key={chatKey}
            conversationId={activeId}
            initialMessages={messages}
            boardId={boardId}
            agentId={agentId ?? undefined}
            onStarted={onStarted}
            onTurnComplete={onTurnComplete}
          />
        )}
      </div>
    </div>
  );
}

/**
 * The board's agent dock.
 *
 * Fetching budget (working agreement #5): renders CLOSED with zero requests, so
 * the majority of board loads that never open it pay nothing. The first open
 * issues ONE Server Action; subsequent opens reuse component state. Selecting a
 * thread reads that thread's messages. Switching persona, collapsing, resizing
 * and the `?thread=` deep link are all client-only. The one extra read is the
 * turn that auto-titles a brand-new thread — a bounded re-read of the list, not
 * a page refetch.
 *
 * It never calls router.push or router.refresh: either would re-run the board
 * page's server query — getBoardPayload plus two more reads — to redisplay data
 * the client already holds (gotcha-09).
 */
export function BoardDock({
  boardId,
  agents,
  currentUserId,
}: {
  boardId: string;
  agents: DockAgent[];
  currentUserId: string;
}) {
  const { open, setOpen, width, setWidth } = useDockState(boardId);
  const narrow = useNarrowViewport();
  const [boardThreads, setBoardThreads] = useState<BoardThreadRow[]>([]);
  const [agentThreads, setAgentThreads] = useState<BoardThreadRow[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure>(null);
  const [loading, setLoading] = useState(false);
  const [threadLoading, setThreadLoading] = useState(false);
  const [sharingId, setSharingId] = useState<string | null>(null);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  /**
   * Identity of the mounted chat, deliberately NOT `activeId`. Bumped only
   * where a fresh chat is genuinely wanted; adopting a just-minted conversation
   * id mid-turn must not remount (see the `key` in DockBody).
   */
  const [chatInstance, setChatInstance] = useState(0);
  const loaded = useRef(false);
  /** The next turn is a first turn, which auto-titles the thread server-side. */
  const untitled = useRef(false);
  /** Guards against an older thread's messages landing after a newer click. */
  const selectToken = useRef(0);
  /** A `?thread=` link not yet honoured. Survives a failed load, so the retry
   *  still lands on the thread the user was sent to. */
  const deepLinkPending = useRef(true);

  const agentNames = Object.fromEntries(agents.map((a) => [a.id, a.name]));

  const selectThread = useCallback(async (id: string) => {
    const token = ++selectToken.current;
    setActiveId(id);
    setMessages([]);
    setThreadLoading(true);
    setFailure(null);
    setChatInstance((n) => n + 1);
    untitled.current = false;
    deepLinkPending.current = false;
    syncThreadParam(id);
    try {
      const res = await loadThreadMessages({ conversationId: id });
      if (selectToken.current !== token) return;
      setThreadLoading(false);
      if (res.ok) setMessages(res.data.messages);
      else
        setFailure({ kind: "thread", conversationId: id, message: res.error });
    } catch {
      // A REJECTION, not an `ok: false`: a dropped connection, a 500, or a
      // deploy that moved the action id. Without this the skeleton below stays
      // on screen forever and the failure surfaces only as an unhandled
      // rejection in the console.
      if (selectToken.current !== token) return;
      setThreadLoading(false);
      setFailure({
        kind: "thread",
        conversationId: id,
        message: "Couldn't open this thread.",
      });
    }
  }, []);

  /**
   * Read the thread list. The ONLY fetch path — the open click, a restored-open
   * dock, the retry button and the first-turn re-read all come through here.
   */
  const loadThreads = useCallback(async () => {
    setLoading(true);
    setFailure(null);
    let data: { board: BoardThreadRow[]; agent: BoardThreadRow[] };
    try {
      const res = await loadDockThreads({ boardId });
      setLoading(false);
      if (!res.ok) {
        // Let a retry happen: a failed load must not leave the dock
        // permanently empty with no way back.
        loaded.current = false;
        setFailure({ kind: "threads", message: res.error });
        return;
      }
      data = res.data;
    } catch {
      setLoading(false);
      loaded.current = false;
      setFailure({ kind: "threads", message: "Couldn't load threads." });
      return;
    }
    setBoardThreads(data.board);
    setAgentThreads(data.agent);

    // Honour a `?thread=` deep link once, and only for a thread this user can
    // actually see — the list is already RLS-scoped, so membership is simply
    // "is it in the rows we got back". Left pending on failure so the retry
    // still honours it; cleared here so the first-turn re-read does not yank
    // the user back to it.
    if (!deepLinkPending.current) return;
    deepLinkPending.current = false;
    const wanted = new URLSearchParams(window.location.search).get("thread");
    if (!wanted) return;
    if ([...data.board, ...data.agent].some((t) => t.id === wanted)) {
      void selectThread(wanted);
    }
  }, [boardId, selectThread]);

  /**
   * Load on OPEN — whether the user just clicked, or the dock came back open
   * from `localStorage` on a later visit to this board.
   *
   * The click handler used to own this, so a remembered-open dock rendered with
   * empty arrays and told the user "No threads yet" over a board that had
   * threads, and silently dropped any `?thread=` link. The collapsed-costs-
   * nothing guarantee is unchanged: `open` is false, so this returns before the
   * fetch.
   */
  useEffect(() => {
    if (!open || loaded.current) return;
    loaded.current = true;
    void loadThreads();
  }, [open, loadThreads]);

  const retry = useCallback(() => {
    // Retry what actually failed. Re-running the list read after a THREAD read
    // failed would clear the message and change nothing the user asked for.
    if (failure?.kind === "thread") {
      void selectThread(failure.conversationId);
      return;
    }
    loaded.current = true;
    void loadThreads();
  }, [failure, loadThreads, selectThread]);

  const startNew = useCallback(() => {
    selectToken.current++;
    setActiveId(null);
    setMessages([]);
    setThreadLoading(false);
    setChatInstance((n) => n + 1);
    untitled.current = false;
    deepLinkPending.current = false;
    syncThreadParam(null);
  }, []);

  /** Switching persona applies to the NEXT thread, so the composer starts over. */
  const changeAgent = useCallback((next: string | null) => {
    setAgentId(next);
    setChatInstance((n) => n + 1);
  }, []);

  const onStarted = useCallback((id: string) => {
    // Adopt the id WITHOUT bumping `chatInstance`: this fires mid-turn, before
    // the stream opens, and remounting here would throw away the question and
    // the answer arriving behind it.
    setActiveId(id);
    untitled.current = true;
    syncThreadParam(id);
  }, []);

  const onTurnComplete = useCallback(() => {
    // A FIRST turn auto-titles its thread server-side, so that one turn earns a
    // re-read of the bounded thread list. Every later turn only changes
    // recency, which is a local re-order. Neither path touches the board's own
    // server query (gotcha-09).
    if (untitled.current) {
      untitled.current = false;
      void loadThreads();
      return;
    }
    setBoardThreads((prev) => {
      const hit = prev.find((t) => t.id === activeId);
      if (!hit) return prev;
      return [hit, ...prev.filter((t) => t.id !== activeId)];
    });
  }, [activeId, loadThreads]);

  /**
   * Put a thread on the board, or take it back.
   *
   * Optimistic: the row flips immediately and reverts if the action refuses.
   * RLS scopes the update to the owner, so a failure here is a real failure,
   * not a permission surprise — the affordance is already owner-only.
   */
  const toggleShare = useCallback(async (thread: BoardThreadRow) => {
    const next = thread.visibility === "board" ? "private" : "board";
    const apply = (visibility: string) => (rows: BoardThreadRow[]) =>
      rows.map((t) => (t.id === thread.id ? { ...t, visibility } : t));
    setSharingId(thread.id);
    setFailure(null);
    setBoardThreads(apply(next));
    setAgentThreads(apply(next));
    try {
      const res = await setThreadVisibility({
        conversationId: thread.id,
        visibility: next,
      });
      if (!res.ok) {
        setBoardThreads(apply(thread.visibility));
        setAgentThreads(apply(thread.visibility));
        setFailure({ kind: "share", message: res.error });
      }
    } catch {
      setBoardThreads(apply(thread.visibility));
      setAgentThreads(apply(thread.visibility));
      setFailure({
        kind: "share",
        message: "Couldn't change who can see this thread.",
      });
    } finally {
      setSharingId(null);
    }
  }, []);

  const shownWidth = dragWidth ?? width;

  const startResize = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = width;
      // The dock is on the RIGHT, so dragging left (a smaller clientX) widens it.
      const at = (ev: PointerEvent) =>
        clampDockWidth(startWidth + (startX - ev.clientX));
      const onMove = (ev: PointerEvent) => setDragWidth(at(ev));
      const onUp = (ev: PointerEvent) => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        // Persist ONCE, on release — a write per pointermove would be ~60
        // localStorage writes a second for one drag.
        setDragWidth(null);
        setWidth(at(ev));
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [setWidth, width],
  );

  if (!open) {
    return (
      // One trigger, two shapes: a floating button on a phone (where the board
      // fills the screen and there is no rail to sit in), a hairline rail
      // beside the board from `md` up.
      <div className="fixed right-4 bottom-4 z-30 shrink-0 md:static md:z-auto md:border-l md:p-1.5">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Open agent dock"
          className="bg-surface border-border shadow-panel md:border-transparent md:bg-transparent md:shadow-none"
          // Opening is just state. The fetch hangs off `open` in an effect, so
          // the click and a dock restored open from storage take one path.
          onClick={() => setOpen(true)}
        >
          <PanelRightOpen className="size-4" />
        </Button>
      </div>
    );
  }

  const activeThread =
    boardThreads.find((t) => t.id === activeId) ??
    agentThreads.find((t) => t.id === activeId) ??
    null;
  // Mid-thread the switcher reports the OPEN thread's persona, not the one
  // queued for the next new thread — a locked control showing the wrong name is
  // worse than no control. Falls back to "Ask" for an agent outside this
  // user's roster.
  const openPersona = activeThread?.agent_id ?? null;

  const body: Omit<DockBodyProps, "onClose"> = {
    agents,
    agentNames,
    switcherValue: activeThread
      ? openPersona && agentNames[openPersona]
        ? openPersona
        : null
      : agentId,
    switcherLocked: activeId !== null,
    onAgentChange: changeAgent,
    onNew: startNew,
    error: failure?.message ?? null,
    // An optimistic share that rolled itself back has nothing to re-run — the
    // thread is already showing its true visibility again.
    onRetry: failure && failure.kind !== "share" ? retry : undefined,
    loading,
    boardThreads,
    agentThreads,
    activeId,
    currentUserId,
    onSelectThread: (id: string) => void selectThread(id),
    onToggleShare: (t: BoardThreadRow) => void toggleShare(t),
    sharingId,
    threadLoading,
    readOnly: Boolean(activeThread && activeThread.user_id !== currentUserId),
    boardId,
    messages,
    agentId,
    chatKey: `chat-${chatInstance}`,
    onStarted,
    onTurnComplete,
  };

  if (narrow) {
    return (
      <Sheet open onOpenChange={(next) => !next && setOpen(false)}>
        {/* `[&>button]:hidden` drops SheetContent's built-in X: the dock brings
            its own close affordance and two of them in one header is noise. */}
        <SheetContent
          side="right"
          className="w-full max-w-none gap-0 p-0 [&>button]:hidden"
        >
          <SheetTitle className="sr-only">Agent dock</SheetTitle>
          <SheetDescription className="sr-only">
            Conversations about this board, and threads from your agents.
          </SheetDescription>
          <DockBody {...body} onClose={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <aside
      aria-label="Agent dock"
      // No `hidden md:flex`: `narrow` has already decided this is the wide
      // surface, and a second, independently-computed breakpoint here is what
      // opens a band where neither surface renders.
      className="relative flex min-w-0 shrink-0 flex-col border-l"
      style={{ width: shownWidth }}
    >
      {/* Hairlines brighten rather than thicken: the grip is invisible until you
          reach for it, then it is the border going bright. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize agent dock"
        aria-valuenow={shownWidth}
        aria-valuemin={DOCK_MIN_WIDTH}
        aria-valuemax={DOCK_MAX_WIDTH}
        tabIndex={0}
        onPointerDown={startResize}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") {
            e.preventDefault();
            setWidth(width + RESIZE_STEP);
          } else if (e.key === "ArrowRight") {
            e.preventDefault();
            setWidth(width - RESIZE_STEP);
          }
        }}
        className="hover:bg-border-hover focus-visible:bg-border-bright absolute inset-y-0 left-0 z-10 w-1.5 -translate-x-1/2 cursor-col-resize touch-none bg-transparent outline-none"
      />
      <DockBody {...body} onClose={() => setOpen(false)} />
    </aside>
  );
}
