import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const markNotificationRead = vi.fn();
const markAllNotificationsRead = vi.fn();
vi.mock("@/lib/collaboration/actions", () => ({
  markNotificationRead: (...a: unknown[]) => markNotificationRead(...a),
  markAllNotificationsRead: (...a: unknown[]) => markAllNotificationsRead(...a),
}));
// `notificationsKey` lives next to the realtime hook; importing the real module
// would drag the browser Supabase client into jsdom for a one-line key helper.
vi.mock("@/lib/collaboration/use-notifications", () => ({
  notificationsKey: (userId: string) => ["notifications", userId] as const,
}));

import { useNotificationMutations } from "./use-notification-mutations";
import type {
  AppNotification,
  NotificationsCache,
} from "./notifications-cache";

const USER = "u1";
const KEY = ["notifications", USER] as const;

const row = (id: string, read_at: string | null = null) =>
  ({ id, read_at }) as unknown as AppNotification;

function setup(seed?: NotificationsCache) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  if (seed) qc.setQueryData<NotificationsCache>(KEY, seed);
  const invalidate = vi.spyOn(qc, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useNotificationMutations(USER), {
    wrapper,
  });
  const cached = () => qc.getQueryData<NotificationsCache>(KEY);
  return { result, invalidate, cached };
}

beforeEach(() => {
  markNotificationRead.mockReset().mockResolvedValue({ ok: true });
  markAllNotificationsRead.mockReset().mockResolvedValue({ ok: true });
});

describe("useNotificationMutations", () => {
  it("marks one read optimistically and does NOT refetch the list on success", async () => {
    // The optimistic patch is already the final state, and the realtime UPDATE
    // handler (use-notifications.ts) swaps in the server row. A refetch here
    // re-read all 30 rows per click and could flicker a queued second
    // mark-read back to unread.
    const { result, invalidate, cached } = setup({
      notifications: [row("n1"), row("n2")],
    });

    act(() => result.current.markRead("n1"));

    await waitFor(() =>
      expect(markNotificationRead).toHaveBeenCalledWith({
        notificationId: "n1",
      }),
    );
    await waitFor(() =>
      expect(cached()?.notifications[0].read_at).toBeTruthy(),
    );
    // Let onSuccess run before asserting what it did not do.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(cached()?.notifications[1].read_at).toBeNull();
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("marks all read optimistically and does NOT refetch the list on success", async () => {
    const { result, invalidate, cached } = setup({
      notifications: [row("n1"), row("n2"), row("n3", "2026-01-01T00:00:00Z")],
    });

    act(() => result.current.markAllRead());

    await waitFor(() => expect(markAllNotificationsRead).toHaveBeenCalled());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(cached()?.notifications.every((n) => n.read_at)).toBe(true);
    // An already-read row keeps its real server timestamp.
    expect(cached()?.notifications[2].read_at).toBe("2026-01-01T00:00:00Z");
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("DOES refetch when there was no cached list to patch", async () => {
    // Nothing optimistic happened, and `cancelQueries` may have dropped the
    // list's initial load — a refetch is then the only way the list arrives.
    const { result, invalidate } = setup();

    act(() => result.current.markAllRead());

    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: KEY }),
    );
  });

  it("rolls the optimistic patch back when the action fails", async () => {
    markNotificationRead.mockResolvedValue({ ok: false, error: "nope" });
    const { result, invalidate, cached } = setup({
      notifications: [row("n1")],
    });

    act(() => result.current.markRead("n1"));

    await waitFor(() => expect(markNotificationRead).toHaveBeenCalled());
    await waitFor(() => expect(cached()?.notifications[0].read_at).toBeNull());
    expect(invalidate).not.toHaveBeenCalled();
  });
});
