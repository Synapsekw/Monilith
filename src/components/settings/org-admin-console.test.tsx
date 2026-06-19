import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { OrgAdminConsole } from "./org-admin-console";
import type { Member } from "./members-table";

// Tab state is read from useSearchParams; default to no `?tab` param.
let currentParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useSearchParams: () => currentParams,
}));

// Child components import the action modules; mock so they mount cleanly.
vi.mock("@/lib/org/admin-actions", () => ({
  setMemberRole: vi.fn(),
  removeMember: vi.fn(),
  deactivateMember: vi.fn(),
  reactivateMember: vi.fn(),
  resetMemberPassword: vi.fn(),
  inviteMember: vi.fn(),
  revokeInvite: vi.fn(),
}));
vi.mock("@/lib/platform/actions", () => ({
  platformSetOrgRole: vi.fn(),
}));

const members: Member[] = [
  {
    user_id: "u-1",
    email: "a@x.com",
    full_name: "Member A",
    role: "member",
    deactivated_at: null,
  },
];

function renderConsole() {
  return render(
    <OrgAdminConsole
      orgId="org-1"
      members={members}
      invites={[]}
      audit={[]}
      currentUserId="u-owner"
      currentUserRole="owner"
    />,
  );
}

beforeEach(() => {
  currentParams = new URLSearchParams();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("OrgAdminConsole", () => {
  it("shows the Members tab by default", () => {
    renderConsole();
    // The members table renders the member's name; the invite empty-state is absent.
    expect(screen.getByText("Member A")).toBeInTheDocument();
    expect(screen.queryByText("No pending invites.")).not.toBeInTheDocument();
  });

  it("pushes ?tab=invitations via the History API (no router navigation)", () => {
    const pushState = vi.spyOn(window.history, "pushState");
    renderConsole();
    fireEvent.click(screen.getByRole("tab", { name: "invitations" }));
    expect(pushState).toHaveBeenCalledTimes(1);
    const url = pushState.mock.calls[0]![2] as string;
    expect(url).toContain("tab=invitations");
  });

  it("renders the Activity tab content when ?tab=activity is set", () => {
    currentParams = new URLSearchParams("tab=activity");
    renderConsole();
    expect(screen.getByText("No activity yet.")).toBeInTheDocument();
  });
});
