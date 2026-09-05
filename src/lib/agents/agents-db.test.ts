import { describe, it, expect, vi } from "vitest";
import {
  findUserAgentRun,
  getUserAgentById,
  setAgentBridgeSecret,
  countAgentsForOwner,
  countRunsToday,
  listAgentRuns,
  listChildRuns,
  getMyAgentLastRuns,
} from "./agents-db";
import { DELEGATE_FANOUT_MAX } from "./run-claim";

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

/** One [operator, column, value] triple. The counts filter with more than
 *  `.eq()` — `.neq("kind", "builtin")` and `.is("parent_run_id", null)` are
 *  what keep the built-in orchestrator out of the agent cap and delegated
 *  children out of the daily cap — and an assertion that only saw columns
 *  could not tell `.eq("kind", "builtin")` from `.neq(...)`, i.e. could not
 *  tell "exclude the built-in" from "count ONLY the built-in". */
type FilterCall = [op: string, column: string, value: unknown];

/** Builds a filter chain of exactly `n` calls, each of which may be `.eq()`,
 *  `.neq()` or `.is()`. The final call resolves the thenable instead of
 *  returning another link, matching the real Supabase count builder. */
function makeFilterChain(
  n: number,
  calls: FilterCall[],
  terminal: () => unknown,
): Record<string, unknown> {
  const link = (op: string) =>
    vi.fn((col: string, val: unknown) => {
      calls.push([op, col, val]);
      return n <= 1 ? terminal() : makeFilterChain(n - 1, calls, terminal);
    });
  return { eq: link("eq"), neq: link("neq"), is: link("is") };
}

/** select(cols, {count,head}) then n filters — countAgentsForOwner /
 *  countRunsToday. The last filter is itself the thenable, matching the real
 *  client. */
function clientForCount(
  n: number,
  count: number | null,
  error: unknown = null,
) {
  const calls: FilterCall[] = [];
  const chain = makeFilterChain(n, calls, () =>
    Promise.resolve({ count, error }),
  );
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
  // `handle` is the only identifier a mention can carry, and `kind` is what
  // tells the built-in orchestrator apart from an agent its owner made. A
  // column missing from this list arrives as `undefined`, which would read as
  // "this agent has no address" and "every agent is user-made".
  it("selects handle and kind", () => {
    const { client, select } = clientForGetAgent(null);
    void getUserAgentById(client as never, "a1");
    const cols = String(select.mock.calls[0]?.[0]);
    for (const col of ["handle", "kind"])
      expect(cols, `${col} must be selected`).toContain(col);
  });

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
    const { client, calls, select } = clientForCount(3, 5);
    const n = await countAgentsForOwner(client as never, "org-1", "user-1");
    expect(n).toBe(5);
    expect(select).toHaveBeenCalledWith("id", { count: "exact", head: true });
    expect(calls.slice(0, 2)).toEqual([
      ["eq", "org_id", "org-1"],
      ["eq", "owner_id", "user-1"],
    ]);
  });

  // The built-in orchestrator is seeded, not chosen. Counting it would take
  // one of the owner's three slots away on the day it shipped — every user
  // would open Settings → Agents to find they had silently lost a slot.
  it("does not count the built-in agent against the per-user cap", async () => {
    const { client, calls } = clientForCount(3, 5);
    await countAgentsForOwner(client as never, "org-1", "user-1");
    expect(calls).toContainEqual(["neq", "kind", "builtin"]);
  });

  it("falls back to 0 when count comes back null", async () => {
    const { client } = clientForCount(3, null);
    const n = await countAgentsForOwner(client as never, "org-1", "user-1");
    expect(n).toBe(0);
  });

  it("throws (never silently returns 0) on a DB error", async () => {
    const { client } = clientForCount(3, null, { message: "boom" });
    await expect(
      countAgentsForOwner(client as never, "org-1", "user-1"),
    ).rejects.toThrow("countAgentsForOwner: boom");
  });
});

