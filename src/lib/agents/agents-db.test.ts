import { describe, it, expect, vi } from "vitest";
import {
  findUserAgentRun,
  getUserAgentById,
  setAgentBridgeSecret,
  countAgentsForOwner,
  countRunsToday,
  listAgentRuns,
  getMyAgentLastRuns,
} from "./agents-db";

// ---------------------------------------------------------------------------
// Fakes. Each mirrors one Supabase query-builder shape used by agents-db.ts.
// Every `.eq()` call is recorded as a [column, value] pair so tests can assert
// WHICH columns a query filters on (and in what order), not just that some
// query eventually resolved. See fix round 1, Finding 2: a regression that
// filtered the wrong columns (or the right columns in the wrong order) could
// previously still pass green.
// ---------------------------------------------------------------------------

type EqCall = [string, unknown];

/** Builds a `{ eq }` chain of exactly `n` `.eq()` calls. The final call invokes
 *  `terminal()` instead of returning another `{ eq }` link — `terminal` is
 *  either a `{ maybeSingle }` object or a resolved promise, matching whichever
 *  shape the real Supabase builder ends the chain with. */
function makeEqChain(
  n: number,
  calls: EqCall[],
  terminal: () => unknown,
): { eq: (col: string, val: unknown) => unknown } {
  return {
    eq: vi.fn((col: string, val: unknown) => {
      calls.push([col, val]);
      return n <= 1 ? terminal() : makeEqChain(n - 1, calls, terminal);
    }),
  };
}

/** select().eq().eq().eq().maybeSingle() — findUserAgentRun. */
function clientForRunLookup(data: unknown, error: unknown = null) {
  const calls: EqCall[] = [];
  const chain = makeEqChain(3, calls, () => ({
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  }));
  const select = vi.fn(() => chain);
  const from = vi.fn(() => ({ select }));
  return { client: { from } as never, calls };
}

/** select().eq().maybeSingle() — getUserAgentById. */
function clientForGetAgent(data: unknown, error: unknown = null) {
  const calls: EqCall[] = [];
  const chain = makeEqChain(1, calls, () => ({
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  }));
  // Typed with its `cols` parameter so tests can assert WHICH columns the read
  // selects — a bare `vi.fn(() => …)` records calls as an empty tuple.
  const select = vi.fn((_cols: string) => chain);
  const from = vi.fn(() => ({ select }));
  return { client: { from } as never, calls, select };
}

/** update().eq() — setAgentBridgeSecret. `.eq()` here is itself the thenable
 *  (no separate `.maybeSingle()`/`.single()` call), matching the real client. */
function clientForUpdate(error: unknown) {
  const calls: EqCall[] = [];
  const chain = makeEqChain(1, calls, () => Promise.resolve({ error }));
  const update = vi.fn(() => chain);
  const from = vi.fn(() => ({ update }));
  return { client: { from } as never, calls, update };
}

/** select(cols, {count,head}).eq() x n — countAgentsForOwner / countRunsToday.
 *  The last `.eq()` is itself the thenable, matching the real client. */
function clientForCount(
  n: number,
  count: number | null,
  error: unknown = null,
) {
  const calls: EqCall[] = [];
  const chain = makeEqChain(n, calls, () => Promise.resolve({ count, error }));
  const select = vi.fn(() => chain);
  const from = vi.fn(() => ({ select }));
  return { client: { from } as never, calls, select };
}

/** select().eq().order().limit() — listAgentRuns. `.limit()` is the thenable. */
function clientForRunHistory(data: unknown, error: unknown = null) {
  const calls: EqCall[] = [];
  const order = vi.fn();
  const limit = vi.fn();
  const chain = makeEqChain(1, calls, () => ({
    order: order.mockImplementation((col: string, opts: unknown) => {
      void col;
      void opts;
      return {
        limit: limit.mockImplementation((n: number) => {
          void n;
          return Promise.resolve({ data, error });
        }),
      };
    }),
  }));
  const select = vi.fn(() => chain);
  const from = vi.fn(() => ({ select }));
  return { client: { from } as never, calls, select, order, limit, from };
}

describe("findUserAgentRun", () => {
  it("returns the row when the fire slot already ran, filtering on the exact idempotency key", async () => {
    const { client, calls } = clientForRunLookup({ id: "run-1" });
    const r = await findUserAgentRun(
      client as never,
      "agent-1",
      "2026-08-01",
      7,
    );
    expect(r).toEqual({ id: "run-1" });
    // Guards the (user_agent_id, fire_date, fire_hour) unique index the whole
    // no-duplicate-email guarantee rests on: wrong columns, or the right
    // columns in the wrong order, would silently defeat idempotency while
    // still returning a plausible-looking row.
    expect(calls).toEqual([
      ["user_agent_id", "agent-1"],
      ["fire_date", "2026-08-01"],
      ["fire_hour", 7],
    ]);
  });

  it("returns null for an unseen fire slot", async () => {
    const { client } = clientForRunLookup(null);
    const r = await findUserAgentRun(
      client as never,
      "agent-1",
      "2026-08-01",
      7,
    );
    expect(r).toBeNull();
  });

  it("throws on a DB error — a swallow here would look like 'no previous run' and let a redelivered cron fire send a duplicate briefing email", async () => {
    const { client } = clientForRunLookup(null, { message: "boom" });
    await expect(
      findUserAgentRun(client as never, "agent-1", "2026-08-01", 7),
    ).rejects.toThrow("findUserAgentRun: boom");
  });
});

