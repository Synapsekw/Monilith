"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PanelRightOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import type { UIMessage } from "@/components/ai/ask/MessageList";
import type { BoardThreadRow } from "@/lib/ai/ask/board-threads";
import { setThreadVisibility } from "@/lib/ai/ask/conversation-actions";
import type { BoardIntelligenceRun } from "@/lib/ai/board-intelligence/runs";
import {
  unresolvedCount,
  useBoardIntelligenceStore,
  type DockTab,
} from "@/stores/board-intelligence";
import { loadDockThreads, loadThreadMessages } from "./dock-actions";
import { DockBody, type DockBodyProps } from "./DockBody";
import { cn } from "@/lib/utils";
import {
  DockTiles,
  type DockAgent,
  type DockPresence,
  type DockTile,
} from "./DockTiles";
import {
  clampDockWidth,
  useDockState,
  useNarrowViewport,
  DOCK_MAX_WIDTH,
  DOCK_MIN_WIDTH,
  DOCK_RAIL_WIDTH,
} from "./use-dock-state";

/** One arrow press of resize. Coarse enough to get somewhere, fine enough to aim. */
const RESIZE_STEP = 16;

/** The open/close width transition (spec §5). The fallback timer that clears
 *  `animating` runs a little after it, for a `transitionend` that never comes
 *  (jsdom, or a width that did not actually change). */
const DOCK_TRANSITION_MS = 360;

/** Spec §5 layer choreography. Both wrappers stay mounted so the class flip
 *  is a real transition from a real start state. Exits are the quick half —
 *  the leaving layer is out of the way before the width settles; entrances
 *  ride ease-keystone with a delay so they start once the other has gone.
 *  Tailwind v4's translate utilities write the `translate` property. */
const LAYER = "absolute inset-y-0 right-0 left-1 flex flex-col";
const FULL_IN =
  "ease-keystone translate-x-0 opacity-100 transition-[opacity,translate] duration-[220ms] delay-[80ms]";
const FULL_OUT =
  "pointer-events-none translate-x-6 opacity-0 [transition:opacity_140ms_ease,translate_200ms_ease-in]";
const MINI_IN =
  "ease-keystone translate-x-0 opacity-100 transition-[opacity,translate] duration-[220ms] delay-[140ms]";
const MINI_OUT =
  "pointer-events-none -translate-x-2 opacity-0 [transition:opacity_120ms_ease,translate_160ms_ease-in]";

const EMPTY_PRESENCE: Readonly<Record<string, DockPresence>> = {};

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
 *
 * Placement (spec §1): on the wide surface the <aside> is PORTALLED into the
 * static shell's `#app-dock-slot`, so the dock sits on the wash beside the
 * content card — chrome, like the sidebar — rather than inside the card. Below
 * `md` the Sheet is unchanged.
 *
 * Motion (spec §5) is CSS: the width transition is applied only while a
 * toggle is in flight (`animating`), and the full/mini layers crossfade as
 * always-mounted wrappers whose contents mount on demand.
 */
