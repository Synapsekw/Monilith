import { describe, expect, it, vi } from "vitest";
import * as z from "zod";

// Only the org resolution is stubbed. `listOrgMemberProfiles` is the REAL one,
// so these tests prove the tool reads people through the caller's own client
// (whose rows stand for what RLS lets that caller see) and nothing else.
vi.mock("@/lib/mcp/org-scope", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/mcp/org-scope")>()),
  resolveOrgForTool: vi.fn(async (_c: unknown, requested?: string) =>
    requested === "o-foreign"
      ? { error: "You are not a member of organization o-foreign." }
      : { org: { id: "o1", name: "Acme", timezone: "UTC" } },
  ),
}));

import {
  listPeopleDescriptor,
  listPeopleHandler,
  PEOPLE_LIMIT,
} from "./list-people";

type Row = Record<string, unknown>;

/** PostgREST double: `.eq`, `.neq`, `.is(col, null)`, `.in` and `.limit` all
 *  act on the rows. The rows are what the caller's RLS lets them read. */
function client(
  tables: Record<string, Row[]>,
  errors: Record<string, string> = {},
) {
  const read: string[] = [];
  const from = (table: string) => {
    read.push(table);
    const eq: [string, unknown][] = [];
    const neq: [string, unknown][] = [];
    const isNull: string[] = [];
    let inFilter: { k: string; vs: unknown[] } | null = null;
    let max = Infinity;
    const rows = () =>
      (tables[table] ?? [])
        .filter((r) => eq.every(([k, v]) => r[k] === v))
        .filter((r) => neq.every(([k, v]) => r[k] !== v))
        .filter((r) => isNull.every((k) => r[k] == null))
        .filter((r) => !inFilter || inFilter.vs.includes(r[inFilter.k]))
        .slice(0, max);
    const q: Record<string, unknown> = {
      select: () => q,
      eq: (k: string, v: unknown) => (eq.push([k, v]), q),
      neq: (k: string, v: unknown) => (neq.push([k, v]), q),
      is: (k: string) => (isNull.push(k), q),
      in: (k: string, vs: unknown[]) => ((inFilter = { k, vs }), q),
      limit: (n: number) => ((max = n), q),
      then: (resolve: (v: { data: Row[] | null; error: unknown }) => unknown) =>
        resolve(
          errors[table]
            ? { data: null, error: { message: errors[table] } }
            : { data: rows(), error: null },
        ),
    };
    return q;
  };
  return { supabase: { from } as never, read };
}

const member = (user_id: string, role = "member", extra: Row = {}) => ({
  org_id: "o1",
  user_id,
  role,
  deactivated_at: null,
  ...extra,
});
const profile = (id: string, full_name: string | null) => ({
  id,
  full_name,
  avatar_url: null,
  email: `${id}@example.com`,
});

const ORG = {
  org_members: [
    member("u-ana"),
    member("u-ben"),
    member("u-me", "admin"),
    member("u-mono", "agent"),
    member("u-gone", "member", { deactivated_at: "2026-01-01T00:00:00Z" }),
    { ...member("u-other-org"), org_id: "o2" },
  ],
  profiles: [
    profile("u-ana", "Ana Kovac"),
    profile("u-ben", "Ben Okafor"),
    profile("u-me", "Me Myself"),
    profile("u-mono", "Scout"),
    profile("u-gone", "Gone Person"),
    profile("u-other-org", "Other Org"),
  ],
};

const parse = (r: { content: { text: string }[] }) =>
  JSON.parse(r.content[0]!.text);

describe("listPeopleHandler", () => {
  it("returns active people of the org by name, with ids, marking the caller; no Monos, no deactivated, no other org", async () => {
    const { supabase } = client(ORG);
    const out = parse(
      await listPeopleHandler(async () => supabase, "u-me", {}),
    );
    expect(out).toEqual({
      orgId: "o1",
      people: [
        { userId: "u-ana", name: "Ana Kovac" },
        { userId: "u-ben", name: "Ben Okafor" },
        { userId: "u-me", name: "Me Myself", isYou: true },
      ],
      truncated: false,
    });
  });

  it("never returns an email address", async () => {
    const { supabase } = client(ORG);
    const result = await listPeopleHandler(async () => supabase, "u-me", {});
    expect(result.content[0]!.text).not.toContain("@");
  });

  it("returns only the rows the caller's own client can read: a guest sees the people shared with them, not the org", async () => {
    // What RLS hands a guest who shares one folder with Ana: themselves + Ana.
    const { supabase, read } = client({
      org_members: [member("u-guest", "guest"), member("u-ana")],
      profiles: [
        profile("u-guest", "Gus Guest"),
        profile("u-ana", "Ana Kovac"),
      ],
    });
    const out = parse(
      await listPeopleHandler(async () => supabase, "u-guest", {}),
    );
    expect(out.people).toEqual([
      { userId: "u-ana", name: "Ana Kovac" },
      { userId: "u-guest", name: "Gus Guest", isYou: true },
    ]);
    // Nothing but the caller's client was consulted.
    expect(read).toEqual(["org_members", "profiles"]);
  });

  it("narrows by part of a name, ignoring case and extra spaces", async () => {
    const { supabase } = client(ORG);
    const out = parse(
      await listPeopleHandler(async () => supabase, "u-me", {
        query: "  KOV ",
      }),
    );
    expect(out.people).toEqual([{ userId: "u-ana", name: "Ana Kovac" }]);
  });

  it("caps the list and says so", async () => {
    const many = Array.from(
      { length: PEOPLE_LIMIT + 3 },
      (_, i) => `u${String(i).padStart(3, "0")}`,
    );
    const { supabase } = client({
      org_members: many.map((id) => member(id)),
      profiles: many.map((id) => profile(id, `Person ${id}`)),
    });
    const out = parse(
      await listPeopleHandler(async () => supabase, "u-me", {}),
    );
    expect(out.people).toHaveLength(PEOPLE_LIMIT);
    expect(out.truncated).toBe(true);
    const two = parse(
      await listPeopleHandler(async () => supabase, "u-me", { limit: 2 }),
    );
    expect(two.people).toHaveLength(2);
    expect(two.truncated).toBe(true);
  });

  it("refuses an org the caller is not a member of", async () => {
    const { supabase } = client(ORG);
    const result = await listPeopleHandler(async () => supabase, "u-me", {
      orgId: "o-foreign",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("not a member");
  });

  it("reports a failed read as an error, never as an empty organization", async () => {
    const { supabase } = client(ORG, { org_members: "members down" });
    const result = await listPeopleHandler(async () => supabase, "u-me", {});
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("members down");
  });
});

describe("listPeopleDescriptor", () => {
  it("is an always-on read that accepts null for every optional field", async () => {
    expect(listPeopleDescriptor.capability).toBeNull();
    const schema = z.object(listPeopleDescriptor.inputSchema);
    expect(
      schema.safeParse({ orgId: null, query: null, limit: null }).success,
    ).toBe(true);
    expect(schema.safeParse({ limit: PEOPLE_LIMIT + 1 }).success).toBe(false);
    const { supabase } = client(ORG);
    const result = await listPeopleDescriptor.invoke(
      { getClient: async () => supabase, actorId: "u-me" },
      { orgId: null, query: null, limit: null },
    );
    expect(parse(result).people).toHaveLength(3);
  });
});