describe("getUserAgentById", () => {
  it("returns the row on a hit", async () => {
    const row = { id: "agent-1", name: "Morning Brief" };
    const { client } = clientForGetAgent(row);
    const r = await getUserAgentById(client as never, "agent-1");
    expect(r).toEqual(row);
  });

  it("returns null on a miss", async () => {
    const { client } = clientForGetAgent(null);
    const r = await getUserAgentById(client as never, "agent-1");
    expect(r).toBeNull();
  });

  it("throws on a DB error", async () => {
    const { client } = clientForGetAgent(null, { message: "boom" });
    await expect(getUserAgentById(client as never, "agent-1")).rejects.toThrow(
      "getUserAgentById: boom",
    );
  });

  // The run reads the agent through THIS select. A column missing from the list
  // arrives as `undefined` rather than as an error — for `capabilities` that
  // would be an agent whose grant set silently reads as "nothing", and for the
  // cadence day fields a run that cannot tell which day it was meant to fire.
  it("selects the grant set and the cadence day fields", () => {
    const { client, select } = clientForGetAgent(null);
    void getUserAgentById(client as never, "agent-1");
    const cols = String(select.mock.calls[0]?.[0]);
    for (const col of ["capabilities", "run_on_weekday", "run_on_day_of_month"])
      expect(cols, `${col} must be selected`).toContain(col);
  });
});

describe("setAgentBridgeSecret", () => {
  it("filters on id and resolves without throwing on success", async () => {
    const { client, calls } = clientForUpdate(null);
    await expect(
      setAgentBridgeSecret(client as never, "agent-1", "secret-1"),
    ).resolves.toBeUndefined();
    expect(calls).toEqual([["id", "agent-1"]]);
  });

  it("throws on a DB error", async () => {
    const { client } = clientForUpdate({ message: "boom" });
    await expect(
      setAgentBridgeSecret(client as never, "agent-1", "secret-1"),
    ).rejects.toThrow("setAgentBridgeSecret: boom");
  });
});

describe("countAgentsForOwner", () => {
  it("returns the count value (not a row-array length), filtering on org_id and owner_id — a person can belong to multiple orgs, and the cap is per-org", async () => {
    const { client, calls, select } = clientForCount(2, 5);
    const n = await countAgentsForOwner(client as never, "org-1", "user-1");
    expect(n).toBe(5);
    expect(select).toHaveBeenCalledWith("id", { count: "exact", head: true });
    expect(calls).toEqual([
      ["org_id", "org-1"],
      ["owner_id", "user-1"],
    ]);
  });

  it("falls back to 0 when count comes back null", async () => {
    const { client } = clientForCount(2, null);
    const n = await countAgentsForOwner(client as never, "org-1", "user-1");
    expect(n).toBe(0);
  });

  it("throws (never silently returns 0) on a DB error", async () => {
    const { client } = clientForCount(2, null, { message: "boom" });
    await expect(
      countAgentsForOwner(client as never, "org-1", "user-1"),
    ).rejects.toThrow("countAgentsForOwner: boom");
  });
});

describe("countRunsToday", () => {
  it("returns the count value, filtering on org_id, owner_id, date and status='ran'", async () => {
    const { client, calls, select } = clientForCount(4, 2);
    const n = await countRunsToday(
      client as never,
      "org-1",
      "user-1",
      "2026-08-01",
    );
    expect(n).toBe(2);
    expect(select).toHaveBeenCalledWith("id", { count: "exact", head: true });
    // org_id first (a person can belong to multiple orgs and the cap is
    // per-org), then owner_id, then 'ran' only — skipped/errored runs must
    // not consume the daily budget.
    expect(calls).toEqual([
      ["org_id", "org-1"],
      ["owner_id", "user-1"],
      ["fire_date", "2026-08-01"],
      ["status", "ran"],
    ]);
  });

  it("falls back to 0 when count comes back null", async () => {
    const { client } = clientForCount(4, null);
    const n = await countRunsToday(
      client as never,
      "org-1",
      "user-1",
      "2026-08-01",
    );
    expect(n).toBe(0);
  });

  it("throws on a DB error — a swallow here would silently disable the per-user daily cap", async () => {
    const { client } = clientForCount(4, null, { message: "boom" });
    await expect(
      countRunsToday(client as never, "org-1", "user-1", "2026-08-01"),
    ).rejects.toThrow("countRunsToday: boom");
  });
});

