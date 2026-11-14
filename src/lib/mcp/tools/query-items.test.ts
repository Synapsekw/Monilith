import { describe, expect, it, vi } from "vitest";
import {
  queryItemsDescriptor,
  queryItemsHandler,
  QUERY_LIMIT,
} from "./query-items";

type Row = Record<string, unknown>;

/** What the SQL holds: one entry per live item in org o1. */
type TestItem = {
  item_id: string;
  item_name: string;
  board_id: string;
  board_name: string;
  group_name: string | null;
  status_label: string | null;
  is_done: boolean;
  due_date: string | null;
  last_change: string;
  assignee_ids: string[];
};
const ITEMS: TestItem[] = [
  {
    item_id: "i1",
    item_name: "Ship the API",
    board_id: "b1",
    board_name: "Roadmap",
    group_name: "Sprint 4",
    status_label: "Working",
    is_done: false,
    due_date: "2026-11-10",
    last_change: "2026-11-12T09:00:00Z",
    assignee_ids: ["u2"],
  },
  {
    item_id: "i2",
    item_name: "Write the docs",
    board_id: "b1",
    board_name: "Roadmap",
    group_name: "Sprint 4",
    status_label: "Done",
    is_done: true,
    due_date: null,
    last_change: "2026-11-01T09:00:00Z",
    assignee_ids: ["u1", "u2"],
  },
  {
    item_id: "i3",
    item_name: "Find a venue",
    board_id: "b2",
    board_name: "Offsite",
    group_name: null,
    status_label: null,
    is_done: false,
    due_date: "2026-12-01",
    last_change: "2026-11-13T09:00:00Z",
    assignee_ids: [],
  },
];

/**
 * An rpc double that applies the filters the handler sends, the way the SQL
 * does for the cases below (state, assignee, unassigned, due window, paging).
 * A handler that sends the wrong filter therefore gets the wrong rows back.
 */
function fixture(
  opts: {
    queryError?: string;
    countError?: string;
    profileError?: string;
    membersError?: string;
    orgsError?: string;
    countRows?: unknown[];
    items?: TestItem[];
    tables?: Record<string, Row[]>;
  } = {},
) {
  const items = opts.items ?? ITEMS;
  const rpc = vi.fn(async (fn: string, a: Record<string, unknown>) => {
    if (fn === "count_items") {
      if (opts.countError)
        return { data: null, error: { message: opts.countError } };
      return { data: opts.countRows ?? [], error: null };
    }
    if (opts.queryError)
      return { data: null, error: { message: opts.queryError } };
    const matched = items
      .filter(
        (r) => a.p_state === "any" || r.is_done === (a.p_state === "done"),
      )
      .filter(
        (r) => !a.p_assignee || r.assignee_ids.includes(a.p_assignee as string),
      )
      .filter((r) => !a.p_unassigned || r.assignee_ids.length === 0)
      .filter(
        (r) =>
          !a.p_due_to ||
          (r.due_date !== null && r.due_date <= (a.p_due_to as string)),
      )
      .filter(
        (r) =>
          !a.p_due_from ||
          (r.due_date !== null && r.due_date >= (a.p_due_from as string)),
      );
    const page = matched.slice(
      a.p_offset as number,
      (a.p_offset as number) + (a.p_limit as number),
    );
    return {
      data: page.map((r) => ({ ...r, total: matched.length })),
      error: null,
    };
  });

  const tables: Record<string, Row[]> = {
    organizations: [{ id: "o1", name: "Acme", timezone: "UTC" }],
    org_members: [
      { org_id: "o1", user_id: "u1", deactivated_at: null, role: "member" },
      { org_id: "o1", user_id: "u2", deactivated_at: null, role: "member" },
    ],
    profiles: [
      // u2 first: an unfiltered profile read would pick the wrong zone.
      { id: "u2", timezone: null, full_name: "Ana Kovac", avatar_url: null },
      { id: "u1", timezone: "Asia/Tokyo", full_name: "Me", avatar_url: null },
    ],
    ...opts.tables,
  };
  const reads: string[] = [];
  const from = (table: string) => {
    reads.push(table);
    const eq: Record<string, unknown> = {};
    const neq: Record<string, unknown> = {};
    const isNull: string[] = [];
    let inF: { k: string; vs: unknown[] } | null = null;
    const rows = () =>
      (tables[table] ?? [])
        .filter((r) => Object.entries(eq).every(([k, v]) => r[k] === v))
        .filter((r) => Object.entries(neq).every(([k, v]) => r[k] !== v))
        .filter((r) => isNull.every((k) => r[k] == null))
        .filter((r) => !inF || inF.vs.includes(r[inF.k]));
    const failure = () =>
      table === "organizations"
        ? opts.orgsError
        : table === "org_members"
          ? opts.membersError
          : table === "profiles" && "id" in eq
            ? opts.profileError
            : undefined;
    const q: Record<string, unknown> = {
      select: () => q,
      eq: (k: string, v: unknown) => {
        eq[k] = v;
        return q;
      },
      neq: (k: string, v: unknown) => {
        neq[k] = v;
        return q;
      },
      is: (k: string) => {
        isNull.push(k);
        return q;
      },
      in: (k: string, vs: unknown[]) => {
        inF = { k, vs };
        return q;
      },
      order: () => q,
      limit: () => q,
      maybeSingle: async () =>
        failure()
          ? { data: null, error: { message: failure() } }
          : { data: rows()[0] ?? null, error: null },
      then: (r: (v: unknown) => unknown) =>
        r(
          failure()
            ? { data: null, error: { message: failure() } }
            : { data: rows(), error: null },
        ),
    };
    return q;
  };
  const getClient = vi.fn(async () => ({ rpc, from }) as never);
  return { rpc, getClient, reads };
}

