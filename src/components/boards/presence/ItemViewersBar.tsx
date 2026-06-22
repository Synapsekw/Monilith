"use client";

import { useBoardPresenceContextOptional } from "@/lib/boards/presence-context";
import { presenceTarget } from "@/lib/boards/presence-target";
import { PresenceAvatarStack } from "./PresenceAvatarStack";

/**
 * Header indicator for the item detail panel: the avatar stack of *other* board
 * members who currently have the same item's panel open. Reads the per-item
 * viewer set from presence context (`focusMap`) — no new data path. Renders
 * `null` when there is no item, no provider, or no other viewers.
 */
export function ItemViewersBar({ itemId }: { itemId: string | null }) {
  const presence = useBoardPresenceContextOptional();
  if (!presence || !itemId) return null;

  const { focusMap, selfUserId } = presence;
  const others = (focusMap.get(presenceTarget.item(itemId)) ?? []).filter(
    (o) => o.userId !== selfUserId,
  );
  if (others.length === 0) return null;

  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground text-xs">Also viewing</span>
      <PresenceAvatarStack
        occupants={others}
        ariaLabel="Also viewing this item"
        maxFaces={3}
      />
    </div>
  );
}
