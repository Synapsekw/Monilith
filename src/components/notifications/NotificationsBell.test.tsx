import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { PendingInvitation } from "@/lib/collaboration/invitations";

const markRead = vi.fn();
const markAllRead = vi.fn();
const acceptMutate = vi.fn();
const declineMutate = vi.fn();
let mockUnread = 0;
let mockNotifications: unknown[] = [];
let mockInvites: PendingInvitation[] = [];

vi.mock("@/lib/collaboration/use-notifications", () => ({
  useNotifications: () => ({
    query: { data: { notifications: mockNotifications } },
    unread: mockUnread,
  }),
}));
vi.mock("@/lib/collaboration/use-notification-mutations", () => ({
  useNotificationMutations: () => ({ markRead, markAllRead }),
}));
vi.mock("@/lib/collaboration/use-invitations", () => ({
  useInvitations: () => ({
    query: { data: mockInvites },
    invites: mockInvites,
    count: mockInvites.length,
  }),
}));
const { toast } = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), { success: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/lib/org/active-actions", () => ({ setActiveOrg: vi.fn() }));
vi.mock("@/lib/collaboration/use-invitation-mutations", () => ({
  useInvitationMutations: () => ({
    accept: {
      mutate: acceptMutate,
      isPending: false,
      variables: undefined,
      error: null,
    },
    decline: {
      mutate: declineMutate,
      isPending: false,
      variables: undefined,
      error: null,
    },
  }),
}));

import { NotificationsBell } from "@/components/notifications/NotificationsBell";

const invite: PendingInvitation = {
  id: "inv-1",
  org_id: "org-1",
  org_name: "Acme Inc",
  role: "member",
  created_at: new Date().toISOString(),
};

beforeEach(() => {
  mockUnread = 0;
  mockNotifications = [];
  mockInvites = [];
  acceptMutate.mockReset();
  declineMutate.mockReset();
  toast.mockReset();
  toast.success.mockReset();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe("NotificationsBell", () => {
  it("badge counts unread notifications plus pending invites", () => {
    mockUnread = 2;
    mockInvites = [invite];
    render(<NotificationsBell userId="u1" />);
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("renders no badge when there are no unread and no invites", () => {
    render(<NotificationsBell userId="u1" />);
    expect(screen.queryByText(/^\d+$/)).not.toBeInTheDocument();
  });

  it("publishes the badge count to the desktop shell when the bridge is present", () => {
    const setBadge = vi.fn();
    (window as { monolith?: unknown }).monolith = { setBadge };
    mockUnread = 2;
    mockInvites = [invite];

    render(<NotificationsBell userId="u1" />);

    // The same number the bell renders — not `unread` — so the dock and the
    // in-app badge can never disagree.
    expect(setBadge).toHaveBeenCalledWith(3);
    delete (window as { monolith?: unknown }).monolith;
  });

  it("does not throw in a plain browser, where there is no bridge", () => {
    expect((window as { monolith?: unknown }).monolith).toBeUndefined();
    mockUnread = 1;
    expect(() => render(<NotificationsBell userId="u1" />)).not.toThrow();
  });

  it("shows the invitation and accepts it by id", () => {
    mockInvites = [invite];
    render(<NotificationsBell userId="u1" />);
    fireEvent.click(screen.getByLabelText("Notifications"));
    expect(screen.getByText(/Acme Inc/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(acceptMutate).toHaveBeenCalled();
    expect(acceptMutate.mock.calls[0][0]).toBe("inv-1");
  });

  it("announces a pending invitation once, naming the folder, and opens the bell from it", () => {
    mockInvites = [
      {
        ...invite,
        role: "guest",
        inviter_name: "Ann",
        folder_id: "f-1",
        folder_name: "Launch",
        folder_count: 1,
      },
    ];
    const first = render(<NotificationsBell userId="u1" />);
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0][0]).toBe(
      "Ann invited you to the folder Launch in Acme Inc",
    );
    // The toast's action opens the bell on the invitation.
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
    act(() => toast.mock.calls[0][1].action.onClick());
    expect(screen.getByRole("button", { name: "Accept" })).toBeInTheDocument();
    first.unmount();

    // Next page load in the same browser: already announced, not repeated.
    render(<NotificationsBell userId="u1" />);
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it("announces nothing when there is no invitation", () => {
    render(<NotificationsBell userId="u1" />);
    expect(toast).not.toHaveBeenCalled();
  });

  it("announces again for a different user on the same browser", () => {
    mockInvites = [invite];
    render(<NotificationsBell userId="u1" />).unmount();
    render(<NotificationsBell userId="u2" />);
    expect(toast).toHaveBeenCalledTimes(2);
  });

  it("shows the message left by an accept, once", () => {
    window.sessionStorage.setItem(
      "monolith:invite-flash",
      "You now have access to the folder Launch in Acme Inc",
    );
    render(<NotificationsBell userId="u1" />).unmount();
    expect(toast.success).toHaveBeenCalledWith(
      "You now have access to the folder Launch in Acme Inc",
    );
    render(<NotificationsBell userId="u1" />);
    expect(toast.success).toHaveBeenCalledTimes(1);
  });
});