describe("listAgentRuns", () => {
  const dbRow = {
    id: "run-1",
    status: "ran",
    error: null,
    fire_date: "2026-08-01",
    fire_hour: 7,
    input_tokens: 1200,
    output_tokens: 300,
    model_substituted: false,
    documents_omitted: false,
    created_at: "2026-08-01T07:00:04.000Z",
  };

  it("maps snake_case rows to the camelCase display shape", async () => {
    const { client } = clientForRunHistory([dbRow]);
    await expect(
      listAgentRuns(client as never, "agent-1", 50),
    ).resolves.toEqual([
      {
        id: "run-1",
        status: "ran",
        error: null,
        createdAt: "2026-08-01T07:00:04.000Z",
        fireDate: "2026-08-01",
        fireHour: 7,
        inputTokens: 1200,
        outputTokens: 300,
        modelSubstituted: false,
        documentsOmitted: false,
      },
    ]);
  });

  // The column exists precisely so a substituted run is not reported as an
  // error. Dropping it from the select would silently make every run read as
  // un-substituted, which is the failure it was minted to prevent.
  it("carries model_substituted through to the display shape", async () => {
    const { client, select } = clientForRunHistory([
      { ...dbRow, model_substituted: true },
    ]);
    const [run] = await listAgentRuns(client as never, "agent-1", 50);
    expect(run.modelSubstituted).toBe(true);
    expect(select).toHaveBeenCalledWith(
      expect.stringContaining("model_substituted"),
    );
  });

  // Same rationale, same failure mode: dropping this column from the select
  // would silently make every run read as "kept all its documents", which is
  // exactly the run this column exists to flag.
  it("carries documents_omitted through to the display shape", async () => {
    const { client, select } = clientForRunHistory([
      { ...dbRow, documents_omitted: true },
    ]);
    const [run] = await listAgentRuns(client as never, "agent-1", 50);
    expect(run.documentsOmitted).toBe(true);
    expect(select).toHaveBeenCalledWith(
      expect.stringContaining("documents_omitted"),
    );
  });

  // The read has to stay on user_agent_runs_history_idx as the table grows:
  // filter the agent, order created_at DESC, cap the rows (working agreement
  // #5). A regression that dropped the ordering or the cap would still return
  // plausible-looking data.
  it("reads the bounded history over the index: agent filter, created_at desc, capped", async () => {
    const { client, calls, order, limit } = clientForRunHistory([]);
    await listAgentRuns(client as never, "agent-1", 50);
    expect(calls).toEqual([["user_agent_id", "agent-1"]]);
    expect(order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(limit).toHaveBeenCalledWith(50);
  });

  it("passes the caller's limit through rather than a hardcoded one", async () => {
    const { client, limit } = clientForRunHistory([]);
    await listAgentRuns(client as never, "agent-1", 7);
    expect(limit).toHaveBeenCalledWith(7);
  });

  it("returns an empty list when an agent has never run", async () => {
    const { client } = clientForRunHistory(null);
    await expect(
      listAgentRuns(client as never, "agent-1", 50),
    ).resolves.toEqual([]);
  });

  it("throws on a DB error so the caller can show a load failure, not an empty history", async () => {
    const { client } = clientForRunHistory(null, { message: "boom" });
    await expect(listAgentRuns(client as never, "agent-1", 50)).rejects.toThrow(
      "listAgentRuns: boom",
    );
  });
});

describe("getMyAgentLastRuns", () => {
  function clientForRpc(data: unknown, error: unknown = null) {
    const rpc = vi.fn().mockResolvedValue({ data, error });
    return { client: { rpc } as never, rpc };
  }

  it("keys the most recent run by agent id", async () => {
    const { client, rpc } = clientForRpc([
      {
        user_agent_id: "agent-1",
        status: "ran",
        error: null,
        created_at: "2026-08-01T07:00:04.000Z",
      },
      {
        user_agent_id: "agent-2",
        status: "skipped",
        error: "no key",
        created_at: "2026-08-01T08:00:01.000Z",
      },
    ]);
    await expect(getMyAgentLastRuns(client as never)).resolves.toEqual({
      "agent-1": {
        status: "ran",
        error: null,
        createdAt: "2026-08-01T07:00:04.000Z",
      },
      "agent-2": {
        status: "skipped",
        error: "no key",
        createdAt: "2026-08-01T08:00:01.000Z",
      },
    });
    expect(rpc).toHaveBeenCalledWith("get_my_agent_last_runs");
  });

  // Supabase codegen types every `returns table` column as non-null, but a
  // successful run stores error = NULL. The display layer branches on that
  // exact value, so it must arrive as null, not undefined.
  it("preserves a null error rather than dropping it", async () => {
    const { client } = clientForRpc([
      {
        user_agent_id: "agent-1",
        status: "ran",
        error: null,
        created_at: "2026-08-01T07:00:04.000Z",
      },
    ]);
    const byAgent = await getMyAgentLastRuns(client as never);
    expect(byAgent["agent-1"].error).toBeNull();
  });

  it("returns an empty lookup when nothing has run yet", async () => {
    const { client } = clientForRpc(null);
    await expect(getMyAgentLastRuns(client as never)).resolves.toEqual({});
  });

  it("throws on a DB error", async () => {
    const { client } = clientForRpc(null, { message: "boom" });
    await expect(getMyAgentLastRuns(client as never)).rejects.toThrow(
      "getMyAgentLastRuns: boom",
    );
  });
});
