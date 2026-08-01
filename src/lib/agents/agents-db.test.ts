import { describe, it, expect, vi } from "vitest";
import {
  findUserAgentRun,
  getUserAgentById,
  setAgentBridgeSecret,
  countAgentsForOwner,
  countRunsToday,
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
  const select = vi.fn(() => chain);
  const from = vi.fn(() => ({ select }));
  return { client: { from } as never, calls };
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
