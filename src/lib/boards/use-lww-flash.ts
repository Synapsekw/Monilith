"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { flashDecision } from "./presence-reducer";
import type { BoardPresence } from "./use-board-presence";

export type LwwMessage = { id: number; text: string };
export type LwwFlash = {
  flashTargetId: string | null;
  lastMessage: LwwMessage | null;
  onRemoteChange: (e: { targetId: string; valueChanged: boolean }) => void;
};

export function useLwwFlash(
  presence: Pick<
    BoardPresence,
    "selfFocusTargetId" | "focusMap" | "selfUserId"
  >,
): LwwFlash {
  const [flashTargetId, setFlashTargetId] = useState<string | null>(null);
  const [lastMessage, setLastMessage] = useState<LwwMessage | null>(null);
  const seqRef = useRef(0);
  const clearRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // latest presence in a ref → stable onRemoteChange identity (no realtime resubscribe)
  const presenceRef = useRef(presence);
  useEffect(() => {
    presenceRef.current = presence;
  });

  const onRemoteChange = useCallback(
    (e: { targetId: string; valueChanged: boolean }) => {
      const p = presenceRef.current;
      if (
        !flashDecision({
          incomingTargetId: e.targetId,
          focusedTargetId: p.selfFocusTargetId,
          valueChanged: e.valueChanged,
        })
      ) {
        return;
      }
      const occ = p.focusMap
        .get(e.targetId)
        ?.find((o) => o.userId !== p.selfUserId);
      seqRef.current += 1;
      setFlashTargetId(e.targetId);
      setLastMessage({
        id: seqRef.current,
        text: occ ? `${occ.name} changed this just now` : "Updated just now",
      });
      if (clearRef.current) clearTimeout(clearRef.current);
      clearRef.current = setTimeout(() => setFlashTargetId(null), 1200);
    },
    [],
  );

  return { flashTargetId, lastMessage, onRemoteChange };
}
