import { afterEach, describe, expect, it, vi } from "vitest";

// redirect() throws to halt, like the real next/navigation.
const { redirect, getUser, getUserOrgs, rpc, from } = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  getUser: vi.fn(),
  getUserOrgs: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirect(url),
}));
vi.mock("@/lib/auth/session", () => ({ getUser, getUserOrgs }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc, from }),
}));

import { createWorkspaceOrg } from "./actions";

function formData(orgName = "Acme Corp", workspaceName = "Main") {
  const fd = new FormData();
  fd.set("orgName", orgName);
  fd.set("workspaceName", workspaceName);
  return fd;
}

function signedIn() {
  getUser.mockResolvedValue({ id: "u1", email: "a@b.com" });
}

afterEach(() => vi.clearAllMocks());

describe("createWorkspaceOrg", () => {
  it("rejects invalid input before touching the database", async () => {
    const res = await createWorkspaceOrg({}, formData(""));
    expect(res.error).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated callers", async () => {
    getUser.mockResolvedValue(null);
    const res = await createWorkspaceOrg({}, formData());
    expect(res).toEqual({ error: "You must be signed in to continue." });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a caller who already belongs to an org (no second org via direct invocation)", async () => {
    // The onboarding PAGE redirects members away, but the action is directly
    // invokable — re-assert the same gate server-side (audit finding 3).
    signedIn();
    getUserOrgs.mockResolvedValue([
      { id: "o1", name: "Acme", timezone: "UTC" },
    ]);

    const res = await createWorkspaceOrg({}, formData());
    expect(res).toEqual({ error: "You already belong to an organization." });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns a friendly error when the org-membership guard read fails", async () => {
    signedIn();
    getUserOrgs.mockRejectedValue(new Error("connection refused"));

    const res = await createWorkspaceOrg({}, formData());
    expect(res).toEqual({
      error: "Could not verify your account. Please try again.",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("creates org + workspace atomically via the RPC (no separate workspaces insert)", async () => {
    signedIn();
    getUserOrgs.mockResolvedValue([]);
    rpc.mockResolvedValue({ data: { id: "org1" }, error: null });

    await expect(createWorkspaceOrg({}, formData())).rejects.toThrow(
      "REDIRECT:/",
    );

    expect(rpc).toHaveBeenCalledTimes(1);
    const [fn, args] = rpc.mock.calls[0];
    expect(fn).toBe("create_organization");
    expect(args.p_name).toBe("Acme Corp");
    expect(args.p_slug).toMatch(/^acme-corp-[0-9a-f]{6}$/);
    expect(args.p_workspace_name).toBe("Main");
    // The two-step org-then-workspace insert is what left half-provisioned
    // orgs behind (audit finding 2) — it must be gone.
    expect(from).not.toHaveBeenCalled();
  });

  it("surfaces the RPC's own guard message (P0001) verbatim", async () => {
    signedIn();
    getUserOrgs.mockResolvedValue([]);
    rpc.mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "You already have an organization." },
    });

    const res = await createWorkspaceOrg({}, formData());
    expect(res).toEqual({ error: "You already have an organization." });
  });

  it("maps other DB errors to a friendly message, not raw Postgres text", async () => {
    signedIn();
    getUserOrgs.mockResolvedValue([]);
    rpc.mockResolvedValue({
      data: null,
      error: {
        code: "23505",
        message:
          'duplicate key value violates unique constraint "organizations_slug_key"',
      },
    });

    const res = await createWorkspaceOrg({}, formData());
    expect(res.error).toBe(
      "Could not create your organization. Please try again.",
    );
    expect(res.error).not.toMatch(/duplicate key/);
  });
});
