import { describe, expect, it, vi } from "vitest";
import {
  fetchPendingInvitations,
  acceptInvitation,
  declineInvitation,
} from "./invitations-data";

describe("invitations-data", () => {
  it("fetchPendingInvitations returns the rows", async () => {
    const rows = [
      {
        id: "i1",
        org_id: "o1",
        org_name: "Acme",
        role: "member",
        created_at: "t",
      },
    ];
    const supabase = {
      rpc: vi.fn().mockResolvedValue({ data: rows, error: null }),
    } as never;
    expect(await fetchPendingInvitations(supabase)).toEqual(rows);
  });

  it("fetchPendingInvitations returns [] on error", async () => {
    const supabase = {
      rpc: vi.fn().mockResolvedValue({ data: null, error: { message: "x" } }),
    } as never;
    expect(await fetchPendingInvitations(supabase)).toEqual([]);
  });

  it("acceptInvitation passes the id and returns the org id", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "org-9", error: null });
    const supabase = { rpc } as never;
    expect(await acceptInvitation(supabase, "inv-1")).toBe("org-9");
    expect(rpc).toHaveBeenCalledWith("accept_invitation", {
      p_invite_id: "inv-1",
    });
  });

  it("acceptInvitation throws on error", async () => {
    const supabase = {
      rpc: vi
        .fn()
        .mockResolvedValue({ data: null, error: { message: "nope" } }),
    } as never;
    await expect(acceptInvitation(supabase, "inv-1")).rejects.toThrow("nope");
  });

  it("declineInvitation passes the id and throws on error", async () => {
    const ok = {
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    } as never;
    await expect(declineInvitation(ok, "inv-2")).resolves.toBeUndefined();
    const bad = {
      rpc: vi
        .fn()
        .mockResolvedValue({ data: null, error: { message: "boom" } }),
    } as never;
    await expect(declineInvitation(bad, "inv-2")).rejects.toThrow("boom");
  });
});
