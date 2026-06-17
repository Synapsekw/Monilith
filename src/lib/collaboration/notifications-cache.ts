import type { Tables } from "@/types/database.types";

export type AppNotification = Tables<"notifications">;
export type NotificationsCache = { notifications: AppNotification[] };

const READ_STAMP = "read"; // any non-null marker; server time wins on refetch

export function prependNotification(
  c: NotificationsCache,
  n: AppNotification,
): NotificationsCache {
  if (c.notifications.some((x) => x.id === n.id)) return c;
  return { notifications: [n, ...c.notifications] };
}

export function markRead(
  c: NotificationsCache,
  id: string,
): NotificationsCache {
  return {
    notifications: c.notifications.map((x) =>
      x.id === id && !x.read_at ? { ...x, read_at: READ_STAMP } : x,
    ),
  };
}

export function markAllRead(c: NotificationsCache): NotificationsCache {
  return {
    notifications: c.notifications.map((x) =>
      x.read_at ? x : { ...x, read_at: READ_STAMP },
    ),
  };
}

export function unreadCount(c: NotificationsCache): number {
  return c.notifications.reduce((n, x) => (x.read_at ? n : n + 1), 0);
}
