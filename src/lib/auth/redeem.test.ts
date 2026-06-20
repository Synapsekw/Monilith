import { describe, expect, it, vi } from "vitest";
import { redeemInvitationsForUser } from "./redeem";

describe("redeemInvitationsForUser", () => {
  it("returns the RPC count", async () => {
    const supabase = {
      rpc: vi.fn().mockResolvedValue({ data: 2, error: null }),
    } as never;
    expect(await redeemInvitationsForUser(supabase)).toBe(2);
  });
  it("returns 0 on error", async () => {
    const supabase = {
      rpc: vi.fn().mockResolvedValue({ data: null, error: { message: "x" } }),
    } as never;
    expect(await redeemInvitationsForUser(supabase)).toBe(0);
  });
});
