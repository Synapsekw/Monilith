import { describe, expect, it, vi } from "vitest";
import { getMyWorkHandler, MY_WORK_TOOL_LIMIT } from "./get-my-work";

type Row = Record<string, unknown>;

const ROW = {
  item_id: "i1",
  item_name: "Ship the API",
  board_id: "b1",
  board_name: "Roadmap",
  group_name: "In progress",
  status_label: null,
  status_color: null,
  due_date: "2020-01-01",
};

const ROW_WITH_STATUS = {
  item_id: "i2",
  item_name: "Write the spec",
  board_id: "b1",
  board_name: "Roadmap",
  group_name: "In progress",
  status_label: "Blocked",
  status_color: "#ff0000",
  due_date: "2020-01-02",
};

/**
 * rpc spy plus the table reads resolveOrgForTool makes and the profile read the
 * handler makes. The rpc applies p_limit; profile reads honour `.eq("id", …)`
 * (u2 is listed first, so an unfiltered read would pick the wrong zone).
 */
function fixture(
  rpcRows: Row[],
  opts: {
    rpcError?: string;
    profileError?: string;
    timezone?: string;
    orgTimezone?: string;
  } = {},
) {
  const rpc = vi.fn(async (_fn: string, a: { p_limit: number }) =>
    opts.rpcError
      ? { data: null, error: { message: opts.rpcError } }
      : { data: rpcRows.slice(0, a.p_limit), error: null },
  );
  const tables: Record<string, Row[]> = {
    organizations: [
      { id: "o1", name: "Acme", timezone: opts.orgTimezone ?? "UTC" },
    ],
    profiles: [
      { id: "u2", timezone: null },
      { id: "u1", timezone: opts.timezone ?? null },
    ],
  };
  const from = (table: string) => {
    const eq: Record<string, unknown> = {};
    const rows = () =>
      (tables[table] ?? []).filter((r) =>
        Object.entries(eq).every(([k, v]) => r[k] === v),
      );
    const q: Record<string, unknown> = {
      select: () => q,
      order: () => q,
      eq: (k: string, v: unknown) => {
        eq[k] = v;
        return q;
      },
      maybeSingle: async () =>
        opts.profileError && table === "profiles"
          ? { data: null, error: { message: opts.profileError } }
          : { data: rows()[0] ?? null, error: null },
      then: (r: (v: unknown) => unknown) => r({ data: rows(), error: null }),
    };
    return q;
  };
  const getClient = vi.fn(async () => ({ rpc, from }) as never);
  return { rpc, getClient };
}

const NOW = Date.UTC(2026, 10, 14, 22, 30);
const text = (r: { content: { text: string }[] }) => r.content[0].text;

describe("getMyWorkHandler", () => {
  it("buckets items and projects them without UI fields", async () => {
    const { rpc, getClient } = fixture([ROW]);

    const result = await getMyWorkHandler(getClient, "u1", {}, NOW);

    expect(getClient).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("get_my_open_work", {
      p_org_id: "o1",
      p_limit: MY_WORK_TOOL_LIMIT,
    });

    const parsed = JSON.parse(text(result));
    expect(parsed.groups[0].bucket).toBe("overdue");
    expect(parsed.groups[0].items[0]).toEqual({
      id: "i1",
      name: "Ship the API",
      boardId: "b1",
      boardName: "Roadmap",
      groupName: "In progress",
      dueDate: "2020-01-01",
      status: null,
    });
  });

  it("projects a status as its label, with no color anywhere", async () => {
    const { getClient } = fixture([ROW_WITH_STATUS]);

    const result = await getMyWorkHandler(getClient, "u1", {}, NOW);
    const out = text(result);
    const parsed = JSON.parse(out);

    const item = parsed.groups
      .flatMap((g: { items: { id: string }[] }) => g.items)
      .find((i: { id: string }) => i.id === "i2");
    expect(item.status).toBe("Blocked");
    expect(out).not.toContain("#ff0000");
    expect(out).not.toContain("color");
  });

  it("returns an empty group list when nothing is assigned", async () => {
    const { getClient } = fixture([]);
    const result = await getMyWorkHandler(getClient, "u1", {}, NOW);
    expect(JSON.parse(text(result)).groups).toEqual([]);
  });

  it("surfaces an RPC failure as isError with the message", async () => {
    const { getClient } = fixture([], { rpcError: "connection reset" });

    const result = await getMyWorkHandler(getClient, "u1", {}, NOW);

    expect(getClient).toHaveBeenCalledTimes(1);
    expect(result.isError).toBe(true);
    expect(text(result)).toBe("connection reset");
  });

  it("buckets against the member's own 'today'", async () => {
    // 22:30 UTC on the 14th is already the 15th in Tokyo: an item due the 14th
    // is overdue there, and would be 'today' on the UTC clock.
    const tokyo = fixture([{ ...ROW, due_date: "2026-11-14" }], {
      timezone: "Asia/Tokyo",
    });
    const parsed = JSON.parse(
      text(await getMyWorkHandler(tokyo.getClient, "u1", {}, NOW)),
    );
    expect(parsed.today).toBe("2026-11-15");
    expect(parsed.groups.map((g: { bucket: string }) => g.bucket)).toEqual([
      "overdue",
    ]);
    expect(parsed.timezoneAssumed).toBeUndefined();

    // No zone anywhere (organizations.timezone is NOT NULL, so only a blank
    // value gets here): the UTC day, flagged as assumed.
    const noZone = fixture([{ ...ROW, due_date: "2026-11-14" }], {
      orgTimezone: "",
    });
    const assumed = JSON.parse(
      text(await getMyWorkHandler(noZone.getClient, "u1", {}, NOW)),
    );
    expect(assumed.today).toBe("2026-11-14");
    expect(assumed.timezoneAssumed).toBe(true);
    expect(assumed.groups.map((g: { bucket: string }) => g.bucket)).toEqual([
      "today",
    ]);
  });

  it("uses the org's zone when the member has none, and does not call it assumed (review I5)", async () => {
    const orgZone = fixture([{ ...ROW, due_date: "2026-11-14" }], {
      orgTimezone: "Asia/Tokyo",
    });
    const parsed = JSON.parse(
      text(await getMyWorkHandler(orgZone.getClient, "u1", {}, NOW)),
    );
    expect(parsed.today).toBe("2026-11-15");
    expect(parsed.timezoneAssumed).toBeUndefined();
  });

  it("surfaces a failed profile read instead of guessing the day", async () => {
    const { getClient } = fixture([ROW], { profileError: "profile down" });
    const result = await getMyWorkHandler(getClient, "u1", {}, NOW);
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("profile down");
  });

  it("refuses an org the caller is not a member of, without reading work", async () => {
    const { getClient, rpc } = fixture([ROW]);
    const result = await getMyWorkHandler(
      getClient,
      "u1",
      { orgId: "other" },
      NOW,
    );
    expect(result.isError).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("caps the rows at MY_WORK_TOOL_LIMIT", async () => {
    const many = Array.from({ length: MY_WORK_TOOL_LIMIT + 20 }, (_, i) => ({
      ...ROW,
      item_id: `x${i}`,
    }));
    const { getClient } = fixture(many);
    const parsed = JSON.parse(
      text(await getMyWorkHandler(getClient, "u1", {}, NOW)),
    );
    const n = parsed.groups.reduce(
      (s: number, g: { items: unknown[] }) => s + g.items.length,
      0,
    );
    expect(n).toBe(MY_WORK_TOOL_LIMIT);
  });
});