export function BoardDock({
  boardId,
  agents,
  currentUserId,
  access = "viewer",
  initialRun = null,
}: {
  boardId: string;
  agents: DockAgent[];
  currentUserId: string;
  /** Least privilege by default: the page passes the real thing (Task 8). */
  access?: "owner" | "editor" | "viewer";
  /** The latest run, read ONCE by the board page. Never re-read here. */
  initialRun?: BoardIntelligenceRun | null;
}) {
  const { open, setOpen, width, setWidth, tab, setTab } = useDockState(boardId);
  const narrow = useNarrowViewport();

  /**
   * Open/close WITH the width transition. The transition class is applied
   * only while a toggle is in flight, so a drag-resize — which also changes
   * the width — stays instant (§5). Cleared on the aside's own
   * `transitionend` for `width`, or by the fallback timer.
   */
  const [animating, setAnimating] = useState(false);
  const animationFallback = useRef<number | null>(null);
  const toggleOpen = useCallback(
    (next: boolean) => {
      setAnimating(true);
      setOpen(next);
      if (animationFallback.current !== null) {
        window.clearTimeout(animationFallback.current);
      }
      animationFallback.current = window.setTimeout(
        () => setAnimating(false),
        DOCK_TRANSITION_MS + 40,
      );
    },
    [setOpen],
  );
  const onTransitionEnd = (e: React.TransitionEvent<HTMLElement>) => {
    // Children's opacity/translate transitions bubble here too.
    if (e.target !== e.currentTarget || e.propertyName !== "width") return;
    if (animationFallback.current !== null) {
      window.clearTimeout(animationFallback.current);
      animationFallback.current = null;
    }
    setAnimating(false);
  };
  useEffect(
    () => () => {
      if (animationFallback.current !== null) {
        window.clearTimeout(animationFallback.current);
      }
    },
    [],
  );

  /** The persona whose turn is streaming, for the presence dot (§2, phase 1:
   *  only the mounted chat's turn — scheduled runs are out of scope). */
  const [streamingPersona, setStreamingPersona] = useState<string | null>(null);

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

  /**
   * The shell's dock slot (`#app-dock-slot`, app-shell.tsx), looked up AFTER
   * mount: effects run once the whole tree has committed, and the static shell
   * sits above this page in that tree, so the slot always exists by then.
   * State rather than a ref, so finding it re-renders the portal into place.
   * The server render and the first client render both see `null` and render
   * nothing — no hydration mismatch, and no dock on a page without a slot.
   */
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    // A post-mount DOM lookup is the one correct time to find a portal target;
    // same exemption as the localStorage read in `useDockState`.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSlot(document.getElementById("app-dock-slot"));
  }, []);

  /* ── Intelligence: the run the page read, and the strip's open requests. ── */

  const setRun = useBoardIntelligenceStore((s) => s.setRun);
  // `undefined` means "this board has never been seeded", which is NOT the same
  // as a seeded `null` ("read, and there is no run") — that distinction is what
  // decides whether opening the tab should read the board for the first time.
  const run = useBoardIntelligenceStore((s) => s.runs[boardId]);
  useEffect(() => {
    if (run === undefined) setRun(boardId, initialRun);
  }, [boardId, initialRun, run, setRun]);

  const openRequest = useBoardIntelligenceStore((s) => s.openRequest);
  const consumeOpen = useBoardIntelligenceStore((s) => s.consumeOpen);
  /** The strip asked for a fresh read ("Catch me up"), not just for the tab. */
  const [wantsRun, setWantsRun] = useState(false);
  /** A first open with nothing cached earns ONE read, and only one — a failed
   *  read must not re-fire every time the user comes back to the tab. */
  const [readOnce, setReadOnce] = useState(false);
  /**
   * Did the reader ASK for Intelligence in this session?
   *
   * `tab` is remembered per board, so a dock left open on Intelligence comes
   * back on Intelligence — and without this, that alone kicked a model call on
   * page load, which is exactly the "zero LLM calls on first paint" rule the
   * budget is built on. Only an actual selection (the tab, or the strip's
   * request) counts as asking.
   */
  const [openedThisSession, setOpenedThisSession] = useState(false);

  useEffect(() => {
    if (!openRequest || openRequest.boardId !== boardId) return;
    // Subscribing to an external store and reacting to what it asked for is
    // the sanctioned shape for an effect, not a cascading render: the strip
    // lives in a different subtree, so a nonce-stamped request in the store
    // IS the only channel it has. `toggleOpen` itself sets local state (opens
    // with the motion transition) — the request is consumed in the same
    // pass, so this whole block runs once per ask.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    toggleOpen(true);
    setTab("intelligence");
    setOpenedThisSession(true);
    if (openRequest.run) setWantsRun(true);
    consumeOpen(openRequest.nonce);
  }, [boardId, consumeOpen, openRequest, toggleOpen, setTab]);

  const onRanOnMount = useCallback(() => {
    setWantsRun(false);
    setReadOnce(true);
  }, []);
  const runOnMount =
    wantsRun || (openedThisSession && !readOnce && run === null);

  /** Selecting Intelligence is the ask; restoring it from storage is not. */
  const changeTab = useCallback(
    (next: DockTab) => {
      if (next === "intelligence") setOpenedThisSession(true);
      setTab(next);
    },
    [setTab],
  );

  const agentNames = Object.fromEntries(agents.map((a) => [a.id, a.name]));
  const activeThread =
    boardThreads.find((t) => t.id === activeId) ??
    agentThreads.find((t) => t.id === activeId) ??
    null;
  // Mid-thread the band reports the OPEN thread's persona, not the one queued
  // for the next new thread. Falls back to "Ask" for an agent outside this
  // user's roster.
  const openPersona = activeThread?.agent_id ?? null;
  /**
   * The persona the reader is looking at. This one value drives the active
   * tile, the title kicker, what New starts over on, and the "does this tile
   * differ" test in `selectTile`.
   */
  const currentPersona: string | null = activeThread
    ? openPersona && agentNames[openPersona]
      ? openPersona
      : null
    : agentId;

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

  /**
   * Start over on `persona`: a fresh chat instance with no thread. New uses
   * it with the persona on screen; a tile tap uses it with a different one —
   * "tap an agent and talk" (§2), replacing the locked select.
   */
  const startNewAs = useCallback((persona: string | null) => {
    selectToken.current++;
    setAgentId(persona);
    setActiveId(null);
    setMessages([]);
    setThreadLoading(false);
    setChatInstance((n) => n + 1);
    untitled.current = false;
    deepLinkPending.current = false;
    syncThreadParam(null);
  }, []);

  /**
   * §2 selection semantics. Intelligence is the ask that counts as "opened
   * this session" (same rule as the old tab). Ask/agent tiles switch to Chat
   * and, when the persona differs from the one on screen, start a new thread
   * on it. Same persona: a no-op, so a stray click never throws away the open
   * thread.
   */
  const selectTile = useCallback(
    (tile: DockTile) => {
      if (tile.kind === "intelligence") {
        changeTab("intelligence");
        return;
      }
      changeTab("chat");
      const persona = tile.kind === "agent" ? tile.agentId : null;
      if (persona !== currentPersona) startNewAs(persona);
    },
    [changeTab, currentPersona, startNewAs],
  );

  /**
   * Which chat INSTANCE most recently reported itself running — not merely
   * "the current one" the way `currentPersona` is, because `startNewAs`
   * unmounts the old `AskChat` (a fresh `key`) while its `onSubmit` promise
   * keeps running detached. That old instance's `finally` still fires
   * `onBusyChange(false)` on the SAME closure it was handed at mount, and
   * that closure's `busy ? currentPersona : null` ternary throws the
   * captured persona away on the false branch — it always clears to `null`,
   * whichever persona is actually on screen by then. Comparing against the
   * instance the callback was created for (not just the persona value) is
   * what lets a stale `false` be ignored instead of blanking a NEWER turn's
   * dot mid-stream.
   */
  const runningInstance = useRef<number | null>(null);
  const onBusyChange = useCallback(
    (busy: boolean) => {
      if (busy) {
        runningInstance.current = chatInstance;
        setStreamingPersona(currentPersona);
        return;
      }
      // A stale reporter — some earlier, since-unmounted instance's turn
      // settling after the reader moved on — must not clear a newer turn's
      // dot; only the instance that is still current may turn it off.
      if (runningInstance.current !== chatInstance) return;
      runningInstance.current = null;
      setStreamingPersona(null);
    },
    [chatInstance, currentPersona],
  );
  const presence: Readonly<Record<string, DockPresence>> = streamingPersona
    ? { [streamingPersona]: "running" }
    : EMPTY_PRESENCE;

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

  const body: Omit<DockBodyProps, "onClose"> = {
    agents,
    agentNames,
    tileAgentId: currentPersona,
    presence,
    onSelectTile: selectTile,
    activeThread,
    onBusyChange,
    onNew: () => startNewAs(currentPersona),
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
    tab,
    badge: unresolvedCount(run ?? null),
    canApply: access !== "viewer",
    runOnMount,
    onRanOnMount,
  };

  if (narrow) {
    if (!open) {
      return (
        // A phone has no rail to sit in: the trigger floats over the board.
        <div className="fixed right-4 bottom-4 z-30">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Open agent dock"
            className="bg-surface border-border shadow-panel border"
            // Opening is just state. The fetch hangs off `open` in an effect,
            // so the click and a dock restored open from storage take one path.
            onClick={() => setOpen(true)}
          >
            <PanelRightOpen className="size-4" />
          </Button>
        </div>
      );
    }
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

  // The wide surface renders through the shell's slot, or not at all. `narrow`
  // has already decided this is the wide surface — no second `hidden md:flex`
  // breakpoint here, which is what used to open a band where neither surface
  // rendered.
  if (!slot) return null;

  return createPortal(
    <aside
      aria-label="Agent dock"
      data-open={open}
      data-animating={animating || undefined}
      onTransitionEnd={onTransitionEnd}
      className={cn(
        "relative flex min-w-0 shrink-0 flex-col overflow-hidden",
        animating && "ease-keystone transition-[width] duration-[360ms]",
      )}
      style={{ width: open ? shownWidth : DOCK_RAIL_WIDTH }}
    >
      {/* Two layers, one aside (§5). The wrappers are ALWAYS mounted so the
          open/closed class flip is a real transition; their contents mount
          only while their side is showing or leaving, so a closed dock never
          mounts the chat (whose composer autofocuses) and the keyboard never
          meets two tablists. `inert` + aria-hidden take the leaving layer
          out of the tab order and the a11y tree for the crossfade. */}
      <div
        data-layer="full"
        inert={open ? undefined : true}
        aria-hidden={open ? undefined : true}
        className={cn(LAYER, open ? FULL_IN : FULL_OUT)}
      >
        {open || animating ? (
          <>
            {/* Hairlines brighten rather than thicken: the grip is invisible
                until you reach for it, then it is the border going bright. */}
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
            <DockBody {...body} onClose={() => toggleOpen(false)} />
          </>
        ) : null}
      </div>
      <div
        data-layer="mini"
        inert={open ? true : undefined}
        aria-hidden={open ? true : undefined}
        className={cn(
          LAYER,
          "items-center gap-2.5 pt-3",
          open ? MINI_OUT : MINI_IN,
        )}
      >
        {!open || animating ? (
          <>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Open agent dock"
              className="text-muted-foreground hover:text-foreground size-8 shrink-0"
              onClick={() => toggleOpen(true)}
            >
              <PanelRightOpen className="size-4" />
            </Button>
            {/* The same tiles, vertical (§4): any tile opens the dock ON it. */}
            <DockTiles
              agents={agents}
              tab={tab}
              agentId={currentPersona}
              badge={unresolvedCount(run ?? null)}
              presence={presence}
              orientation="vertical"
              onSelect={(tile) => {
                selectTile(tile);
                toggleOpen(true);
              }}
            />
          </>
        ) : null}
      </div>
    </aside>,
    slot,
  );
}
