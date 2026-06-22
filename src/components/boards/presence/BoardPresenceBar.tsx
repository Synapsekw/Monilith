"use client";

import { useBoardPresenceContextOptional } from "@/lib/boards/presence-context";
import { PresenceAvatarStack } from "./PresenceAvatarStack";

/**
 * Overlapping avatar stack of everyone currently present on the board. Reads the
 * roster from presence context and delegates rendering to {@link PresenceAvatarStack}.
 */
export function BoardPresenceBar({ maxFaces = 5 }: { maxFaces?: number }) {
  const presence = useBoardPresenceContextOptional();
  const roster = presence?.roster ?? [];
  return (
    <PresenceAvatarStack
      occupants={roster}
      ariaLabel="People on this board"
      maxFaces={maxFaces}
    />
  );
}
