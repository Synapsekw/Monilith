import { describe, it, expect, vi, beforeEach } from "vitest";

// The roster always comes through the visible-roster module (never the raw
// per-org cache). Each entry point is stubbed with a distinct roster so the
// tests can tell which one a viewer kind reached.
const ROSTER = [
  {
    userId: "u1",
    fullName: "Ada Lovelace",
    email: "ada@x.com",
    avatarUrl: null,
  },
  { userId: "u2", fullName: null, email: "grace@x.com", avatarUrl: null },
];
const listVisibleOrgMembers = vi.fn(async (_orgId: string) => ROSTER);
const orgMembersForAbsentViewer = vi.fn(
  async (_userId: string | null, _orgId: string) => [ROSTER[0]!],
);
vi.mock("@/lib/org/visible-roster", () => ({
  listVisibleOrgMembers: (o: string) => listVisibleOrgMembers(o),
  orgMembersForAbsentViewer: (u: string | null, o: string) =>
    orgMembersForAbsentViewer(u, o),
}));
// The raw cache must never be read from here.
vi.mock("@/lib/org/queries-cached", () => ({
  listOrgMembersCached: vi.fn(async () => {
    throw new Error("buildJobContext must not read the raw org roster");
  }),
}));

import { buildJobContext } from "./context";

type TableData = Record<string, unknown[]>;

/** Minimal chainable fake of the subset of the supabase client buildJobContext
 *  uses: `.from(t).select().eq().order()` (thenable) and `.maybeSingle()`. */
function fakeClient(data: TableData) {
  return {
    from(table: string) {
      const rows = data[table] ?? [];
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        order: () => Promise.resolve({ data: rows, error: null }),
        maybeSingle: () =>
          Promise.resolve({ data: rows[0] ?? null, error: null }),
      };
      return builder;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

beforeEach(() => vi.clearAllMocks());

describe("buildJobContext", () => {
  it("projects columns (with options), groups, members, and the item to labels+ids", async () => {
    const svc = fakeClient({
      columns: [
        {
          id: "c1",
          name: "Status",
          kind: "status",
          settings: {
            options: [
              { id: "o1", label: "To do", color: "#fff" },
              { id: "o2", label: "Done", color: "#0f0" },
            ],
          },
        },
      ],
      groups: [{ id: "g1", name: "Backlog" }],
      items: [{ id: "i1", name: "Ship the thing" }],
    });

    const ctx = await buildJobContext(svc, {
      orgId: "org1",
      boardId: "b1",
      itemId: "i1",
      viewer: { kind: "session" },
    });

    expect(ctx.columns).toEqual([
      {
        id: "c1",
        name: "Status",
        kind: "status",
        options: [
          { id: "o1", label: "To do" },
          { id: "o2", label: "Done" },
        ],
      },
    ]);
    // Colors dropped — projection is labels + ids only (no styling egress).
    expect(JSON.stringify(ctx)).not.toContain("#fff");
    expect(ctx.groups).toEqual([{ id: "g1", name: "Backlog" }]);
    expect(ctx.members).toEqual([
      { id: "u1", name: "Ada Lovelace" },
      { id: "u2", name: "grace@x.com" },
    ]);
    expect(ctx.item).toEqual({ id: "i1", name: "Ship the thing" });
  });

  it("returns item=null when no itemId is given", async () => {
    const svc = fakeClient({ columns: [], groups: [], items: [] });
    const ctx = await buildJobContext(svc, {
      orgId: "org1",
      boardId: "b1",
      itemId: null,
      viewer: { kind: "session" },
    });
    expect(ctx.item).toBeNull();
  });

  it("a previewing user gets the people THEY may see (session roster)", async () => {
    const svc = fakeClient({ columns: [], groups: [], items: [] });
    const ctx = await buildJobContext(svc, {
      orgId: "org1",
      boardId: "b1",
      itemId: null,
      viewer: { kind: "session" },
    });
    expect(listVisibleOrgMembers).toHaveBeenCalledWith("org1");
    expect(orgMembersForAbsentViewer).not.toHaveBeenCalled();
    expect(ctx.members.map((m) => m.id)).toEqual(["u1", "u2"]);
  });

  it("a fired rule gets the people its AUTHOR may see, not the org roster", async () => {
    const svc = fakeClient({ columns: [], groups: [], items: [] });
    const ctx = await buildJobContext(svc, {
      orgId: "org1",
      boardId: "b1",
      itemId: null,
      viewer: { kind: "author", userId: "u1" },
    });
    expect(orgMembersForAbsentViewer).toHaveBeenCalledWith("u1", "org1");
    expect(listVisibleOrgMembers).not.toHaveBeenCalled();
    expect(ctx.members).toEqual([{ id: "u1", name: "Ada Lovelace" }]);
  });

  it("a fired rule with no author passes null through (nobody is shown)", async () => {
    const svc = fakeClient({ columns: [], groups: [], items: [] });
    await buildJobContext(svc, {
      orgId: "org1",
      boardId: "b1",
      itemId: null,
      viewer: { kind: "author", userId: null },
    });
    expect(orgMembersForAbsentViewer).toHaveBeenCalledWith(null, "org1");
  });
});
