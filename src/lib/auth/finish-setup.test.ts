import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

const {
  redeemInvitationsForUser,
  provisionAccountForUser,
  requestClient,
  revalidateTag,
} = vi.hoisted(() => ({
  redeemInvitationsForUser: vi.fn(),
  provisionAccountForUser: vi.fn(),
  requestClient: { tag: "request-client" },
  revalidateTag: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidateTag }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => requestClient,
}));
vi.mock("@/lib/auth/redeem", () => ({
  redeemInvitationsForUser: (...a: unknown[]) => redeemInvitationsForUser(...a),
}));
vi.mock("@/lib/auth/provision", () => ({
  provisionAccountForUser: (...a: unknown[]) => provisionAccountForUser(...a),
}));

import { finishAccountSetup } from "./finish-setup";

const user = {
  id: "u1",
  email: "a@b.com",
  user_metadata: { org_name: "Acme" },
  app_metadata: {},
};

beforeEach(() => {
  revalidateTag.mockReset();
  redeemInvitationsForUser.mockReset().mockResolvedValue(0);
  provisionAccountForUser.mockReset().mockResolvedValue({ error: null });
});

describe("finishAccountSetup", () => {
  it("does not provision when an invitation was redeemed", async () => {
    redeemInvitationsForUser.mockResolvedValue(1);

    expect(await finishAccountSetup(user)).toEqual({ ok: true });
    expect(redeemInvitationsForUser).toHaveBeenCalledTimes(1);
    expect(provisionAccountForUser).not.toHaveBeenCalled();
  });

  it("provisions the account when no invitation was redeemed", async () => {
    expect(await finishAccountSetup(user)).toEqual({ ok: true });
    expect(provisionAccountForUser).toHaveBeenCalledWith(requestClient, user);
  });

  it("redeems before provisioning", async () => {
    const order: string[] = [];
    redeemInvitationsForUser.mockImplementation(async () => {
      order.push("redeem");
      return 0;
    });
    provisionAccountForUser.mockImplementation(async () => {
      order.push("provision");
      return { error: null };
    });

    await finishAccountSetup(user);
    expect(order).toEqual(["redeem", "provision"]);
  });

  it("expires the user's access caches whether or not an org membership was counted", async () => {
    for (const count of [0, 1]) {
      revalidateTag.mockClear();
      redeemInvitationsForUser.mockResolvedValue(count);
      await finishAccountSetup(user);
      expect(revalidateTag.mock.calls.map((c) => c[0]).sort()).toEqual([
        "folder-members:user:u1",
        "shared-boards:user:u1",
      ]);
      expect(revalidateTag).toHaveBeenCalledWith(expect.any(String), {
        expire: 0,
      });
    }
  });

  it("still finishes setup when revalidation is not allowed (render phase)", async () => {
    revalidateTag.mockImplementation(() => {
      throw new Error("revalidateTag during render");
    });
    redeemInvitationsForUser.mockResolvedValue(1);
    expect(await finishAccountSetup(user)).toEqual({ ok: true });
  });

  it("reports a provisioning failure", async () => {
    provisionAccountForUser.mockResolvedValue({ error: "boom" });

    expect(await finishAccountSetup(user)).toEqual({
      ok: false,
      reason: "provisioning",
    });
  });

  it("uses the caller's client when one is passed (the callback's session client)", async () => {
    const callerClient = {
      tag: "caller",
    } as unknown as SupabaseClient<Database>;

    await finishAccountSetup(user, callerClient);
    expect(redeemInvitationsForUser).toHaveBeenCalledWith(callerClient);
    expect(provisionAccountForUser).toHaveBeenCalledWith(callerClient, user);
  });
});
