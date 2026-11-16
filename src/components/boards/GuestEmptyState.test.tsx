import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { PendingInvitation } from "@/lib/collaboration/invitations";

const { onAccept, onDecline } = vi.hoisted(() => ({
  onAccept: vi.fn(),
  onDecline: vi.fn(),
}));
let mockInvites: PendingInvitation[] = [];
vi.mock("@/lib/collaboration/use-invitations", () => ({
  useInvitations: () => ({ invites: mockInvites, count: mockInvites.length }),
}));
vi.mock("@/lib/collaboration/use-invitation-responses", () => ({
  useInvitationResponses: () => ({
    onAccept,
    onDecline,
    pendingId: null,
    error: null,
  }),
}));

import { GuestEmptyState } from "./GuestEmptyState";

beforeEach(() => {
  mockInvites = [];
  onAccept.mockReset();
  onDecline.mockReset();
});

describe("GuestEmptyState", () => {
  it("explains what a guest will see and offers nothing to create", () => {
    render(<GuestEmptyState orgName="Acme" userId="u1" hasFolders={false} />);
    expect(
      screen.getByRole("heading", { name: "You're a guest in Acme" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Folders and boards that people share with you/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Nothing has been shared with you yet/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/create/i)).toBeNull();
    expect(screen.queryByText(/template/i)).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("links to the folders when the guest is on one that holds no boards", () => {
    render(<GuestEmptyState orgName="Acme" userId="u1" hasFolders />);
    expect(
      screen.getByRole("link", { name: "Open your folders" }),
    ).toHaveAttribute("href", "/dashboards");
    expect(screen.queryByText(/Nothing has been shared/)).toBeNull();
  });

  it("lists pending invitations and accepts one by id", () => {
    mockInvites = [
      {
        id: "inv-9",
        org_id: "o2",
        org_name: "Beta",
        role: "guest",
        created_at: "2026-11-15T00:00:00Z",
        inviter_name: "Ann",
        folder_id: "f-1",
        folder_name: "Launch",
        folder_count: 1,
      },
    ];
    render(<GuestEmptyState orgName="Acme" userId="u1" hasFolders={false} />);
    expect(
      screen.getByText("Ann invited you to the folder Launch in Beta"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(onAccept).toHaveBeenCalledWith("inv-9");
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    expect(onDecline).toHaveBeenCalledWith("inv-9");
  });
});
