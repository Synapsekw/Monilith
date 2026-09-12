"use client";

import { useState } from "react";
import { ChevronRight, PanelRightClose, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kicker } from "@/components/ui/kicker";
import { Skeleton } from "@/components/ui/skeleton";
import { AskChat } from "@/components/ai/ask/AskChat";
import type { UIMessage } from "@/components/ai/ask/MessageList";
import type { BoardThreadRow } from "@/lib/ai/ask/board-threads";
import type { DockTab } from "@/stores/board-intelligence";
import { cn } from "@/lib/utils";
import { DockThreadList } from "./DockThreadList";
import {
  DockTiles,
  dockTileId,
  knownAgentId,
  type DockAgent,
  type DockPresence,
  type DockTile,
} from "./DockTiles";
import { IntelligenceTab } from "./intelligence/IntelligenceTab";

export type DockBodyProps = {
  agents: DockAgent[];
  agentNames: Record<string, string>;
  /** The chat persona on screen — the open thread's (when its agent is still
   *  on the roster), else the one queued for the next thread. `null` is Ask.
   *  Drives the active tile, the title kicker and the chat panel's label. */
  tileAgentId: string | null;
  /** Live presence by agent id — `running` while that persona's turn streams. */
  presence: Readonly<Record<string, DockPresence>>;
  onSelectTile: (tile: DockTile) => void;
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
  /** The open thread's row, for the title row. `null` for a new thread. */
  activeThread: BoardThreadRow | null;
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
  /** A turn opened / settled in the mounted chat — the presence dot's source. */
  onBusyChange: (busy: boolean) => void;
  /** Which section is showing. Chat and Intelligence never render at once. */
  tab: DockTab;
  /** Unresolved suggestions, on the Intelligence tile. */
  badge: number;
  /** Editors and owners may apply a suggestion; viewers read and filter. */
  canApply: boolean;
  runOnMount: boolean;
  onRanOnMount: () => void;
};

/** Full-layer entrance (spec §5): 14px slide from the right, staggered band →
 *  title → ledger by the `delay-*` each caller adds. `@starting-style` gives a
 *  freshly mounted element a start state to transition from; Tailwind's
 *  translate utilities write the `translate` property, hence the list. */
const RISE =
  "starting:translate-x-3.5 starting:opacity-0 ease-keystone transition-[opacity,translate] duration-[360ms]";

/**
 * The dock's whole interior: band, title row, threads ledger, transcript.
 *
 * Extracted so the desktop column and the mobile Sheet render ONE
 * implementation. Below `md` a 320px column beside a board leaves neither
 * usable, so the surface changes; what is inside it must not.
 *
 * Chrome, not content (spec §3): nothing here is a card. The band, the title
 * and the ledger sit straight on the wash; the transcript renders through
 * `AskChat surface="atmosphere"`, whose composer is the one raised surface.
 *
 * Only the open section is MOUNTED. That is what keeps switching tiles free:
 * the chat's thread fetch is guarded by the dock's `loaded` ref, so coming back
 * to a persona re-renders a list it already has, and opening Intelligence
 * renders a run the store already holds.
 */
