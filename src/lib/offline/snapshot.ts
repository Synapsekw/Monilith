"use client";

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { EditorMember } from "@/components/boards/cells/editors";
import type { BoardPayload } from "@/lib/boards/queries";

/**
 * The exact props `BoardViews` needs to render. Deliberately NOT `BoardCache`:
 * that type is the client mirror of the cell/item data and carries no `views`,
 * which `BoardViews` reads to resolve the active view. Storing the render props
 * makes prop-completeness true by construction rather than by remembering.
 */
export type BoardSnapshot = {
  payload: BoardPayload;
  members: EditorMember[];
  initialViewId: string;
  currentUserId: string;
  savedAt: number;
};

export function boardSnapshotKey(boardId: string) {
  return ["boardSnapshot", boardId] as const;
}

/**
 * Record the board's render props into the query cache, from where the
 * persister writes them to IndexedDB. This is a cache WRITE only — it issues no
 * request and does not participate in the board's own query, so it adds zero
 * server round-trips (working agreement #5).
 */
export function useBoardSnapshot(
  snapshot: Omit<BoardSnapshot, "savedAt">,
): void {
  const qc = useQueryClient();
  const boardId = snapshot.payload.board.id;

  // Keep the latest props in a ref rather than closing over `snapshot`
  // directly, so the persistence effect below can depend on just
  // [boardId, initialViewId] (its actual firing conditions) without an
  // exhaustive-deps violation — refs are exempt from the dependency array by
  // design. The ref is updated from its own unconditional effect (not during
  // render — React forbids mutating a ref while rendering) so it always holds
  // the latest snapshot by the time the persistence effect below reads it.
  const snapshotRef = useRef(snapshot);
  useEffect(() => {
    snapshotRef.current = snapshot;
  });

  useEffect(() => {
    qc.setQueryData<BoardSnapshot>(boardSnapshotKey(boardId), {
      ...snapshotRef.current,
      savedAt: Date.now(),
    });
    // Keying on the board id plus the view id keeps the write to once per
    // meaningful change rather than once per render.
  }, [qc, boardId, snapshot.initialViewId]);
}
