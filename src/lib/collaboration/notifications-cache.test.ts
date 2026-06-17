import { describe, it, expect } from "vitest";
import {
  prependNotification,
  markRead,
  markAllRead,
  unreadCount,
  type NotificationsCache,
} from "@/lib/collaboration/notifications-cache";
import type { Tables } from "@/types/database.types";

function n(id: string, read = false): Tables<"notifications"> {
  return {
    id,
    org_id: "o",
    recipient_id: "u",
    actor_id: "a",
    kind: "mention",
    board_id: "b",
    item_id: "i",
    update_id: null,
    read_at: read ? "2026-06-17T00:00:00Z" : null,
    created_at: "2026-06-17T00:00:00Z",
  } as Tables<"notifications">;
}

describe("notifications cache", () => {
  it("prepends + de-dupes by id", () => {
    let c: NotificationsCache = { notifications: [n("a")] };
    c = prependNotification(c, n("b"));
    expect(c.notifications.map((x) => x.id)).toEqual(["b", "a"]);
    c = prependNotification(c, n("b"));
    expect(c.notifications).toHaveLength(2);
  });
  it("marks one + all read; counts unread", () => {
    let c: NotificationsCache = { notifications: [n("a"), n("b")] };
    expect(unreadCount(c)).toBe(2);
    c = markRead(c, "a");
    expect(unreadCount(c)).toBe(1);
    c = markAllRead(c);
    expect(unreadCount(c)).toBe(0);
  });
});
