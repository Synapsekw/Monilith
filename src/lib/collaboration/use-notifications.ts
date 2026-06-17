"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import {
  prependNotification,
  unreadCount,
  type AppNotification,
  type NotificationsCache,
} from "@/lib/collaboration/notifications-cache";

const LIMIT = 30;

export function notificationsKey(userId: string) {
  return ["notifications", userId] as const;
}

export function useNotifications(userId: string) {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: notificationsKey(userId),
    enabled: !!userId,
    staleTime: Infinity,
    queryFn: async (): Promise<NotificationsCache> => {
      const supabase = createClient();
      const { data } = await supabase
        .from("notifications")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(LIMIT);
      return { notifications: (data ?? []) as AppNotification[] };
    },
  });

  useEffect(() => {
    if (!userId) return;
    const supabase = createClient();
    const key = notificationsKey(userId);
    const filter = `recipient_id=eq.${userId}`;

    function onInsert(p: RealtimePostgresChangesPayload<AppNotification>) {
      const row = p.new as AppNotification;
      qc.setQueryData<NotificationsCache>(key, (prev) =>
        prev ? prependNotification(prev, row) : prev,
      );
    }
    function onUpdate(p: RealtimePostgresChangesPayload<AppNotification>) {
      const row = p.new as AppNotification;
      qc.setQueryData<NotificationsCache>(key, (prev) =>
        prev
          ? {
              notifications: prev.notifications.map((x) =>
                x.id === row.id ? row : x,
              ),
            }
          : prev,
      );
    }

    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter },
        onInsert,
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "notifications", filter },
        onUpdate,
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, qc]);

  const unread = query.data ? unreadCount(query.data) : 0;
  return { query, unread };
}
