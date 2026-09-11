"use client";

import { PanelRightClose, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AskChat } from "@/components/ai/ask/AskChat";
import type { UIMessage } from "@/components/ai/ask/MessageList";
import type { BoardThreadRow } from "@/lib/ai/ask/board-threads";
import type { DockTab } from "@/stores/board-intelligence";
import { AgentSwitcher, type DockAgent } from "./AgentSwitcher";
import { DockThreadList } from "./DockThreadList";
import { DockTabs } from "./DockTabs";
import { IntelligenceTab } from "./intelligence/IntelligenceTab";

export type DockBodyProps = {
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
  /** Which section is showing. Chat and Intelligence never render at once. */
  tab: DockTab;
  onTabChange: (tab: DockTab) => void;
  /** Unresolved suggestions, on the Intelligence tab. */
  badge: number;
  /** Editors and owners may apply a suggestion; viewers read and filter. */
  canApply: boolean;
  runOnMount: boolean;
  onRanOnMount: () => void;
};

/**
 * Header + the open section — the dock's whole interior.
 *
 * Extracted so the desktop column and the mobile Sheet render ONE
 * implementation. Below `md` a 320px column beside a board leaves neither
 * usable, so the surface changes; what is inside it must not.
 *
 * Only the open section is MOUNTED. That is what keeps switching tabs free:
 * the chat's thread fetch is guarded by the dock's `loaded` ref, so coming back
 * to Chat re-renders a list it already has, and opening Intelligence renders a
 * run the store already holds.
 */
export function DockBody({
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
  tab,
  onTabChange,
  badge,
  canApply,
  runOnMount,
  onRanOnMount,
}: DockBodyProps) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* Two rows, not one. The dock is 320px at its narrowest, and the tabs
          alone eat half of that — sharing a row with the persona select and
          "New" left the select about 40px wide, which is its label and nothing
          else. So: the sections on top, and CHAT's own toolbar beneath them. */}
      <header className="flex shrink-0 flex-col gap-1.5 border-b px-2 py-1.5">
        <div className="flex items-center gap-1.5">
          <DockTabs value={tab} onChange={onTabChange} badge={badge} />
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
        </div>
        {tab === "chat" && (
          <div className="flex items-center gap-1.5">
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
          </div>
        )}
      </header>

      {tab === "chat" ? (
        // A real flex column rather than `display: contents`: the panel has to
        // own the same min-height-0 column the dock body did, and a contents
        // box is skipped by part of the a11y tree it is meant to name.
        <div
          id="dock-panel-chat"
          role="tabpanel"
          aria-labelledby="dock-tab-chat"
          className="flex min-h-0 min-w-0 flex-1 flex-col"
        >
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
                This thread was shared with the board. You can read it, but only
                its owner can reply.
              </p>
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
                // thread, starting a new one, or switching persona.
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
