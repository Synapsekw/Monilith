import { describe, expect, it, vi } from "vitest";
import { resolveOrgForScope, resolveToolOrg } from "./org-scope";
import type { UserOrg } from "@/lib/auth/session";

const ORGS: UserOrg[] = [
  { id: "o1", name: "Acme", timezone: "UTC" },
  { id: "o2", name: "Globex", timezone: "Europe/Berlin" },
];

describe("resolveToolOrg", () => {
  it("returns the first org when nothing is requested", () => {
    expect(resolveToolOrg(ORGS)?.id).toBe("o1");
  });

  it("honours a requested id the user is a member of", () => {
    expect(resolveToolOrg(ORGS, "o2")?.id).toBe("o2");
  });

  it("returns null for a foreign id rather than falling back", () => {
    expect(resolveToolOrg(ORGS, "o-foreign")).toBeNull();
  });

  it("returns null when the user has no orgs", () => {
    expect(resolveToolOrg([], undefined)).toBeNull();
  });
});

/** A tiny client double: `eq` filters, `order` keeps order, rows per table. */
function scopeClient(tables: Record<string, Record<string, unknown>[]>) {
  const reads: string[] = [];
  const from = (table: string) => {
    reads.push(table);
    let rows = [...(tables[table] ?? [])];
    const q: Record<string, unknown> = {
      select: () => q,
      order: () => q,
      eq: (k: string, v: unknown) => {
        rows = rows.filter((r) => r[k] === v);
        return q;
      },
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      then: (r: (v: unknown) => unknown) => r({ data: rows, error: null }),
    };
    return q;
  };
  return { client: { from } as never, reads };
}

describe("resolveOrgForScope", () => {
  const tables = {
    organizations: ORGS,
    boards: [{ id: "b2", org_id: "o2" }],
    folders: [{ id: "f2", org_id: "o2" }],
  };

  it("uses the board's org when only boardId is given", async () => {
    const { client } = scopeClient(tables);
    const r = await resolveOrgForScope(client, { boardId: "b2" });
    expect(r).toEqual({ org: ORGS[1] });
  });

  it("uses the folder's org when only folderId is given", async () => {
    const { client } = scopeClient(tables);
    const r = await resolveOrgForScope(client, { folderId: "f2" });
    expect(r).toEqual({ org: ORGS[1] });
  });

  // Live-run defect A: the in-app assistant always pins orgId, and a model
  // sent a made-up folderId. The row must be read even with an orgId given.
  describe("with a pinned orgId the board or folder is still read", () => {
    it("board in that org: the org", async () => {
      const { client, reads } = scopeClient(tables);
      const r = await resolveOrgForScope(client, {
        orgId: "o2",
        boardId: "b2",
      });
      expect(r).toEqual({ org: ORGS[1] });
      expect(reads).toContain("boards");
    });

    it("folder in that org: the org", async () => {
      const { client, reads } = scopeClient(tables);
      const r = await resolveOrgForScope(client, {
        orgId: "o2",
        folderId: "f2",
      });
      expect(r).toEqual({ org: ORGS[1] });
      expect(reads).toContain("folders");
    });

    it("an unreadable or made-up board is not found", async () => {
      const { client } = scopeClient(tables);
      expect(
        await resolveOrgForScope(client, { orgId: "o2", boardId: "b-fake" }),
      ).toEqual({ error: "Board not found." });
    });

    it("an unreadable or made-up folder is not found", async () => {
      const { client } = scopeClient(tables);
      expect(
        await resolveOrgForScope(client, { orgId: "o2", folderId: "f-fake" }),
      ).toEqual({ error: "Folder not found." });
    });

    it("a board in another org than the given one is refused", async () => {
      const { client } = scopeClient(tables);
      const r = await resolveOrgForScope(client, {
        orgId: "o1",
        boardId: "b2",
      });
      expect(r).toEqual({
        error: "That board is not in organization o1.",
      });
    });

    it("a folder in another org than the given one is refused", async () => {
      const { client } = scopeClient(tables);
      const r = await resolveOrgForScope(client, {
        orgId: "o1",
        folderId: "f2",
      });
      expect(r).toEqual({
        error: "That folder is not in organization o1.",
      });
    });

    it("a requested org the caller is not a member of is still refused", async () => {
      const { client } = scopeClient(tables);
      const r = await resolveOrgForScope(client, {
        orgId: "o9",
        boardId: "b2",
      });
      expect("error" in r && r.error).toMatch(/not a member/);
    });
  });

  it("falls back to the first org when nothing scopes it", async () => {
    const { client } = scopeClient(tables);
    expect(await resolveOrgForScope(client, {})).toEqual({ org: ORGS[0] });
  });

  it("an unreadable board or folder is not found, never another org", async () => {
    const { client } = scopeClient({ organizations: ORGS });
    expect(await resolveOrgForScope(client, { boardId: "b2" })).toEqual({
      error: "Board not found.",
    });
    expect(await resolveOrgForScope(client, { folderId: "f2" })).toEqual({
      error: "Folder not found.",
    });
  });

  it("a read failure throws rather than reading as not found", async () => {
    const from = vi.fn(() => {
      const q: Record<string, unknown> = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({ data: null, error: { message: "down" } }),
      };
      return q;
    });
    await expect(
      resolveOrgForScope({ from } as never, { boardId: "b2" }),
    ).rejects.toThrow(/down/);
  });
});
