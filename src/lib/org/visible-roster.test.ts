import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const access = vi.fn(async (_userId: string, _orgId: string) => ({
  isGuest: false,
  folderIds: [] as string[],
}));
vi.mock("@/lib/folders/access-cached", () => ({
  getFolderAccessForUserCached: (u: string, o: string) => access(u, o),
}));

const PEOPLE = [
  { userId: "guest", fullName: "Gina Guest", email: "g@x.io", avatarUrl: null },
  { userId: "co", fullName: "Cora Co", email: "c@x.io", avatarUrl: "a.png" },
  {
    userId: "hidden",
    fullName: "Hank Hidden",
    email: "h@x.io",
    avatarUrl: "h",
  },
];
const MONOS = [
  { userId: "mono-co", ownerId: "co", name: "Nova", color: "#7395ff" },
  { userId: "mono-hidden", ownerId: "hidden", name: "Zed", color: "#ff0000" },
];
const WORKSPACES = [
  { id: "ws-shared", name: "Shared" },
  { id: "ws-secret", name: "Secret" },
];
const listOrgMembersCached = vi.fn(async (_orgId: string) => PEOPLE);
const listOrgMonosCached = vi.fn(async (_orgId: string) => MONOS);
const listWorkspacesCached = vi.fn(async (_orgId: string) => WORKSPACES);
vi.mock("@/lib/org/queries-cached", () => ({
  listOrgMembersCached: (id: string) => listOrgMembersCached(id),
}));
vi.mock("@/lib/monos/queries-cached", () => ({
  listOrgMonosCached: (id: string) => listOrgMonosCached(id),
}));
vi.mock("@/lib/workspaces/queries-cached", () => ({
  listWorkspacesCached: (id: string) => listWorkspacesCached(id),
}));
vi.mock("@/lib/auth/session", () => ({ getUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import {
  loadRosterVisibility,
  loadWorkspaceVisibility,
  narrowForViewer,
  visibleOrgMembersFor,
  visibleOrgMonosFor,
  visibleRosterFor,
  visibleWorkspacesFor,
} from "./visible-roster";

type Row = Record<string, string>;

/**
 * Stands in for the viewer's RLS-scoped client: `tables` holds the rows RLS
 * would let THIS viewer read, across every org they belong to. Every `.eq()`
 * is applied, so a read that forgets its org filter returns the other org's
 * rows too and the assertions below fail.
 */
function fakeClient(
  tables: Record<string, Row[]>,
  opts: { fail?: boolean } = {},
) {
  const calls: { table: string; filters: [string, string][] }[] = [];
  const client = {
    from(table: string) {
      const filters: [string, string][] = [];
      calls.push({ table, filters });
      const builder = {
        select: () => builder,
        eq(col: string, val: string) {
          filters.push([col, val]);
          return builder;
        },
        limit: () => builder,
        then(resolve: (v: { data: Row[] | null; error: unknown }) => void) {
          if (opts.fail) return resolve({ data: null, error: new Error("x") });
          const rows = (tables[table] ?? []).filter((r) =>
            filters.every(([c, v]) => r[c] === v),
          );
          resolve({ data: rows, error: null });
        },
      };
      return builder;
    },
  };
  return { client: client as never, calls };
}

/** What RLS lets the guest read: themselves and one co-member in org o1 (plus
 *  that co-member's Mono), and a full roster in another org o2. */
const GUEST_TABLES = {
  org_members: [
    { org_id: "o1", user_id: "guest" },
    { org_id: "o1", user_id: "co" },
    { org_id: "o1", user_id: "mono-co" },
    { org_id: "o2", user_id: "hidden" },
    { org_id: "o2", user_id: "mono-hidden" },
  ],
  workspaces: [
    { org_id: "o1", id: "ws-shared" },
    { org_id: "o2", id: "ws-secret" },
  ],
};

beforeEach(() => {
  access.mockReset();
  access.mockResolvedValue({ isGuest: false, folderIds: [] });
  listOrgMembersCached.mockClear();
});

describe("narrowForViewer", () => {
  it("returns the same array for a viewer who sees everyone", () => {
    expect(narrowForViewer(PEOPLE, { all: true }, (p) => p.userId)).toBe(
      PEOPLE,
    );
  });

  it("keeps only the ids in the visible set", () => {
    const out = narrowForViewer(
      PEOPLE,
      { all: false, ids: new Set(["co"]) },
      (p) => p.userId,
    );
    expect(out.map((p) => p.userId)).toEqual(["co"]);
  });
});

describe("a non-guest", () => {
  it("sees the whole roster and costs no extra read", async () => {
    const { client, calls } = fakeClient(GUEST_TABLES);
    const members = await visibleOrgMembersFor(client, "member", "o1");
    expect(members).toEqual(PEOPLE);
    const monos = await visibleOrgMonosFor(client, "member", "o1");
    expect(monos).toEqual(MONOS);
    const workspaces = await visibleWorkspacesFor(client, "member", "o1");
    expect(workspaces).toEqual(WORKSPACES);
    expect(calls).toEqual([]);
  });
});

describe("a guest", () => {
  beforeEach(() => {
    access.mockResolvedValue({ isGuest: true, folderIds: ["f1"] });
  });

  it("sees only themselves and the people they share access with", async () => {
    const { client, calls } = fakeClient(GUEST_TABLES);
    const members = await visibleOrgMembersFor(client, "guest", "o1");
    expect(members.map((m) => m.userId)).toEqual(["guest", "co"]);
    // Nothing of the hidden member reaches the result: no name, email, avatar.
    expect(JSON.stringify(members)).not.toMatch(/Hank|h@x\.io|hidden/);
    expect(calls).toEqual([
      { table: "org_members", filters: [["org_id", "o1"]] },
    ]);
  });

  it("sees a Mono only when the Mono itself is visible to them", async () => {
    const { client } = fakeClient(GUEST_TABLES);
    const monos = await visibleOrgMonosFor(client, "guest", "o1");
    expect(monos.map((m) => m.userId)).toEqual(["mono-co"]);
  });

  it("does not see a Mono through its owner alone", async () => {
    const { client } = fakeClient({
      org_members: GUEST_TABLES.org_members.filter(
        (r) => r.user_id !== "mono-co",
      ),
    });
    expect(await visibleOrgMonosFor(client, "guest", "o1")).toEqual([]);
  });

  it("sees only the workspaces RLS returns for that org", async () => {
    const { client, calls } = fakeClient(GUEST_TABLES);
    const workspaces = await visibleWorkspacesFor(client, "guest", "o1");
    expect(workspaces).toEqual([{ id: "ws-shared", name: "Shared" }]);
    expect(calls).toEqual([
      { table: "workspaces", filters: [["org_id", "o1"]] },
    ]);
  });

  it("always keeps themselves, even when RLS returns no row", async () => {
    const { client } = fakeClient({ org_members: [] });
    const members = await visibleOrgMembersFor(client, "guest", "o1");
    expect(members.map((m) => m.userId)).toEqual(["guest"]);
  });

  it("fails closed to themselves alone when the visibility read fails", async () => {
    const { client } = fakeClient(GUEST_TABLES, { fail: true });
    const v = await loadRosterVisibility(client, "guest", "o1");
    expect(v).toEqual({ all: false, ids: new Set(["guest"]) });
    const members = await visibleOrgMembersFor(client, "guest", "o1");
    expect(members.map((m) => m.userId)).toEqual(["guest"]);
    const w = await loadWorkspaceVisibility(client, "guest", "o1");
    expect(w).toEqual({ all: false, ids: new Set() });
  });

  it("asks for the viewer's role in the org it is narrowing", async () => {
    const { client } = fakeClient(GUEST_TABLES);
    await visibleOrgMembersFor(client, "guest", "o1");
    expect(access).toHaveBeenCalledWith("guest", "o1");
  });
});

describe("visibleRosterFor", () => {
  it("narrows people and Monos on one visibility read", async () => {
    access.mockResolvedValue({ isGuest: true, folderIds: ["f1"] });
    const { client, calls } = fakeClient(GUEST_TABLES);
    const roster = await visibleRosterFor(client, "guest", "o1");
    expect(roster.members.map((m) => m.userId)).toEqual(["guest", "co"]);
    expect(roster.monos.map((m) => m.userId)).toEqual(["mono-co"]);
    expect(calls).toHaveLength(1);
  });

  it("keeps the people when the Monos read fails", async () => {
    listOrgMonosCached.mockRejectedValueOnce(new Error("cache down"));
    const { client } = fakeClient(GUEST_TABLES);
    const roster = await visibleRosterFor(client, "member", "o1");
    expect(roster.members).toEqual(PEOPLE);
    expect(roster.monos).toEqual([]);
  });
});

describe("a viewer with no session", () => {
  it("sees nobody", async () => {
    const { client, calls } = fakeClient(GUEST_TABLES);
    expect(await visibleOrgMembersFor(client, "", "o1")).toEqual([]);
    expect(await visibleOrgMonosFor(client, "", "o1")).toEqual([]);
    expect(await visibleWorkspacesFor(client, "", "o1")).toEqual([]);
    expect(calls).toEqual([]);
    expect(access).not.toHaveBeenCalled();
  });
});
