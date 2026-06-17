"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import {
  prependActivity,
  prependUpdate,
  removeUpdate,
  replaceUpdate,
  type ActivityCache,
  type ItemActivity,
  type ItemUpdate,
  type UpdatesCache,
} from "@/lib/collaboration/cache";
import {
  prependAttachment,
  removeAttachment,
  type Attachment,
  type AttachmentsCache,
} from "@/lib/collaboration/attachments-cache";
import { itemAttachmentsKey } from "@/lib/collaboration/use-item-attachments";

const UPDATES_LIMIT = 30;
const ACTIVITY_LIMIT = 50;

export function itemUpdatesKey(itemId: string) {
  return ["item-updates", itemId] as const;
}
export function itemActivityKey(itemId: string) {
  return ["item-activity", itemId] as const;
}

export function useItemCollab(itemId: string | null) {
  const qc = useQueryClient();

  const updates = useQuery({
    queryKey: itemUpdatesKey(itemId ?? "none"),
    enabled: !!itemId,
    staleTime: Infinity,
    queryFn: async (): Promise<UpdatesCache> => {
      const supabase = createClient();
      const { data } = await supabase
        .from("item_updates")
        .select("*")
        .eq("item_id", itemId!)
        .order("created_at", { ascending: false })
        .limit(UPDATES_LIMIT);
      return { updates: (data ?? []) as ItemUpdate[] };
    },
  });

  const activity = useQuery({
    queryKey: itemActivityKey(itemId ?? "none"),
    enabled: !!itemId,
    staleTime: Infinity,
    queryFn: async (): Promise<ActivityCache> => {
      const supabase = createClient();
      const { data } = await supabase
        .from("item_activities")
        .select("*")
        .eq("item_id", itemId!)
        .order("created_at", { ascending: false })
        .limit(ACTIVITY_LIMIT);
      return { activities: (data ?? []) as ItemActivity[] };
    },
  });

  useEffect(() => {
    if (!itemId) return;
    const supabase = createClient();
    const filter = `item_id=eq.${itemId}`;
    const uKey = itemUpdatesKey(itemId);
    const aKey = itemActivityKey(itemId);
    const atKey = itemAttachmentsKey(itemId);

    function onUpdate(p: RealtimePostgresChangesPayload<ItemUpdate>) {
      if (p.eventType === "DELETE") {
        const id = (p.old as Partial<ItemUpdate>).id;
        if (id)
          qc.setQueryData<UpdatesCache>(uKey, (prev) =>
            prev ? removeUpdate(prev, id) : prev,
          );
        return;
      }
      const row = p.new as ItemUpdate;
      qc.setQueryData<UpdatesCache>(uKey, (prev) =>
        prev
          ? prev.updates.some((u) => u.id === row.id)
            ? replaceUpdate(prev, row)
            : prependUpdate(prev, row)
          : prev,
      );
    }

    function onActivity(p: RealtimePostgresChangesPayload<ItemActivity>) {
      if (p.eventType !== "INSERT") return; // append-only
      const row = p.new as ItemActivity;
      qc.setQueryData<ActivityCache>(aKey, (prev) =>
        prev ? prependActivity(prev, row) : prev,
      );
    }

    function onAttachment(p: RealtimePostgresChangesPayload<Attachment>) {
      if (p.eventType === "DELETE") {
        const id = (p.old as Partial<Attachment>).id;
        if (id)
          qc.setQueryData<AttachmentsCache>(atKey, (prev) =>
            prev ? removeAttachment(prev, id) : prev,
          );
        return;
      }
      if (p.eventType !== "INSERT") return;
      const row = p.new as Attachment;
      qc.setQueryData<AttachmentsCache>(atKey, (prev) =>
        prev ? prependAttachment(prev, row) : prev,
      );
    }

    const channel = supabase
      .channel(`item:${itemId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "item_updates", filter },
        onUpdate,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "item_activities", filter },
        onActivity,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "attachments", filter },
        onAttachment,
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [itemId, qc]);

  return { updates, activity };
}
