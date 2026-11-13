import { create } from "zustand";
import type { UIMessage } from "@/components/ai/ask/MessageList";

/**
 * The My Mono tab's chat, held OUTSIDE the tab: the dock mounts only the open
 * section, so a tab-local state would refetch on every switch back. Client
 * state only, never persisted.
 */
export type MonoThreadState = {
  status: "idle" | "loading" | "ready" | "error";
  conversationId: string | null;
  messages: UIMessage[];
  /** Bumped by "New chat" to remount the chat with no thread. */
  chatKey: number;
};

const EMPTY: MonoThreadState = {
  status: "idle",
  conversationId: null,
  messages: [],
  chatKey: 0,
};

export function monoThreadOf(
  threads: Record<string, MonoThreadState>,
  monoId: string,
): MonoThreadState {
  return threads[monoId] ?? EMPTY;
}

/** The key for one Mono's membership of one board. */
export function boardMembershipKey(monoId: string, boardId: string): string {
  return `${monoId}:${boardId}`;
}

interface MyMonoStoreState {
  threads: Record<string, MonoThreadState>;
  setThread: (monoId: string, patch: Partial<MonoThreadState>) => void;
  newChat: (monoId: string) => void;
  /**
   * "On this board" as last toggled in this session, keyed by
   * `boardMembershipKey`. Absent = trust the page's read. Held here so a tab
   * switch (which unmounts the tab) does not snap back to the page's stale
   * value, and so the toggle never needs a page refresh.
   */
  membership: Record<string, boolean>;
  setMembership: (key: string, onBoard: boolean) => void;
}

export const useMyMonoStore = create<MyMonoStoreState>()((set) => ({
  threads: {},
  membership: {},
  setMembership: (key, onBoard) =>
    set((s) => ({ membership: { ...s.membership, [key]: onBoard } })),
  setThread: (monoId, patch) =>
    set((s) => ({
      threads: {
        ...s.threads,
        [monoId]: { ...monoThreadOf(s.threads, monoId), ...patch },
      },
    })),
  newChat: (monoId) =>
    set((s) => {
      const cur = monoThreadOf(s.threads, monoId);
      return {
        threads: {
          ...s.threads,
          [monoId]: {
            status: "ready",
            conversationId: null,
            messages: [],
            chatKey: cur.chatKey + 1,
          },
        },
      };
    }),
}));
