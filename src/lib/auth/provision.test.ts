import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { provisionAccountForUser } from "./provision";

function makeUser(meta: Record<string, unknown>): User {
  return { id: "u1", user_metadata: meta } as unknown as User;
}

function makeSupabase(orgs: { id: string }[]) {
  const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
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
});
