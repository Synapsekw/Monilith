import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const { getUser, readAccountApproval, redirect, rpc } = vi.hoisted(() => ({
  rpc: vi.fn(),
  getUser: vi.fn(),
  readAccountApproval: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock("next/navigation", () => ({ redirect: (u: string) => redirect(u) }));
vi.mock("@/lib/auth/session", () => ({
  getUser: () => getUser(),
  loginRedirectPath: async () => "/login?next=%2Fpending-approval",
}));
vi.mock("@/lib/auth/approval", () => ({
  readAccountApproval: (id: string) => readAccountApproval(id),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc: (name: string) => rpc(name) }),
}));
vi.mock("@/app/auth/actions", () => ({ signOut: async () => {} }));
vi.mock("@/app/pending-approval/actions", () => ({
  checkApproval: async () => ({ ok: true, data: undefined }),
}));

import { PendingApprovalGate } from "./gate";

beforeEach(() => {
  getUser.mockReset().mockResolvedValue({ id: "u1", email: "new@example.com" });
  readAccountApproval.mockReset().mockResolvedValue("pending");
  redirect.mockClear();
  rpc.mockReset().mockResolvedValue({ data: [], error: null });
});

describe("PendingApprovalGate", () => {
  it("sends a visitor with no session to login", async () => {
    getUser.mockResolvedValue(null);
    await expect(PendingApprovalGate()).rejects.toThrow(
      "REDIRECT:/login?next=%2Fpending-approval",
    );
    expect(readAccountApproval).not.toHaveBeenCalled();
  });

  it("sends an approved account to /home", async () => {
    readAccountApproval.mockResolvedValue("approved");
    await expect(PendingApprovalGate()).rejects.toThrow("REDIRECT:/home");
  });

  it("explains the wait for a pending account", async () => {
    render(await PendingApprovalGate());
    expect(
      screen.getByText("Your account is waiting for approval"),
    ).toBeTruthy();
    expect(screen.getByText(/administrator has to approve/i)).toBeTruthy();
    expect(
      screen.getByText(/You can close this page and sign in again later\./),
    ).toBeTruthy();
    expect(screen.queryByText(/check back soon/i)).toBeNull();
    expect(screen.getByText("new@example.com")).toBeTruthy();
    expect(screen.getByRole("button", { name: /check again/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
  });

  it("shows no invitation block to someone who simply signed up", async () => {
    render(await PendingApprovalGate());
    expect(rpc).toHaveBeenCalledWith("my_pending_invitations");
    expect(screen.queryByTestId("pending-invitations")).toBeNull();
  });

  it("tells an invited person their folder invitation is saved", async () => {
    rpc.mockResolvedValue({
      data: [
        {
          id: "inv-1",
          org_id: "o1",
          org_name: "Acme",
          role: "guest",
          created_at: "2026-11-15T00:00:00Z",
          inviter_name: "Ann",
          folder_id: "f1",
          folder_name: "Launch",
          folder_count: 1,
        },
      ],
      error: null,
    });
    render(await PendingApprovalGate());
    expect(
      screen.getByText("Ann invited you to the folder Launch in Acme."),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Your invitation is saved. You get access as soon as your account is approved.",
      ),
    ).toBeTruthy();
    // The wait itself is still explained.
    expect(
      screen.getByText("Your account is waiting for approval"),
    ).toBeTruthy();
  });

  it("still renders the wait when the invitations read fails", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    render(await PendingApprovalGate());
    expect(
      screen.getByText("Your account is waiting for approval"),
    ).toBeTruthy();
    expect(screen.queryByTestId("pending-invitations")).toBeNull();
  });

  it("does not read or show invitations for a rejected account", async () => {
    readAccountApproval.mockResolvedValue("rejected");
    rpc.mockResolvedValue({
      data: [{ id: "inv-1", org_name: "Acme", role: "guest" }],
      error: null,
    });
    render(await PendingApprovalGate());
    expect(rpc).not.toHaveBeenCalled();
    expect(screen.queryByTestId("pending-invitations")).toBeNull();
  });

  it("says so for a rejected account", async () => {
    readAccountApproval.mockResolvedValue("rejected");
    render(await PendingApprovalGate());
    expect(screen.getByText("Your account was not approved")).toBeTruthy();
    expect(screen.getByText("new@example.com")).toBeTruthy();
    expect(screen.getByRole("button", { name: /check again/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
  });
});
