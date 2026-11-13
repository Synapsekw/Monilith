import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

const { redeemInvitationsForUser, provisionAccountForUser, requestClient } =
  vi.hoisted(() => ({
    redeemInvitationsForUser: vi.fn(),
    provisionAccountForUser: vi.fn(),
    requestClient: { tag: "request-client" },
  }));

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
