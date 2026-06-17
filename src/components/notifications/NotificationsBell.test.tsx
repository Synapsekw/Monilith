import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const markRead = vi.fn();
const markAllRead = vi.fn();
let mockUnread = 0;
let mockNotifications: unknown[] = [];

vi.mock("@/lib/collaboration/use-notifications", () => ({
  useNotifications: () => ({
    query: { data: { notifications: mockNotifications } },
    unread: mockUnread,
  }),
}));
vi.mock("@/lib/collaboration/use-notification-mutations", () => ({
  useNotificationMutations: () => ({ markRead, markAllRead }),
}));

import { NotificationsBell } from "@/components/notifications/NotificationsBell";

describe("NotificationsBell", () => {
  it("shows the unread count on the badge", () => {
    mockUnread = 2;
    mockNotifications = [];
    render(<NotificationsBell userId="u1" />);
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("renders no badge when there are no unread", () => {
    mockUnread = 0;
    mockNotifications = [];
    render(<NotificationsBell userId="u1" />);
    expect(screen.queryByText(/^\d+$/)).not.toBeInTheDocument();
  });
});
