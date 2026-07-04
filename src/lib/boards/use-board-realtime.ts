"use client";

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { BoardCache } from "@/lib/boards/cache";
import { boardKey } from "@/lib/boards/use-board-cache";
import {
  foldBoardEvents,
  type BoardRealtimeEvent,
} from "@/lib/boards/realtime-buffer";

/**
 * Subscribe one Realtime channel for the board, reconciling cell_values + items
 * (+ groups/columns/deps) changes into the ["board", boardId] cache. Incoming
 * events are BUFFERED and applied in a single setQueryData per animation frame,
 * so a burst of edits from many concurrent collaborators causes one re-render
 * per frame instead of one per event. Echo-dedupe of our own optimistic writes
 * and the onRemoteChange flash callback are preserved (see realtime-buffer.ts).
 */
export function useBoardRealtime(
  boardId: string,
  opts?: {
    onRemoteChange?: (e: { targetId: string; valueChanged: boolean }) => void;
  },
) {
  const qc = useQueryClient();
  // Keep latest callback in a ref so a new identity each render does NOT
  // resubscribe the channel (effect deps stay [boardId, qc]).
  const cbRef = useRef(opts?.onRemoteChange);
  useEffect(() => {
    cbRef.current = opts?.onRemoteChange;
  });

  useEffect(() => {
    const supabase = createClient();
    const filter = `board_id=eq.${boardId}`;
    const key = boardKey(boardId);

    const buffer: BoardRealtimeEvent[] = [];
    let frame: number | null = null;
    // Whether the channel has dropped since it last held a SUBSCRIBED state.
    // Gates the resync so only a RE-subscribe (not the first) triggers a refetch.
    let hadDrop = false;

    function flush() {
      frame = null;
      if (buffer.length === 0) return;
      const events = buffer.splice(0, buffer.length);
      const prev = qc.getQueryData<BoardCache>(key);
      if (!prev) return; // board cache not hydrated yet → drop (page seeds it)
      const { next, flashes } = foldBoardEvents(prev, events);
      if (next !== prev) qc.setQueryData<BoardCache>(key, next);
      for (const f of flashes) cbRef.current?.(f);
    }

    function enqueue(ev: BoardRealtimeEvent) {
      buffer.push(ev);
      if (frame == null) frame = requestAnimationFrame(flush);
    }

    const channel = supabase
      .channel(`board:${boardId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "cell_values", filter },
        (payload) =>
          enqueue({ table: "cell_values", payload } as BoardRealtimeEvent),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "items", filter },
        (payload) => enqueue({ table: "items", payload } as BoardRealtimeEvent),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "item_dependencies", filter },
        (payload) =>
          enqueue({
            table: "item_dependencies",
            payload,
          } as BoardRealtimeEvent),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "columns", filter },
        (payload) =>
          enqueue({ table: "columns", payload } as BoardRealtimeEvent),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "groups", filter },
        (payload) =>
          enqueue({ table: "groups", payload } as BoardRealtimeEvent),
      )
      // Track channel status so a reconnect resyncs. After a laptop sleep /
      // network blip the socket drops (CHANNEL_ERROR / TIMED_OUT / CLOSED) and
      // Supabase auto-reconnects, re-firing this callback with SUBSCRIBED. Every
      // collaborator edit during the gap was missed (postgres_changes is not
      // replayed), so on a RE-subscribe (not the first) we invalidate the board
      // query → the queryFn re-reads the full bounded payload and reconciles.
      // The first SUBSCRIBED is the initial hydration (initialData already
      // present) → no refetch. Mirrors use-board-presence.ts:67-83.
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          if (hadDrop) {
            hadDrop = false;
            void qc.invalidateQueries({ queryKey: key });
          }
        } else if (
          status === "CHANNEL_ERROR" ||
          status === "TIMED_OUT" ||
          status === "CLOSED"
        ) {
          hadDrop = true;
        }
      });

    return () => {
      if (frame != null) cancelAnimationFrame(frame);
      buffer.length = 0;
      supabase.removeChannel(channel);
    };
  }, [boardId, qc]);
}
