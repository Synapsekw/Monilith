import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MembersTable, type Member } from "./members-table";

const setMemberRole = vi.fn();
const removeMember = vi.fn();
const deactivateMember = vi.fn();
const reactivateMember = vi.fn();
const resetMemberPassword = vi.fn();
const platformSetOrgRole = vi.fn();

vi.mock("@/lib/org/admin-actions", () => ({
  setMemberRole: (...args: unknown[]) => setMemberRole(...args),
  removeMember: (...args: unknown[]) => removeMember(...args),
  deactivateMember: (...args: unknown[]) => deactivateMember(...args),
  reactivateMember: (...args: unknown[]) => reactivateMember(...args),
  resetMemberPassword: (...args: unknown[]) => resetMemberPassword(...args),
}));
vi.mock("@/lib/platform/actions", () => ({
  platformSetOrgRole: (...args: unknown[]) => platformSetOrgRole(...args),
}));

const ORG = "org-1";
const ownerRow: Member = {
  user_id: "u-owner",
  email: "owner@x.com",
  full_name: "Olive Owner",
  role: "owner",
  deactivated_at: null,
};
const memberRow: Member = {
  user_id: "u-member",
  email: "member@x.com",
  full_name: "Mel Member",
  role: "member",
  deactivated_at: null,
};

beforeEach(() => {
  setMemberRole.mockReset().mockResolvedValue({ ok: true });
  removeMember.mockReset().mockResolvedValue({ ok: true });
  deactivateMember.mockReset().mockResolvedValue({ ok: true });
  reactivateMember.mockReset().mockResolvedValue({ ok: true });
  resetMemberPassword.mockReset().mockResolvedValue({ ok: true });
  platformSetOrgRole.mockReset().mockResolvedValue({ ok: true });
});

describe("MembersTable hierarchy disabled-states", () => {
  it("disables the role select on an owner row when current user is an admin", () => {
    render(
      <MembersTable
        orgId={ORG}
        members={[ownerRow, memberRow]}
        currentUserId="u-admin"
        currentUserRole="admin"
        mode="org"
      />,
    );
    const select = screen.getByLabelText(
      `Role for ${ownerRow.email}`,
    ) as HTMLSelectElement;
    expect(select).toBeDisabled();
  });

  it("enables the role select on a member row when current user is an owner", () => {
    render(
      <MembersTable
        orgId={ORG}
        members={[ownerRow, memberRow]}
        currentUserId="u-owner"
        currentUserRole="owner"
        mode="org"
      />,
    );
    const select = screen.getByLabelText(`Role for ${memberRow.email}`);
    expect(select).not.toBeDisabled();
  });

  it("disables Remove on the current user's own row", () => {
    render(
      <MembersTable
        orgId={ORG}
        members={[ownerRow]}
        currentUserId="u-owner"
        currentUserRole="owner"
        mode="org"
      />,
    );
    const row = screen.getByText("Olive Owner").closest("tr")!;
    const removeBtn = within(row).getByRole("button", { name: "Remove" });
    expect(removeBtn).toBeDisabled();
  });
});

describe("MembersTable actions", () => {
  it("calls setMemberRole with the right args when a member's role changes", () => {
    render(
      <MembersTable
        orgId={ORG}
        members={[ownerRow, memberRow]}
        currentUserId="u-owner"
        currentUserRole="owner"
        mode="org"
      />,
    );
    const select = screen.getByLabelText(`Role for ${memberRow.email}`);
    fireEvent.change(select, { target: { value: "admin" } });
    expect(setMemberRole).toHaveBeenCalledWith({
      orgId: ORG,
      userId: memberRow.user_id,
      role: "admin",
    });
  });

  it("routes role changes through platformSetOrgRole in platform mode", () => {
    render(
      <MembersTable
        orgId={ORG}
        members={[memberRow]}
        currentUserId="platform-admin"
        currentUserRole="owner"
        mode="platform"
      />,
    );
    const select = screen.getByLabelText(`Role for ${memberRow.email}`);
    fireEvent.change(select, { target: { value: "admin" } });
    expect(platformSetOrgRole).toHaveBeenCalledWith({
      orgId: ORG,
      userId: memberRow.user_id,
      role: "admin",
    });
    expect(setMemberRole).not.toHaveBeenCalled();
  });
});
