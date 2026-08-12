import { describe, it, expect, vi } from "vitest";
import {
  PROPOSAL_TTL_DAYS,
  PENDING_PROPOSAL_SCAN_LIMIT,
  insertProposals,
  listPendingProposalsForRun,
  countPendingProposalsByAgent,
  getProposalForDecision,
} from "./proposals-db";

// ---------------------------------------------------------------------------
// Fakes, in the style of agents-db.test.ts: every `.eq()` / `.gt()` call is
// recorded as a [column, value] pair so a test can assert WHICH predicates a
// query carries, not merely that some query resolved. That matters more here
// than anywhere else in this module: the expiry predicate is invisible in the
// returned rows, so a regression that dropped `expires_at > now` would still
// return plausible-looking data — and would render an Approve button whose
// only possible outcome is failure.
// ---------------------------------------------------------------------------

type FilterCall = [string, unknown];

const NOW = new Date("2026-08-12T06:00:00.000Z");

function dbRow(over: Record<string, unknown> = {}) {
  return {
    id: "p-1",
    user_agent_id: "agent-1",
    run_id: "run-1",
    org_id: "org-1",
    owner_id: "owner-1",
    capability: "board.write",
    tool_name: "create_item",
    tool_call_id: "call-1",
    input: { boardId: "b-1", title: "Ship it" },
    summary: 'Create item "Ship it" on Roadmap',
    status: "pending",
    decided_at: null,
    decided_by: null,
    result: null,
    expires_at: "2026-08-19T06:00:00.000Z",
    created_at: "2026-08-12T06:00:00.000Z",
    ...over,
  };
}

/** insert() — the whole chain is the thenable, matching the real client. Typed
 *  with its `rows` parameter (as agents-db.test.ts types `select`'s `cols`) so
 *  tests can assert on WHAT was written; a bare `vi.fn(() => …)` records every
 *  call as an empty tuple. */
function clientForInsert(error: unknown = null) {
  const insert = vi.fn((_rows: Array<Record<string, unknown>>) =>
    Promise.resolve({ error }),
  );
  const from = vi.fn(() => ({ insert }));
  return { client: { from } as never, insert, from };
}

/** select().eq().eq().gt().order() — the list readers. `.order()` is the
 *  thenable for the run reader; the agent counter ends at `.limit()`. */
function clientForFilteredSelect(
  data: unknown,
  error: unknown = null,
  { withLimit = false }: { withLimit?: boolean } = {},
) {
  const calls: FilterCall[] = [];
  const order = vi.fn();
  const limit = vi.fn();
  const terminal = withLimit
    ? {
        order: order.mockImplementation(() => ({
          limit: limit.mockImplementation(() =>
            Promise.resolve({ data, error }),
          ),
        })),
      }
    : {
        order: order.mockImplementation(() => Promise.resolve({ data, error })),
      };

  const link = {
    eq: vi.fn((col: string, val: unknown) => {
      calls.push([col, val]);
      return link;
    }),
    gt: vi.fn((col: string, val: unknown) => {
      calls.push([col, val]);
      return terminal;
    }),
  };
  const select = vi.fn((_cols: string) => link);
  const from = vi.fn(() => ({ select }));
  return { client: { from } as never, calls, select, order, limit, from };
}

/** select().eq().maybeSingle() — getProposalForDecision. */
function clientForSingle(data: unknown, error: unknown = null) {
  const calls: FilterCall[] = [];
  const select = vi.fn((_cols: string) => ({
    eq: vi.fn((col: string, val: unknown) => {
      calls.push([col, val]);
      return { maybeSingle: vi.fn().mockResolvedValue({ data, error }) };
    }),
  }));
  const from = vi.fn(() => ({ select }));
  return { client: { from } as never, calls, select };
}

const NEW_PROPOSAL = {
  userAgentId: "agent-1",
  runId: "run-1",
  orgId: "org-1",
  ownerId: "owner-1",
  capability: "board.write",
  toolName: "create_item",
  toolCallId: "call-1",
  input: { boardId: "b-1" },
  summary: "Create an item",
};

describe("insertProposals", () => {
  it("stamps status and expiry itself rather than trusting the caller", async () => {
    const { client, insert } = clientForInsert();
    await insertProposals(client as never, [NEW_PROPOSAL], NOW);

    const rows = insert.mock.calls[0]?.[0];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("pending");
    // now + PROPOSAL_TTL_DAYS, to the millisecond.
    expect(rows[0]?.expires_at).toBe(
      new Date(
        NOW.getTime() + PROPOSAL_TTL_DAYS * 24 * 60 * 60 * 1000,
      ).toISOString(),
    );
    expect(rows[0]).toMatchObject({
      user_agent_id: "agent-1",
      run_id: "run-1",
      org_id: "org-1",
      owner_id: "owner-1",
      capability: "board.write",
      tool_name: "create_item",
      tool_call_id: "call-1",
      summary: "Create an item",
    });
  });

  it("does not touch the database for an empty batch", async () => {
    const { client, from } = clientForInsert();
    await insertProposals(client as never, [], NOW);
    expect(from).not.toHaveBeenCalled();
  });

  it("throws on a DB error — a swallowed insert is a refused tool call the owner never gets to approve", async () => {
    const { client } = clientForInsert({ message: "boom" });
    await expect(
      insertProposals(client as never, [NEW_PROPOSAL], NOW),
    ).rejects.toThrow("insertProposals: boom");
  });
});

