import { afterEach, describe, expect, it, vi } from "vitest";

// vi.hoisted() ensures these are initialized before the vi.mock() factories
// run (vi.mock is hoisted to the top of the module by Vitest, before const
// declarations). The assertions are identical to the plan.
const { getUser, authGetUser } = vi.hoisted(() => ({
  // Cached local-verify session — the source we want these queries to use.
  getUser: vi.fn(async () => ({ id: "u1", email: "u@x.com" })),
  // Spy that MUST NOT be called: the network auth round-trip.
  authGetUser: vi.fn(async () => ({ data: { user: { id: "u1" } } })),
}));

vi.mock("@/lib/auth/session", () => ({ getUser }));

// Minimal chainable + thenable supabase stub. Awaited chains resolve to an empty
// list; `.maybeSingle()` resolves to a board owned by u1.
function makeChain() {
  const thenable: Record<string, unknown> = {
    select: () => thenable,
    eq: () => thenable,
    in: () => thenable,
    not: () => thenable,
    limit: () => thenable,
    order: () => thenable,
    maybeSingle: async () => ({ data: { created_by: "u1" }, error: null }),
    then: (onF: (r: { data: unknown[]; error: null }) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(onF),
  };
  return thenable;
}
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: authGetUser },
    from: () => makeChain(),
  })),
}));

import { getBoardAccess, listMyBoards, listSharedBoards } from "./queries";

afterEach(() => vi.clearAllMocks());

describe("boards queries use the cached session, not network auth", () => {
  it("listMyBoards does not call supabase.auth.getUser", async () => {
    await listMyBoards();
    expect(getUser).toHaveBeenCalled();
    expect(authGetUser).not.toHaveBeenCalled();
  });

  it("listSharedBoards does not call supabase.auth.getUser", async () => {
    await listSharedBoards();
    expect(getUser).toHaveBeenCalled();
    expect(authGetUser).not.toHaveBeenCalled();
  });

  it("getBoardAccess does not call supabase.auth.getUser and resolves owner", async () => {
    const access = await getBoardAccess("b1");
    expect(authGetUser).not.toHaveBeenCalled();
    expect(access).toBe("owner");
  });
});