describe("countRunsToday", () => {
  it("returns the count value, filtering on org_id, owner_id, date and status='ran'", async () => {
    const { client, calls, select } = clientForCount(5, 2);
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
    expect(calls.slice(0, 4)).toEqual([
      ["eq", "org_id", "org-1"],
      ["eq", "owner_id", "user-1"],
      ["eq", "fire_date", "2026-08-01"],
      ["eq", "status", "ran"],
    ]);
  });

  // The daily cap counts TRIGGERS, not runs. A delegated child is already
  // bounded by the fan-out cap; counting it here as well would let a single
  // orchestration exhaust a whole day's budget.
  it("counts only root runs toward the daily cap", async () => {
    const { client, calls } = clientForCount(5, 2);
    await countRunsToday(client as never, "org-1", "user-1", "2026-08-01");
    expect(calls).toContainEqual(["is", "parent_run_id", null]);
  });

  it("falls back to 0 when count comes back null", async () => {
    const { client } = clientForCount(5, null);
    const n = await countRunsToday(
      client as never,
      "org-1",
      "user-1",
      "2026-08-01",
    );
    expect(n).toBe(0);
  });

  it("throws on a DB error — a swallow here would silently disable the per-user daily cap", async () => {
    const { client } = clientForCount(5, null, { message: "boom" });
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

// ---------------------------------------------------------------------------
// Spec 3: the nested-run read. ONE batched query for a whole page of runs —
// the N+1 that working agreement #5 exists to prevent is a per-row child read.
// ---------------------------------------------------------------------------

/** select().in().order().limit() — listChildRuns. `.limit()` is the thenable,
 *  and `from` is exposed so a test can count ROUND TRIPS, not just filters. */
function clientForChildRuns(data: unknown, error: unknown = null) {
  const filters: FilterCall[] = [];
  const order = vi.fn();
  const limit = vi.fn();
  const chain = {
    in: vi.fn((col: string, val: unknown) => {
      filters.push(["in", col, val]);
      return {
        order: order.mockImplementation((col2: string, opts: unknown) => {
          void col2;
          void opts;
          return {
            limit: limit.mockImplementation((n: number) => {
              void n;
              return Promise.resolve({ data, error });
            }),
          };
        }),
      };
    }),
  };
  const select = vi.fn((_cols: string) => chain);
  const from = vi.fn(() => ({ select }));
  return { client: { from } as never, filters, select, order, limit, from };
}

describe("listChildRuns", () => {
  const childRow = {
    id: "child-1",
    status: "ran",
    error: null,
    fire_date: "2026-09-04",
    fire_hour: null,
    input_tokens: 800,
    output_tokens: 120,
    model_substituted: false,
    documents_omitted: false,
    memory_notes_dropped: 0,
    created_at: "2026-09-04T07:00:11.000Z",
    parent_run_id: "r1",
    depth: 1,
    trigger: "delegation",
    user_agents: { name: "Risk Spotter" },
  };

  it("reads all children in ONE batched query over the parent index", async () => {
    const { client, filters, from } = clientForChildRuns([]);
    await listChildRuns(client as never, ["r1", "r2"]);
    expect(from).toHaveBeenCalledTimes(1);
    expect(filters).toContainEqual(["in", "parent_run_id", ["r1", "r2"]]);
  });

  // An `in ()` with no values is a full scan waiting to happen, and the
  // overwhelmingly common case — delegation is inert until an admin grants it —
  // is a page of runs with no children at all.
  it("returns [] without querying for an empty parent list", async () => {
    const { client, from } = clientForChildRuns([]);
    await expect(listChildRuns(client as never, [])).resolves.toEqual([]);
    expect(from).not.toHaveBeenCalled();
  });

  // Bounded by the SAME cap the database enforces: agent_run_claim refuses a
  // fourth sibling, so three per parent is the true ceiling, not a guess.
  it("bounds the read at the fan-out cap per parent, oldest first", async () => {
    const { client, order, limit } = clientForChildRuns([]);
    await listChildRuns(client as never, ["r1", "r2"]);
    expect(order).toHaveBeenCalledWith("created_at", { ascending: true });
    expect(limit).toHaveBeenCalledWith(2 * DELEGATE_FANOUT_MAX);
  });

  it("maps a child row to the display shape, including its agent's name", async () => {
    const { client } = clientForChildRuns([childRow]);
    await expect(listChildRuns(client as never, ["r1"])).resolves.toEqual([
      {
        id: "child-1",
        status: "ran",
        error: null,
        createdAt: "2026-09-04T07:00:11.000Z",
        fireDate: "2026-09-04",
        // A delegated run occupies no schedule slot; the column is genuinely
        // NULL and must not be fabricated into an hour.
        fireHour: null,
        inputTokens: 800,
        outputTokens: 120,
        modelSubstituted: false,
        documentsOmitted: false,
        memoryNotesDropped: 0,
        parentRunId: "r1",
        depth: 1,
        trigger: "delegation",
        agentName: "Risk Spotter",
      },
    ]);
  });

  // Without parent_run_id the rows cannot be grouped under anything, and
  // without the name a child reads as an anonymous second run.
  it("selects the tree columns and the child agent's name", async () => {
    const { client, select } = clientForChildRuns([]);
    await listChildRuns(client as never, ["r1"]);
    const cols = String(select.mock.calls[0]?.[0]);
    for (const col of ["parent_run_id", "depth", "trigger", "user_agents"])
      expect(cols, `${col} must be selected`).toContain(col);
  });

  it("throws on a DB error rather than reporting a childless run", async () => {
    const { client } = clientForChildRuns(null, { message: "boom" });
    await expect(listChildRuns(client as never, ["r1"])).rejects.toThrow(
      "listChildRuns: boom",
    );
  });

  it("returns an empty list when no run delegated", async () => {
    const { client } = clientForChildRuns(null);
    await expect(listChildRuns(client as never, ["r1"])).resolves.toEqual([]);
  });
});
