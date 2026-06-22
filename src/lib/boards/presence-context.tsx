"use client";

import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import type { BoardPresence } from "./use-board-presence";

/**
 * Presence as exposed through context. Extends the raw {@link BoardPresence}
 * with the local last-write-wins flash target so overlays (e.g.
 * `FlashHighlight`) can briefly highlight the cell that just changed under the
 * local user's focus. Existing consumers read only the `BoardPresence` subset,
 * so they keep compiling.
 */
export type BoardPresenceContextValue = BoardPresence & {
  flashTargetId: string | null;
};

const Ctx = createContext<BoardPresenceContextValue | null>(null);

export function BoardPresenceProvider({
  value,
  children,
}: {
  value: BoardPresenceContextValue;
  children: ReactNode;
}) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useBoardPresenceContext(): BoardPresenceContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useBoardPresenceContext must be used within BoardPresenceProvider");
  return v;
}

/**
 * Non-throwing variant for presentational consumers (e.g. the avatar bar) that
 * can render outside a provider — they simply have nothing to show. Returns
 * `null` when no provider is mounted instead of throwing.
 */
export function useBoardPresenceContextOptional(): BoardPresenceContextValue | null {
  return useContext(Ctx);
}