export function DockBody({
  agents,
  agentNames,
  tileAgentId,
  presence,
  onSelectTile,
  onNew,
  onClose,
  error,
  onRetry,
  loading,
  boardThreads,
  agentThreads,
  activeId,
  activeThread,
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
  onBusyChange,
  tab,
  badge,
  canApply,
  runOnMount,
  onRanOnMount,
}: DockBodyProps) {
  // Component state, not persisted (spec §6): the ledger opens on demand and
  // folds again when a thread is picked, so the transcript is what you see.
  const [threadsOpen, setThreadsOpen] = useState(false);
  const threadCount = boardThreads.length + agentThreads.length;
  // A queued persona whose agent has since left the roster resolves to Ask —
  // through `knownAgentId`, the SAME call `DockTiles` makes about its own
  // `agentId` prop, so the two can never disagree. Without it, `chatTile`
  // (and the `aria-labelledby` it feeds the panel) could point at a
  // `dock-tab-agent-<staleId>` that DockTiles never renders, because it
  // collapses that same stale id to the Ask tile.
  const resolvedTileAgentId = knownAgentId(tileAgentId, agents);
  const personaName = resolvedTileAgentId
    ? (agentNames[resolvedTileAgentId] ?? "Agent")
    : "Ask";
  const chatTile: DockTile = resolvedTileAgentId
    ? { kind: "agent", agentId: resolvedTileAgentId }
    : { kind: "ask" };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* The band (spec §2): one tablist for everything you consult, then New
          and Close. Same 56px as the app header — one grammar. */}
      <header
        className={cn(
          "flex h-14 shrink-0 items-center gap-1 pr-3 pl-2.5",
          RISE,
          "delay-[120ms]",
        )}
      >
        {/* A roster too wide for the band SCROLLS here rather than pushing New
            / Close off the edge — `DockTiles` itself never shrinks its tiles,
            so the overflow has to be absorbed by this wrapper, not by it.
            `h-full` (not the implicit, content-sized height a centred flex
            item would otherwise get) matters: setting `overflow-x` to
            anything but `visible` computes `overflow-y` to `auto` too (CSS
            Overflow §3), turning this into a clip box on BOTH axes.
            `items-stretch` (rather than `items-center`) hands that real,
            definite height down to `DockTiles`' own row, whose tiles then
            stretch to fill it — which is what lets the active tile's edge
            bar anchor to EACH BUTTON's own bottom edge and land flush with
            the band by construction, for a 32px tile, a 44px coarse-pointer
            one, or a band with a reserved scrollbar eating into this box's
            height, rather than depending on a fixed pixel offset that only
            happened to fit one specific tile size. */}
        <div className="flex h-full min-w-0 flex-1 items-stretch overflow-x-auto">
          <DockTiles
            agents={agents}
            tab={tab}
            agentId={tileAgentId}
            badge={badge}
            presence={presence}
            onSelect={onSelectTile}
          />
        </div>
        {tab === "chat" && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="New thread"
            className="text-muted-foreground hover:text-foreground shrink-0"
            onClick={onNew}
            disabled={activeId === null}
          >
            <Plus className="size-4" />
          </Button>
        )}
        {onClose && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Close agent dock"
            className="text-muted-foreground hover:text-foreground shrink-0"
            onClick={onClose}
          >
            <PanelRightClose className="size-4" />
          </Button>
        )}
      </header>

      {tab === "chat" ? (
        // A real flex column rather than `display: contents`: the panel has to
        // own the same min-height-0 column the dock body did, and a contents
        // box is skipped by part of the a11y tree it is meant to name.
        <div
          id="dock-panel-chat"
          role="tabpanel"
          aria-labelledby={dockTileId(chatTile)}
          className="flex min-h-0 min-w-0 flex-1 flex-col"
        >
          {/* Title row: the thread as a heading, the persona as a kicker. */}
          <div
            className={cn(
              "flex items-baseline gap-2 px-3.5 pt-2",
              RISE,
              "delay-[180ms]",
            )}
          >
            <h2 className="min-w-0 flex-1 truncate text-sm font-extrabold">
              {activeThread?.title ?? "New thread"}
            </h2>
            {activeThread?.visibility === "board" ? (
              // Said in words, not by colour alone — same chip as the list row.
              <Kicker size="xs" className="shrink-0 rounded-sm border px-1">
                Shared
              </Kicker>
            ) : null}
            <Kicker size="xs" className="max-w-[40%] shrink-0 truncate">
              {personaName}
            </Kicker>
          </div>

          {/* Threads ledger: NavSection's header grammar — kicker, hairline
              rule that brightens, mono count, chevron — as one toggle. */}
          <button
            type="button"
            aria-expanded={threadsOpen}
            aria-controls="dock-threads"
            onClick={() => setThreadsOpen((o) => !o)}
            className={cn(
              "group/ledger focus-visible:ring-ring mx-2 flex items-center gap-2 rounded px-1.5 pt-1 pb-1.5 focus-visible:ring-2 focus-visible:outline-none",
              RISE,
              "delay-[240ms]",
            )}
          >
            <Kicker
              size="xs"
              className="ease-keystone group-hover/ledger:text-foreground transition-colors duration-300"
            >
              Threads
            </Kicker>
            <span
              aria-hidden="true"
              data-ledger-rule
              className="bg-border ease-keystone group-hover/ledger:bg-border-bright h-px min-w-3 flex-1 transition-colors duration-300"
            />
            <span className="text-kicker text-3xs font-mono tabular-nums">
              {/* A `0` beside the well's own skeleton is a claim the dock has
                  not earned yet. Only the FIRST read is unknown — a re-read
                  keeps showing the count it already has. */}
              {loading && threadCount === 0 ? "…" : threadCount}
            </span>
            <ChevronRight
              aria-hidden="true"
              className={cn(
                "text-muted-foreground ease-keystone size-3.5 shrink-0 transition-transform duration-200",
                threadsOpen && "rotate-90",
              )}
            />
          </button>
          {/* Bounded on purpose: the transcript is the point of the dock, and a
              thread list that grows without limit would push it off the panel. */}
          <div
            id="dock-threads"
            hidden={!threadsOpen}
            className="max-h-48 shrink-0 overflow-y-auto px-2 pb-1"
          >
            {loading ? (
              <div className="flex flex-col gap-1.5 p-1">
                <Skeleton variant="chrome" className="h-6 w-full" />
                <Skeleton variant="chrome" className="h-6 w-4/5" />
                <Skeleton variant="chrome" className="h-6 w-3/5" />
              </div>
            ) : (
              <DockThreadList
                boardThreads={boardThreads}
                agentThreads={agentThreads}
                activeId={activeId}
                currentUserId={currentUserId}
                agentNames={agentNames}
                sharingId={sharingId}
                onSelect={(id) => {
                  setThreadsOpen(false);
                  onSelectThread(id);
                }}
                onToggleShare={onToggleShare}
              />
            )}
          </div>

          {error && (
            <div className="flex shrink-0 items-center gap-2 px-3.5 py-1.5">
              <p className="text-destructive min-w-0 flex-1 text-xs">{error}</p>
              {onRetry && (
                <Button variant="ghost" size="xs" onClick={onRetry}>
                  Try again
                </Button>
              )}
            </div>
          )}

          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {threadLoading ? (
              <div
                role="status"
                aria-busy="true"
                aria-label="Loading thread"
                className="flex flex-col gap-3 px-3.5 py-3"
              >
                <Skeleton variant="chrome" className="h-4 w-2/3 self-end" />
                <Skeleton variant="chrome" className="h-4 w-full" />
                <Skeleton variant="chrome" className="h-4 w-5/6" />
              </div>
            ) : (
              <AskChat
                // Keyed on the CHAT INSTANCE, never on `activeId`.
                //
                // AskChat calls `onStarted` the moment createConversation
                // resolves — BEFORE the stream opens — so `activeId` flips from
                // null to the new id in the middle of a live turn. Keying on it
                // would unmount the running chat and mount a fresh one with
                // `initialMessages` still `[]`, and since that prop is
                // snapshotted at mount with no re-sync, the user's question and
                // the streaming answer would be gone for good. The instance id
                // changes only where a reset is actually wanted: selecting a
                // thread, or starting a new one (on any persona).
                key={chatKey}
                conversationId={activeId}
                initialMessages={messages}
                boardId={boardId}
                agentId={agentId ?? undefined}
                onStarted={onStarted}
                onTurnComplete={onTurnComplete}
                onBusyChange={onBusyChange}
                // Who answered, for the transcript's kicker and its
                // brand-tinted turn tile. Without it every persona's answers
                // were stamped "Monolith" while the band, the title kicker
                // and the pulsing dot all named the agent.
                //
                // Deliberately NOT `agents`: that prop is the @handle roster,
                // and the dock addresses a persona by TAPPING ITS TILE. The
                // board page reads `user_agents` as `id, name` — no handle to
                // offer — and turning on composer mentions here would let a
                // message go to an agent other than the one the band says is
                // answering, and rewrite the empty state to offer handles
                // that do not exist. Attribution is what was broken; only
                // attribution is wired.
                agentNames={agentNames}
                // A thread someone else shared: AskChat reads it out and says
                // the same sentence in place of the composer. This used to
                // replace the whole chat with that sentence, so a shared
                // thread opened to a title row over an empty body.
                readOnly={readOnly}
                surface="atmosphere"
              />
            )}
          </div>
        </div>
      ) : (
        <IntelligenceTab
          boardId={boardId}
          canApply={canApply}
          runOnMount={runOnMount}
          onRanOnMount={onRanOnMount}
        />
      )}
    </div>
  );
}
