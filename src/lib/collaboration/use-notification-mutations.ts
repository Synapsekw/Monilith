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
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
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
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });

  return {
    markRead: (id: string) => readOne.mutate({ id }),
    markAllRead: () => readAll.mutate(),
  };
}
