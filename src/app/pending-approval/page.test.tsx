import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const { getUser, readAccountApproval, redirect } = vi.hoisted(() => ({
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
vi.mock("@/app/auth/actions", () => ({ signOut: async () => {} }));
vi.mock("@/app/pending-approval/actions", () => ({
  checkApproval: async () => ({ ok: true, data: undefined }),
}));

import { PendingApprovalGate } from "./gate";

beforeEach(() => {
  getUser.mockReset().mockResolvedValue({ id: "u1", email: "new@example.com" });
  readAccountApproval.mockReset().mockResolvedValue("pending");
  redirect.mockClear();
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

  it("says so for a rejected account", async () => {
    readAccountApproval.mockResolvedValue("rejected");
    render(await PendingApprovalGate());
    expect(screen.getByText("Your account was not approved")).toBeTruthy();
    expect(screen.getByText("new@example.com")).toBeTruthy();
    expect(screen.getByRole("button", { name: /check again/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
  });
});