describe("listPendingProposalsForRun", () => {
  it("filters on run, pending status AND unexpired — all three", async () => {
    const { client, calls } = clientForFilteredSelect([dbRow()]);
    await listPendingProposalsForRun(client as never, "run-1", NOW);
    expect(calls).toEqual([
      ["run_id", "run-1"],
      ["status", "pending"],
      ["expires_at", NOW.toISOString()],
    ]);
  });

  it("maps the row to camelCase at the boundary", async () => {
    const { client } = clientForFilteredSelect([dbRow()]);
    const rows = await listPendingProposalsForRun(
      client as never,
      "run-1",
      NOW,
    );
    expect(rows).toEqual([
      {
        id: "p-1",
        userAgentId: "agent-1",
        runId: "run-1",
        orgId: "org-1",
        ownerId: "owner-1",
        capability: "board.write",
        toolName: "create_item",
        toolCallId: "call-1",
        input: { boardId: "b-1", title: "Ship it" },
        summary: 'Create item "Ship it" on Roadmap',
        status: "pending",
        expiresAt: "2026-08-19T06:00:00.000Z",
        createdAt: "2026-08-12T06:00:00.000Z",
        result: null,
      },
    ]);
  });

  it("throws on a DB error", async () => {
    const { client } = clientForFilteredSelect(null, { message: "boom" });
    await expect(
      listPendingProposalsForRun(client as never, "run-1", NOW),
    ).rejects.toThrow("listPendingProposalsForRun: boom");
  });

  it("rejects a row whose status is outside the vocabulary instead of widening it", async () => {
    const { client } = clientForFilteredSelect([dbRow({ status: "queued" })]);
    await expect(
      listPendingProposalsForRun(client as never, "run-1", NOW),
    ).rejects.toThrow(/listPendingProposalsForRun/);
  });
});

describe("countPendingProposalsByAgent", () => {
  it("filters on owner, pending status AND unexpired, and stays bounded", async () => {
    const { client, calls, limit } = clientForFilteredSelect(
      [{ user_agent_id: "agent-1" }],
      null,
      { withLimit: true },
    );
    await countPendingProposalsByAgent(client as never, "owner-1", NOW);
    expect(calls).toEqual([
      ["owner_id", "owner-1"],
      ["status", "pending"],
      ["expires_at", NOW.toISOString()],
    ]);
    expect(limit).toHaveBeenCalledWith(PENDING_PROPOSAL_SCAN_LIMIT);
  });

  it("tallies per agent", async () => {
    const { client } = clientForFilteredSelect(
      [
        { user_agent_id: "agent-1" },
        { user_agent_id: "agent-2" },
        { user_agent_id: "agent-1" },
      ],
      null,
      { withLimit: true },
    );
    const counts = await countPendingProposalsByAgent(
      client as never,
      "owner-1",
      NOW,
    );
    expect(counts).toEqual({ "agent-1": 2, "agent-2": 1 });
  });

  it("returns an empty tally, not a throw, when nothing is pending", async () => {
    const { client } = clientForFilteredSelect([], null, { withLimit: true });
    expect(
      await countPendingProposalsByAgent(client as never, "owner-1", NOW),
    ).toEqual({});
  });

  it("throws on a DB error", async () => {
    const { client } = clientForFilteredSelect(
      null,
      { message: "boom" },
      {
        withLimit: true,
      },
    );
    await expect(
      countPendingProposalsByAgent(client as never, "owner-1", NOW),
    ).rejects.toThrow("countPendingProposalsByAgent: boom");
  });
});

describe("getProposalForDecision", () => {
  // Deliberately NOT expiry-filtered: the decision path must be able to LOAD a
  // stale row in order to refuse it with an honest "this expired" message. The
  // expiry rule belongs to the two readers that feed the UI's affordances.
  it("reads by id alone, with no status or expiry predicate", async () => {
    const { client, calls } = clientForSingle(dbRow());
    await getProposalForDecision(client as never, "p-1");
    expect(calls).toEqual([["id", "p-1"]]);
  });

  it("returns a mapped row on a hit", async () => {
    const { client } = clientForSingle(
      dbRow({ status: "rejected", result: { error: "no" } }),
    );
    const row = await getProposalForDecision(client as never, "p-1");
    expect(row?.status).toBe("rejected");
    expect(row?.toolCallId).toBe("call-1");
    expect(row?.result).toEqual({ error: "no" });
  });

  it("returns null on a miss", async () => {
    const { client } = clientForSingle(null);
    expect(await getProposalForDecision(client as never, "p-1")).toBeNull();
  });

  it("throws on a DB error", async () => {
    const { client } = clientForSingle(null, { message: "boom" });
    await expect(
      getProposalForDecision(client as never, "p-1"),
    ).rejects.toThrow("getProposalForDecision: boom");
  });
});
