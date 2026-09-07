import { afterEach, describe, expect, it, vi } from "vitest";

// vi.hoisted() ensures these are initialized before the vi.mock() factories
// run (vi.mock is hoisted to the top of the module by Vitest, before const
// declarations). The assertions are identical to the plan.
const { getUser, authGetUser, listState } = vi.hoisted(() => ({
  // Cached local-verify session — the source we want these queries to use.
  getUser: vi.fn(async () => ({ id: "u1", email: "u@x.com" })),
  // Spy that MUST NOT be called: the network auth round-trip.
  authGetUser: vi.fn(async () => ({ data: { user: { id: "u1" } } })),
  // What an awaited list chain resolves to; tests flip it to an error result.
  listState: {
    result: { data: [], error: null } as {
      data: unknown[] | null;
      error: { message: string } | null;
    },
  },
}));

vi.mock("@/lib/auth/session", () => ({ getUser }));

// Minimal chainable + thenable supabase stub. Awaited chains resolve to
// `listState.result` (empty list by default); `.maybeSingle()` resolves to a
// board owned by u1.
function makeChain() {
  const thenable: Record<string, unknown> = {
    select: () => thenable,
    eq: () => thenable,
    is: () => thenable,
    in: () => thenable,
    not: () => thenable,
    limit: () => thenable,
    order: () => thenable,
    maybeSingle: async () => ({ data: { created_by: "u1" }, error: null }),
    then: (
      onF: (r: {
        data: unknown[] | null;
        error: { message: string } | null;
      }) => unknown,
    ) => Promise.resolve(listState.result).then(onF),
  };
  return thenable;
}
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: authGetUser },
    from: () => makeChain(),
  })),
}));

import {
  deriveBoardAccess,
  getBoardAccess,
  getBoardAccessCore,
  listMyBoards,
  listSharedBoards,
} from "./queries";

afterEach(() => {
  vi.clearAllMocks();
  listState.result = { data: [], error: null };
});

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

describe("boards list queries fail loudly on DB errors", () => {
  // A silent [] on error is indistinguishable from "no boards": /home would
  // route a user with boards to the first-run empty state (or, upstream of
  // it, onboarding). A DB failure is not an empty list — throw so the error
  // boundary renders (same policy as getBoardPayload).
  it("listMyBoards throws when the boards read errors", async () => {
    listState.result = { data: null, error: { message: "connection refused" } };
    await expect(listMyBoards()).rejects.toThrow(
      /Failed to load boards: connection refused/,
    );
  });

  it("listSharedBoards throws when the board_members read errors", async () => {
    listState.result = { data: null, error: { message: "connection refused" } };
    await expect(listSharedBoards()).rejects.toThrow(
      /Failed to load shared boards: connection refused/,
    );
  });

  it("both still resolve [] for a genuinely empty result", async () => {
    expect(await listMyBoards()).toEqual([]);
    expect(await listSharedBoards()).toEqual([]);
  });
});

describe("deriveBoardAccess", () => {
  const board = { created_by: "owner-1" };
  const grants = [
    { userId: "editor-1", access: "editor" as const },
    { userId: "viewer-1", access: "viewer" as const },
  ];

  it("returns owner when the user created the board, regardless of any grant", () => {
    expect(deriveBoardAccess(board, grants, "owner-1")).toBe("owner");
  });

  it("returns editor for a user with an editor grant", () => {
    expect(deriveBoardAccess(board, grants, "editor-1")).toBe("editor");
  });

  it("returns viewer for a user with a viewer grant", () => {
    expect(deriveBoardAccess(board, grants, "viewer-1")).toBe("viewer");
  });

  it("returns null for a user with no grant and who is not the creator", () => {
    expect(deriveBoardAccess(board, grants, "stranger-1")).toBeNull();
  });

  it("matches getBoardAccess's decision order: creator check wins even if also granted", () => {
    // Defensive case: an owner should never also carry a board_members row in
    // practice, but if one existed, creator identity still wins (same order
    // getBoardAccess uses: created_by check before the grants lookup).
    const grantsWithOwnerRow = [
      ...grants,
      { userId: "owner-1", access: "viewer" as const },
    ];
    expect(deriveBoardAccess(board, grantsWithOwnerRow, "owner-1")).toBe(
      "owner",
    );
  });
});

/**
 * Structural fake for `getBoardAccessCore`'s Supabase surface, following the
 * argument-aware style of `src/test/mcp-fake-client.ts`. It matches the exact
 * call chain `getBoardAccessCore` issues (read at `./queries.ts:114-140`):
 *   - `.from("boards").select("created_by").eq("id", boardId).maybeSingle()`
 *   - `.from("board_members").select("access_level").eq("board_id", …).eq("user_id", …).maybeSingle()`
 * The `eq(...).eq(...)` shape on `board_members` needs the intermediate link
 * to expose BOTH `.eq()` and `.maybeSingle()`, since `boards`' single-`eq`
 * chain terminates one level earlier.
 */
function fakeBoardAccessClient(opts: {
  created_by: string | null;
  grant: { role: "editor" | "viewer" } | null;
}) {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () =>
              table === "board_members"
                ? {
                    data: opts.grant ? { access_level: opts.grant.role } : null,
                    error: null,
                  }
                : { data: null, error: null },
          }),
          maybeSingle: async () =>
            table === "boards"
              ? {
                  data:
                    opts.created_by !== null
                      ? { created_by: opts.created_by }
                      : null,
                  error: null,
                }
              : { data: null, error: null },
        }),
      }),
    }),
  } as never;
}

describe("getBoardAccessCore", () => {
  it("reports owner when the caller created the board", async () => {
    const client = fakeBoardAccessClient({ created_by: "u1", grant: null });
    await expect(getBoardAccessCore(client, "u1", "b1")).resolves.toBe("owner");
  });

  it("reports the board_members role for a non-creator", async () => {
    const client = fakeBoardAccessClient({
      created_by: "u2",
      grant: { role: "editor" },
    });
    await expect(getBoardAccessCore(client, "u1", "b1")).resolves.toBe(
      "editor",
    );
  });

  it("reports null for a board the caller cannot see", async () => {
    const client = fakeBoardAccessClient({ created_by: null, grant: null });
    await expect(getBoardAccessCore(client, "u1", "b1")).resolves.toBeNull();
  });
});
