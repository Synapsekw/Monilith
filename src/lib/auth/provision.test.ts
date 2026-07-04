import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { provisionAccountForUser } from "./provision";

function makeUser(meta: Record<string, unknown>): User {
  return { id: "u1", user_metadata: meta } as unknown as User;
}

function makeSupabase(
  orgs: { id: string }[],
  rpcResult: { data: unknown; error: { message: string } | null } = {
    data: null,
    error: null,
  },
) {
  const rpc = vi.fn().mockResolvedValue(rpcResult);
  const limit = vi.fn().mockResolvedValue({ data: orgs, error: null });
  const select = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ select }));
  const supabase = { from, rpc } as unknown as SupabaseClient<Database>;
  return { supabase, rpc, from };
}

describe("provisionAccountForUser", () => {
  it("calls provision_account when there is an org name and no org yet", async () => {
    const { supabase, rpc } = makeSupabase([]);
    await provisionAccountForUser(supabase, makeUser({ org_name: "Acme" }));
    expect(rpc).toHaveBeenCalledWith("provision_account", {
      p_org_name: "Acme",
    });
  });

  it("does nothing when the user already has an org", async () => {
    const { supabase, rpc } = makeSupabase([{ id: "org1" }]);
    await provisionAccountForUser(supabase, makeUser({ org_name: "Acme" }));
    expect(rpc).not.toHaveBeenCalled();
  });

  it("does nothing when there is no org name in metadata", async () => {
    const { supabase, rpc, from } = makeSupabase([]);
    await provisionAccountForUser(supabase, makeUser({}));
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("trims the org name before passing it to the RPC", async () => {
    const { supabase, rpc } = makeSupabase([]);
    await provisionAccountForUser(supabase, makeUser({ org_name: "  Acme  " }));
    expect(rpc).toHaveBeenCalledWith("provision_account", {
      p_org_name: "Acme",
    });
  });

  it("returns { error: null } on the happy path", async () => {
    const { supabase } = makeSupabase([]);
    const res = await provisionAccountForUser(
      supabase,
      makeUser({ org_name: "Acme" }),
    );
    expect(res).toEqual({ error: null });
  });

  it("surfaces the rpc error instead of silently swallowing it", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { supabase } = makeSupabase([], {
      data: null,
      error: { message: "boom" },
    });
    const res = await provisionAccountForUser(
      supabase,
      makeUser({ org_name: "Acme" }),
    );
    expect(res).toEqual({ error: "boom" });
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });

  it("returns { error: null } when it skips (already has an org)", async () => {
    const { supabase } = makeSupabase([{ id: "org1" }]);
    const res = await provisionAccountForUser(
      supabase,
      makeUser({ org_name: "Acme" }),
    );
    expect(res).toEqual({ error: null });
  });
});
