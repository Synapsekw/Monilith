import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { InvitePanel, type Invite } from "./invite-panel";

const inviteMember = vi.fn();
const revokeInvite = vi.fn();

vi.mock("@/lib/org/admin-actions", () => ({
  inviteMember: (...args: unknown[]) => inviteMember(...args),
  revokeInvite: (...args: unknown[]) => revokeInvite(...args),
}));

const ORG = "org-1";

beforeEach(() => {
  inviteMember.mockReset().mockResolvedValue({ ok: true });
  revokeInvite.mockReset().mockResolvedValue({ ok: true });
});

describe("InvitePanel", () => {
  it("submits the form with { orgId, email, role }", () => {
    render(<InvitePanel orgId={ORG} invites={[]} />);
    fireEvent.change(screen.getByLabelText("Invite email"), {
      target: { value: "new@x.com" },
    });
    fireEvent.change(screen.getByLabelText("Invite role"), {
      target: { value: "admin" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Invite" }));
    expect(inviteMember).toHaveBeenCalledWith({
      orgId: ORG,
      email: "new@x.com",
      role: "admin",
    });
  });

  it("shows an empty state when there are no pending invites", () => {
    render(<InvitePanel orgId={ORG} invites={[]} />);
    expect(screen.getByText("No pending invites.")).toBeInTheDocument();
  });

  it("calls revokeInvite with the invite id when Revoke is clicked", () => {
    const invites: Invite[] = [
      {
        id: "inv-1",
        email: "pending@x.com",
        role: "member",
        status: "pending",
        created_at: new Date().toISOString(),
      },
    ];
    render(<InvitePanel orgId={ORG} invites={invites} />);
    const row = screen.getByText("pending@x.com").closest("li")!;
    fireEvent.click(within(row).getByRole("button", { name: "Revoke" }));
    expect(revokeInvite).toHaveBeenCalledWith({ inviteId: "inv-1" });
  });

  it("shows Re-invite (not Revoke) for a declined invite and re-invites with the same email/role", () => {
    const invites: Invite[] = [
      {
        id: "inv-2",
        email: "declined@x.com",
        role: "member",
        status: "declined",
        created_at: new Date().toISOString(),
      },
    ];
    render(<InvitePanel orgId={ORG} invites={invites} />);
    const row = screen.getByText("declined@x.com").closest("li")!;
    expect(within(row).queryByRole("button", { name: "Revoke" })).toBeNull();
    fireEvent.click(within(row).getByRole("button", { name: "Re-invite" }));
    expect(inviteMember).toHaveBeenCalledWith({
      orgId: ORG,
      email: "declined@x.com",
      role: "member",
    });
  });
});
