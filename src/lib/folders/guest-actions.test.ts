import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, string>;

const F1 = "11111111-1111-4111-8111-111111111111";
const F2 = "22222222-2222-4222-8222-222222222222";

/** What the caller's RLS lets them read. Every filter is applied, so a read
 *  that drops its folder, org or role filter returns other rows and fails. */
const tables: Record<string, Row[]> = {};
let failOrgMembers = false;

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from(table: string) {
      const eqs: [string, string][] = [];
      let within: [string, string[]] | null = null;
      let single = false;
      const q = {
        select: () => q,
        order: () => q,
        limit: () => q,
        eq(c: string, v: string) {
          eqs.push([c, v]);
          return q;
        },
        in(c: string, v: string[]) {
          within = [c, v];
          return q;
        },
        maybeSingle() {
          single = true;
          return q;
        },
        then(resolve: (v: { data: unknown; error: unknown }) => void) {
          if (table === "org_members" && failOrgMembers)
            return resolve({ data: null, error: new Error("down") });
          const rows = (tables[table] ?? []).filter(
            (r) =>
              eqs.every(([c, v]) => r[c] === v) &&
              (!within || within[1].includes(r[within[0]])),
          );
          resolve({ data: single ? (rows[0] ?? null) : rows, error: null });
        },
      };
      return q;
    },
  })),
}));

import { loadFolderGuestIds } from "./guest-actions";

beforeEach(() => {
  failOrgMembers = false;
  tables.folders = [
    { id: F1, org_id: "o1" },
    { id: F2, org_id: "o2" },
  ];
  tables.folder_members = [
    { folder_id: F1, user_id: "guest-a" },
    { folder_id: F1, user_id: "member-b" },
    { folder_id: F2, user_id: "guest-c" },
  ];
  tables.org_members = [
    { org_id: "o1", user_id: "guest-a", role: "guest" },
    { org_id: "o1", user_id: "member-b", role: "member" },
    // A guest of the same org who is not on this folder.
    { org_id: "o1", user_id: "guest-z", role: "guest" },
    // On the folder, but a guest only in another org.
    { org_id: "o2", user_id: "member-b", role: "guest" },
    { org_id: "o2", user_id: "guest-c", role: "guest" },
  ];
});

describe("loadFolderGuestIds", () => {
  it("returns the folder's members who are guests of the folder's org", async () => {
    expect(await loadFolderGuestIds({ folderId: F1 })).toEqual({
      ok: true,
      data: ["guest-a"],
    });
  });

  it("returns nobody for a folder with no members, without a role read", async () => {
    tables.folder_members = [];
    failOrgMembers = true;
    expect(await loadFolderGuestIds({ folderId: F1 })).toEqual({
      ok: true,
      data: [],
    });
  });

  it("says not found when the caller cannot read the folder", async () => {
    tables.folders = [];
    const r = await loadFolderGuestIds({ folderId: F1 });
    expect(r.ok).toBe(false);
  });

  it("rejects a malformed id", async () => {
    expect(await loadFolderGuestIds({ folderId: "nope" })).toEqual({
      ok: false,
      error: "Invalid input",
    });
  });

  it("fails rather than reporting no guests when the role read fails", async () => {
    failOrgMembers = true;
    const r = await loadFolderGuestIds({ folderId: F1 });
    expect(r.ok).toBe(false);
  });
});
