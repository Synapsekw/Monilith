"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  markNotificationRead,
  markAllNotificationsRead,
} from "@/lib/collaboration/actions";
import {
  markRead,
  markAllRead,
  type NotificationsCache,
} from "@/lib/collaboration/notifications-cache";
import { notificationsKey } from "@/lib/collaboration/use-notifications";
import { assertOnline } from "@/lib/offline/online-status";

type Ctx = { previous?: NotificationsCache };

export function useNotificationMutations(userId: string) {
  const qc = useQueryClient();
  const key = notificationsKey(userId);

  /**
   * After a successful mark-read there is normally NOTHING to refetch:
   *
   *  - the optimistic patch in `onMutate` already put the cache in its final
   *    state (`read_at` is only ever truthiness-tested, so the placeholder
   *    stamp is as good as the server's timestamp for every reader), and
   *  - the realtime UPDATE handler in `use-notifications.ts` swaps in the real
   *    server row — one event per row, so it covers mark-one and mark-all.
   *
   * Invalidating here re-read the whole 30-row list after every click, and
   * could flicker a just-read row back to unread: a second mark-read queues
   * behind the first (Server Actions dispatch one at a time), so the first
   * one's refetch could land before the second one's write.
   *
   * The one case that still refetches: there was no cached list to patch (the
   * mutation ran before the list loaded, and `cancelQueries` may have dropped
   * that initial load) — then a refetch is the only way the list arrives.
   */
  function settle(c: Ctx | undefined) {
    if (c?.previous) return;
    return qc.invalidateQueries({ queryKey: key });
  }

  const readOne = useMutation<void, Error, { id: string }, Ctx>({
    mutationFn: async (v) => {
      assertOnline();
      const res = await markNotificationRead({ notificationId: v.id });
      if (!res.ok) throw new Error(res.error);
    },
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<NotificationsCache>(key);
      if (previous)
        qc.setQueryData<NotificationsCache>(key, markRead(previous, v.id));
      return { previous };
    },
    onError: (_e, _v, c) => {
      if (c?.previous) qc.setQueryData(key, c.previous);
    },
    onSuccess: (_d, _v, c) => settle(c),
  });

  const readAll = useMutation<void, Error, void, Ctx>({
    mutationFn: async () => {
      assertOnline();
      const res = await markAllNotificationsRead();
      if (!res.ok) throw new Error(res.error);
    },
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<NotificationsCache>(key);
      if (previous)
        qc.setQueryData<NotificationsCache>(key, markAllRead(previous));
      return { previous };
    },
    onError: (_e, _v, c) => {
      if (c?.previous) qc.setQueryData(key, c.previous);
    },
    onSuccess: (_d, _v, c) => settle(c),
  });

  return {
    markRead: (id: string) => readOne.mutate({ id }),
    markAllRead: () => readAll.mutate(),
  };
}