const NOW = Date.UTC(2026, 10, 14, 22, 30); // the 15th in Tokyo

const text = (r: { content: { text: string }[] }) => r.content[0].text;

describe("queryItemsHandler", () => {
  it("turns `overdue` into a due window ending yesterday in the member's zone", async () => {
    const { rpc, getClient } = fixture();
    const result = await queryItemsHandler(
      getClient,
      "u1",
      { orgId: "o1", folderId: "f1", overdue: true },
      NOW,
    );
    expect(getClient).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      "query_items",
      expect.objectContaining({
        p_org_id: "o1",
        p_folder_id: "f1",
        p_state: "open",
        // Tokyo is already on the 15th, so yesterday there is the 14th.
        p_due_to: "2026-11-14",
        p_limit: QUERY_LIMIT,
        p_offset: 0,
      }),
    );
    // The double applied that window: only the 10 Nov item is due by the 14th.
    expect(
      JSON.parse(text(result)).items.map((i: { id: string }) => i.id),
    ).toEqual(["i1"]);
  });

  it("uses the UTC day when the member has no zone, and the zone is read for the actor", async () => {
    const { rpc, getClient } = fixture();
    await queryItemsHandler(
      getClient,
      "u2",
      { orgId: "o1", overdue: true },
      NOW,
    );
    expect(rpc).toHaveBeenCalledWith(
      "query_items",
      expect.objectContaining({ p_due_to: "2026-11-13" }),
    );
  });

  it("resolves `assignee: me` to the actor and returns names, not ids", async () => {
    const { rpc, getClient } = fixture();
    const result = await queryItemsHandler(
      getClient,
      "u1",
      { orgId: "o1", assignee: "me", state: "any" },
      NOW,
    );
    expect(rpc).toHaveBeenCalledWith(
      "query_items",
      expect.objectContaining({ p_assignee: "u1", p_unassigned: false }),
    );
    const parsed = JSON.parse(text(result));
    expect(parsed.total).toBe(1);
    expect(parsed.items).toEqual([
      {
        id: "i2",
        name: "Write the docs",
        boardId: "b1",
        board: "Roadmap",
        group: "Sprint 4",
        status: "Done",
        done: true,
        dueDate: null,
        lastChange: "2026-11-01T09:00:00Z",
        assignees: ["Me", "Ana Kovac"],
      },
    ]);
    expect(text(result)).not.toContain('"u2"');
  });

  it("maps `assignee: unassigned` to the flag, not to an id", async () => {
    const { rpc, getClient } = fixture();
    const result = await queryItemsHandler(
      getClient,
      "u1",
      { orgId: "o1", assignee: "unassigned" },
      NOW,
    );
    expect(rpc).toHaveBeenCalledWith(
      "query_items",
      expect.objectContaining({ p_assignee: null, p_unassigned: true }),
    );
    const parsed = JSON.parse(text(result));
    expect(parsed.items.map((i: { id: string }) => i.id)).toEqual(["i3"]);
    expect(parsed.items[0].assignees).toEqual([]);
  });

  it("names an assignee outside the org as an unknown member, never as an id", async () => {
    const { getClient } = fixture({
      items: [{ ...ITEMS[0], assignee_ids: ["ghost-id"] }],
    });
    const result = await queryItemsHandler(
      getClient,
      "u1",
      { orgId: "o1" },
      NOW,
    );
    expect(JSON.parse(text(result)).items[0].assignees).toEqual([
      "Unknown member",
    ]);
    expect(text(result)).not.toContain("ghost-id");
  });

  it("passes state, due window, scope and sort straight through", async () => {
    const { rpc, getClient } = fixture();
    await queryItemsHandler(
      getClient,
      "u1",
      {
        orgId: "o1",
        boardId: "b1",
        groupId: "g1",
        state: "done",
        dueFrom: "2026-11-01",
        dueTo: "2026-11-30",
        updatedSince: "2026-11-10T00:00:00Z",
        sort: "updated",
        limit: 5,
        offset: 10,
      },
      NOW,
    );
    expect(rpc).toHaveBeenCalledWith("query_items", {
      p_org_id: "o1",
      p_board_id: "b1",
      p_folder_id: null,
      p_group_id: "g1",
      p_assignee: null,
      p_unassigned: false,
      p_state: "done",
      p_due_from: "2026-11-01",
      p_due_to: "2026-11-30",
      p_updated_since: "2026-11-10T00:00:00Z",
      p_sort: "updated",
      p_limit: 5,
      p_offset: 10,
    });
  });

  it("calls count_items when countBy is set", async () => {
    const { rpc, getClient } = fixture({
      countRows: [
        { key: "u2", label: null, item_count: 7 },
        { key: "", label: null, item_count: 2 },
      ],
    });
    const result = await queryItemsHandler(
      getClient,
      "u1",
      { orgId: "o1", countBy: "assignee" },
      NOW,
    );
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      "count_items",
      expect.objectContaining({ p_org_id: "o1", p_count_by: "assignee" }),
    );
    expect(JSON.parse(text(result))).toEqual({
      countBy: "assignee",
      counts: [
        { label: "Ana Kovac", count: 7 },
        { label: "Unassigned", count: 2 },
      ],
    });
  });

  it("labels board and status counts from the rows", async () => {
    const { getClient } = fixture({
      countRows: [{ key: "b1", label: "Roadmap", item_count: 3 }],
    });
    const result = await queryItemsHandler(
      getClient,
      "u1",
      { orgId: "o1", countBy: "board" },
      NOW,
    );
    expect(JSON.parse(text(result)).counts).toEqual([
      { label: "Roadmap", count: 3 },
    ]);
  });

  it("offers nextOffset while more rows remain, and stops at the end", async () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      ...ITEMS[0],
      item_id: `x${i}`,
    }));
    const first = fixture({ items: many });
    const p1 = JSON.parse(
      text(
        await queryItemsHandler(first.getClient, "u1", { orgId: "o1" }, NOW),
      ),
    );
    expect(p1.total).toBe(60);
    expect(p1.items).toHaveLength(QUERY_LIMIT);
    expect(p1.nextOffset).toBe(QUERY_LIMIT);

    const second = fixture({ items: many });
    const p2 = JSON.parse(
      text(
        await queryItemsHandler(
          second.getClient,
          "u1",
          { orgId: "o1", offset: p1.nextOffset },
          NOW,
        ),
      ),
    );
    expect(p2.items).toHaveLength(10);
    expect(p2.nextOffset).toBeUndefined();
  });

  describe("paging past the offset cap", () => {
    const many = Array.from({ length: 1100 }, (_, i) => ({
      ...ITEMS[0],
      item_id: `x${i}`,
    }));

    it("lets nextOffset reach the cap exactly", async () => {
      const { getClient } = fixture({ items: many });
      const parsed = JSON.parse(
        text(
          await queryItemsHandler(
            getClient,
            "u1",
            { orgId: "o1", offset: 950 },
            NOW,
          ),
        ),
      );
      expect(parsed.items).toHaveLength(QUERY_LIMIT);
      expect(parsed.nextOffset).toBe(1000);
      expect(parsed.truncated).toBeUndefined();
    });

    it("says the list is truncated, instead of silently stopping, past the cap", async () => {
      const { getClient } = fixture({ items: many });
      const parsed = JSON.parse(
        text(
          await queryItemsHandler(
            getClient,
            "u1",
            { orgId: "o1", offset: 1000 },
            NOW,
          ),
        ),
      );
      expect(parsed.total).toBe(1100);
      expect(parsed.nextOffset).toBeUndefined();
      expect(parsed.truncated).toBe(true);
      expect(parsed.note).toMatch(/narrow|filter/i);
    });

    it("does not flag a complete list as truncated", async () => {
      const { getClient } = fixture();
      const parsed = JSON.parse(
        text(await queryItemsHandler(getClient, "u1", { orgId: "o1" }, NOW)),
      );
      expect(parsed.truncated).toBeUndefined();
      expect(parsed.nextOffset).toBeUndefined();
    });
  });

  describe("timezoneAssumed", () => {
    it("is reported when `overdue` falls back to the UTC day", async () => {
      const { getClient } = fixture();
      const parsed = JSON.parse(
        text(
          await queryItemsHandler(
            getClient,
            "u2",
            { orgId: "o1", overdue: true },
            NOW,
          ),
        ),
      );
      expect(parsed.timezoneAssumed).toBe(true);
    });

    it("is absent when the member has a zone, and when `overdue` is not used", async () => {
      const a = fixture();
      const withZone = JSON.parse(
        text(
          await queryItemsHandler(
            a.getClient,
            "u1",
            { orgId: "o1", overdue: true },
            NOW,
          ),
        ),
      );
      expect(withZone.timezoneAssumed).toBeUndefined();
      const b = fixture();
      const noOverdue = JSON.parse(
        text(await queryItemsHandler(b.getClient, "u2", { orgId: "o1" }, NOW)),
      );
      expect(noOverdue.timezoneAssumed).toBeUndefined();
    });

    it("is reported on counts too", async () => {
      const { getClient } = fixture({ countRows: [] });
      const parsed = JSON.parse(
        text(
          await queryItemsHandler(
            getClient,
            "u2",
            { orgId: "o1", overdue: true, countBy: "board" },
            NOW,
          ),
        ),
      );
      expect(parsed.timezoneAssumed).toBe(true);
    });
  });

  describe("member names are loaded only when they are needed", () => {
    it("not for board counts", async () => {
      const { getClient, reads } = fixture({ countRows: [] });
      await queryItemsHandler(
        getClient,
        "u1",
        { orgId: "o1", countBy: "board" },
        NOW,
      );
      expect(reads).not.toContain("org_members");
    });
    it("not for status counts", async () => {
      const { getClient, reads } = fixture({ countRows: [] });
      await queryItemsHandler(
        getClient,
        "u1",
        { orgId: "o1", countBy: "status" },
        NOW,
      );
      expect(reads).not.toContain("org_members");
    });
    it("for assignee counts", async () => {
      const { getClient, reads } = fixture({ countRows: [] });
      await queryItemsHandler(
        getClient,
        "u1",
        { orgId: "o1", countBy: "assignee" },
        NOW,
      );
      expect(reads).toContain("org_members");
    });
    it("for item listings", async () => {
      const { getClient, reads } = fixture();
      await queryItemsHandler(getClient, "u1", { orgId: "o1" }, NOW);
      expect(reads).toContain("org_members");
    });
  });

  it("reports total 0 and no items when nothing matches", async () => {
    const { getClient } = fixture({ items: [] });
    const parsed = JSON.parse(
      text(await queryItemsHandler(getClient, "u1", { orgId: "o1" }, NOW)),
    );
    expect(parsed).toEqual({ total: 0, items: [] });
  });

  describe("malformed calls are refused before the client is touched", () => {
    const cases: [string, Parameters<typeof queryItemsHandler>[2]][] = [
      ["two scopes", { orgId: "o1", boardId: "b1", folderId: "f1" }],
      [
        "overdue with a due window",
        { orgId: "o1", overdue: true, dueTo: "2026-12-01" },
      ],
      [
        "overdue with dueFrom",
        { orgId: "o1", overdue: true, dueFrom: "2026-12-01" },
      ],
      [
        "overdue with state done",
        { orgId: "o1", overdue: true, state: "done" },
      ],
      ["groupId without boardId", { orgId: "o1", groupId: "g1" }],
    ];
    for (const [label, args] of cases) {
      it(label, async () => {
        const { getClient } = fixture();
        const result = await queryItemsHandler(getClient, "u1", args, NOW);
        expect(result.isError).toBe(true);
        expect(getClient).not.toHaveBeenCalled();
      });
    }
  });

  describe("a failed read is an error, never an empty result", () => {
    it("query_items rpc", async () => {
      const { getClient } = fixture({ queryError: "rpc down" });
      const result = await queryItemsHandler(
        getClient,
        "u1",
        { orgId: "o1" },
        NOW,
      );
      expect(result.isError).toBe(true);
      expect(text(result)).toContain("rpc down");
    });
    it("count_items rpc", async () => {
      const { getClient } = fixture({ countError: "count down" });
      const result = await queryItemsHandler(
        getClient,
        "u1",
        { orgId: "o1", countBy: "board" },
        NOW,
      );
      expect(result.isError).toBe(true);
      expect(text(result)).toContain("count down");
    });
    it("the member's timezone read when `overdue` needs it", async () => {
      const { getClient, rpc } = fixture({ profileError: "profile down" });
      const result = await queryItemsHandler(
        getClient,
        "u1",
        { orgId: "o1", overdue: true },
        NOW,
      );
      expect(result.isError).toBe(true);
      expect(text(result)).toContain("profile down");
      expect(rpc).not.toHaveBeenCalled();
    });
    it("the org member names", async () => {
      const { getClient } = fixture({ membersError: "members down" });
      const result = await queryItemsHandler(
        getClient,
        "u1",
        { orgId: "o1" },
        NOW,
      );
      expect(result.isError).toBe(true);
      expect(text(result)).toContain("members down");
    });
    it("the organization lookup", async () => {
      const { getClient } = fixture({ orgsError: "orgs down" });
      const result = await queryItemsHandler(
        getClient,
        "u1",
        { orgId: "o1" },
        NOW,
      );
      expect(result.isError).toBe(true);
    });
  });

  it("tells the caller when they are not a member of the requested org", async () => {
    const { getClient, rpc } = fixture();
    const result = await queryItemsHandler(
      getClient,
      "u1",
      { orgId: "other" },
      NOW,
    );
    expect(result.isError).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("queryItemsHandler org from scope (review I2)", () => {
  // Alphabetical: Acme (o1) is the default org; the board lives in Globex (o2).
  const ORGS = [
    { id: "o1", name: "Acme", timezone: "UTC" },
    { id: "o2", name: "Globex", timezone: "UTC" },
  ];

  it("queries a board in a second org when only boardId is given", async () => {
    const { rpc, getClient } = fixture({
      tables: { organizations: ORGS, boards: [{ id: "b2", org_id: "o2" }] },
    });
    await queryItemsHandler(getClient, "u1", { boardId: "b2" }, NOW);
    expect(rpc).toHaveBeenCalledWith(
      "query_items",
      expect.objectContaining({ p_org_id: "o2", p_board_id: "b2" }),
    );
  });

  it("queries a folder in a second org when only folderId is given", async () => {
    const { rpc, getClient } = fixture({
      tables: { organizations: ORGS, folders: [{ id: "f2", org_id: "o2" }] },
    });
    await queryItemsHandler(
      getClient,
      "u1",
      { folderId: "f2", countBy: "board" },
      NOW,
    );
    expect(rpc).toHaveBeenCalledWith(
      "count_items",
      expect.objectContaining({ p_org_id: "o2", p_folder_id: "f2" }),
    );
  });

  it("says the board is not found when the caller cannot read it", async () => {
    const { rpc, getClient } = fixture({
      tables: { organizations: ORGS, boards: [] },
    });
    const result = await queryItemsHandler(
      getClient,
      "u1",
      { boardId: "b2" },
      NOW,
    );
    expect(result.isError).toBe(true);
    expect(text(result)).toBe("Board not found.");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("says the folder is not found when the caller cannot read it", async () => {
    const { rpc, getClient } = fixture({
      tables: { organizations: ORGS, folders: [] },
    });
    const result = await queryItemsHandler(
      getClient,
      "u1",
      { folderId: "f2" },
      NOW,
    );
    expect(result.isError).toBe(true);
    expect(text(result)).toBe("Folder not found.");
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("queryItemsDescriptor", () => {
  it("tells the agent how counts and paging behave", () => {
    const d = queryItemsDescriptor.description;
    expect(d).toMatch(/once per assignee/);
    expect(d).toMatch(/more than `total`/);
    expect(d).toMatch(/same name across boards/);
    expect(d).toMatch(/at most 100 groups/);
    expect(d).toMatch(/truncated/);
  });
});
