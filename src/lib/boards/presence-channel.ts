// src/lib/boards/presence-channel.ts
"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

/** Single source of truth for the presence topic — must match the migration's
 *  split_part(topic, ':', 3) board-id extraction. */
export function boardPresenceTopic(boardId: string): string {
  return `presence:board:${boardId}`;
}

/** Private presence channel for a board. setAuth() is REQUIRED before subscribing
 *  to a private channel — it pushes the session JWT into the Realtime socket so the
 *  realtime.messages RLS policy can evaluate can_read_board. */
export async function createBoardPresenceChannel(
  boardId: string,
  selfKey: string,
): Promise<RealtimeChannel> {
  const supabase = createClient();
  await supabase.realtime.setAuth(); // Needed for Realtime Authorization
  return supabase.channel(boardPresenceTopic(boardId), {
    config: { private: true, presence: { key: selfKey } },
  });
}
