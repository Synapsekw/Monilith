"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useThrottledCallback } from "@/lib/hooks/use-throttled-callback";
import { useQueryClient } from "@tanstack/react-query";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createBoardPresenceChannel } from "./presence-channel";
import { presenceColor } from "./presence-color";
import { toFocusMap, toRoster } from "./presence-reducer";
import type {
  PresenceFocus,
  PresenceState,
  RosterOccupant,
} from "./presence-types";

type Self = { userId: string; name: string; avatarUrl: string | null };

export type BoardPresence = {
  roster: RosterOccupant[];
  focusMap: Map<string, RosterOccupant[]>;
  setFocus: (focus: PresenceFocus | null) => void;
  selfUserId: string;
  selfFocusTargetId: string | null;
  channelStatus: string;
};

export function useBoardPresence(boardId: string, self: Self): BoardPresence {
  const qc = useQueryClient();
  const [raw, setRaw] = useState<Record<string, PresenceState[]>>({});
  const [channelStatus, setStatus] = useState("INIT");
  const channelRef = useRef<RealtimeChannel | null>(null);
  const focusRef = useRef<PresenceFocus | null>(null);
  const [selfFocusTargetId, setSelfFocusTargetId] = useState<string | null>(
    null,
  );
  const hadDropRef = useRef(false);

  const color = useMemo(() => presenceColor(self.userId), [self.userId]);

  const buildState = useCallback(
    (focus: PresenceFocus | null): PresenceState => ({
      userId: self.userId,
      name: self.name,
      avatarUrl: self.avatarUrl,
      color,
      focus,
    }),
    [self.userId, self.name, self.avatarUrl, color],
  );

  useEffect(() => {
    let channel: RealtimeChannel | null = null;
    let cancelled = false;
    void (async () => {
      const ch = await createBoardPresenceChannel(boardId, self.userId);
      if (cancelled) {
        void ch.unsubscribe();
        return;
      }
      channel = ch;
      channelRef.current = ch;
      const sync = () =>
        setRaw(ch.presenceState() as Record<string, PresenceState[]>);
      ch.on("presence", { event: "sync" }, sync)
        .on("presence", { event: "join" }, sync)
        .on("presence", { event: "leave" }, sync)
        .subscribe((status) => {
          setStatus(status);
          if (status === "SUBSCRIBED") {
            void ch.track(buildState(focusRef.current));
            if (hadDropRef.current) {
              void qc.invalidateQueries({ queryKey: ["board", boardId] });
              hadDropRef.current = false;
            }
          }
          if (
            status === "CLOSED" ||
            status === "CHANNEL_ERROR" ||
            status === "TIMED_OUT"
          ) {
            hadDropRef.current = true;
          }
        });
    })();
    return () => {
      cancelled = true;
      if (channel) void channel.unsubscribe();
      channelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId, self.userId]);

  // Trailing-throttle the presence broadcast to ≤1 per 150ms; the synchronous
  // focusRef update + local highlight happen on every call so self-focus stays
  // instant. The throttled tracker reads the latest focus via focusRef.
  const trackFocus = useThrottledCallback(() => {
    void channelRef.current?.track(buildState(focusRef.current));
  }, 150);
  const setFocus = useCallback(
    (focus: PresenceFocus | null) => {
      focusRef.current = focus;
      setSelfFocusTargetId(focus?.targetId ?? null);
      trackFocus();
    },
    [trackFocus],
  );

  // Seed self (from the cached payload) so the current user's presence face
  // renders at first paint, without waiting for the SUBSCRIBED → track → sync
  // round-trip. `toRoster` dedupes self once the real sync arrives.
  const roster = useMemo(
    () =>
      toRoster(raw, {
        userId: self.userId,
        name: self.name,
        avatarUrl: self.avatarUrl,
        color,
      }),
    [raw, self.userId, self.name, self.avatarUrl, color],
  );
  const focusMap = useMemo(() => toFocusMap(raw), [raw]);

  return {
    roster,
    focusMap,
    setFocus,
    selfUserId: self.userId,
    selfFocusTargetId,
    channelStatus,
  };
}
