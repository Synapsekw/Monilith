"use client";

import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import type { BoardPresence } from "./use-board-presence";

const Ctx = createContext<BoardPresence | null>(null);

export function BoardPresenceProvider({
  value,
  children,
}: {
  value: BoardPresence;
  children: ReactNode;
}) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useBoardPresenceContext(): BoardPresence {
  const v = useContext(Ctx);
  if (!v) throw new Error("useBoardPresenceContext must be used within BoardPresenceProvider");
  return v;
}

/**
 * Non-throwing variant for presentational consumers (e.g. the avatar bar) that
 * can render outside a provider — they simply have nothing to show. Returns
 * `null` when no provider is mounted instead of throwing.
 */
export function useBoardPresenceContextOptional(): BoardPresence | null {
  return useContext(Ctx);
}
