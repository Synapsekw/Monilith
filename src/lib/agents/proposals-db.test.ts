import { describe, it, expect, vi } from "vitest";
import { readMigrationSources } from "@/test/anon-conformance";
import {
  PROPOSAL_STATUSES,
  PROPOSAL_TTL_DAYS,
  PENDING_PROPOSAL_SCAN_LIMIT,
  insertProposals,
  listPendingProposalsForRun,
  listPendingProposalsForRuns,
  countPendingProposalsByAgent,
  getProposalForDecision,
  claimProposalDecision,
  settleProposalOutcome,
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
    in: vi.fn((col: string, val: unknown) => {
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

/** update().eq()…eq().select() — the two writers. `.select()` is the thenable:
 *  a writer needs the affected-row count to tell "decided" apart from "RLS hid
 *  the row and nothing happened", and — for the claim — from "someone else got
 *  there first". Every `.eq()` is recorded, because the claim's WHOLE guarantee
 *  is the `status = 'pending'` predicate travelling with the update. */
function clientForUpdate(
  data: unknown = [{ id: "p-1" }],
  error: unknown = null,
) {
  const calls: FilterCall[] = [];
  let patch: Record<string, unknown> | null = null;
  const update = vi.fn((p: Record<string, unknown>) => {
    patch = p;
    const link = {
      eq: vi.fn((col: string, val: unknown) => {
        calls.push([col, val]);
        return link;
      }),
      select: vi.fn().mockResolvedValue({ data, error }),
    };
    return link;
  });
  const from = vi.fn(() => ({ update }));
  return {
    client: { from } as never,
    calls,
    patchOf: () => patch,
    from,
  };
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
    const { client, calls } = clientForFilteredSelect([dbRow()], null, {
      withLimit: true,
    });
    await listPendingProposalsForRun(client as never, "run-1", NOW);
    expect(calls).toEqual([
      ["run_id", "run-1"],
      ["status", "pending"],
      ["expires_at", NOW.toISOString()],
    ]);
  });

  it("stays bounded — a runaway agent's run is not an unbounded read", async () => {
    const { client, limit } = clientForFilteredSelect([dbRow()], null, {
      withLimit: true,
    });
    await listPendingProposalsForRun(client as never, "run-1", NOW);
    expect(limit).toHaveBeenCalledWith(PENDING_PROPOSAL_SCAN_LIMIT);
  });

  it("maps the row to camelCase at the boundary", async () => {
    const { client } = clientForFilteredSelect([dbRow()], null, {
      withLimit: true,
    });
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
    const { client } = clientForFilteredSelect(
      null,
      { message: "boom" },
      {
        withLimit: true,
      },
    );
    await expect(
      listPendingProposalsForRun(client as never, "run-1", NOW),
    ).rejects.toThrow("listPendingProposalsForRun: boom");
  });

  it("rejects a row whose status is outside the vocabulary instead of widening it", async () => {
    const { client } = clientForFilteredSelect(
      [dbRow({ status: "queued" })],
      null,
      {
        withLimit: true,
      },
    );
    await expect(
      listPendingProposalsForRun(client as never, "run-1", NOW),
    ).rejects.toThrow(/listPendingProposalsForRun/);
  });
});

describe("listPendingProposalsForRuns", () => {
  // The many-runs sibling. It exists so the run-history surface costs ONE
  // indexed read for the whole expanded list rather than one per run — the
  // singular reader in a loop is exactly the N+1 working agreement #5 forbids.
  it("carries the same three predicates, over a set of runs", async () => {
    const { client, calls, limit } = clientForFilteredSelect([dbRow()], null, {
      withLimit: true,
    });
    await listPendingProposalsForRuns(client as never, ["run-1", "run-2"], NOW);
    expect(calls).toEqual([
      ["run_id", ["run-1", "run-2"]],
      ["status", "pending"],
      ["expires_at", NOW.toISOString()],
    ]);
    expect(limit).toHaveBeenCalledWith(PENDING_PROPOSAL_SCAN_LIMIT);
  });

  it("does not touch the database for an empty run list", async () => {
    const { client, from } = clientForFilteredSelect([], null, {
      withLimit: true,
    });
    expect(await listPendingProposalsForRuns(client as never, [], NOW)).toEqual(
      [],
    );
    expect(from).not.toHaveBeenCalled();
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
      listPendingProposalsForRuns(client as never, ["run-1"], NOW),
    ).rejects.toThrow("listPendingProposalsForRuns: boom");
  });
});

describe("claimProposalDecision", () => {
  // THE concurrency guarantee. Two tabs both read `status = 'pending'` — a
  // prior read cannot arbitrate between them, and if the update went by id
  // alone BOTH would execute the tool. The `status = 'pending'` predicate
  // travelling WITH the update is what makes the database the arbiter, and the
  // loser sees 0 affected rows.
  it("moves the row out of pending ONLY while it is still pending", async () => {
    const { client, calls, patchOf } = clientForUpdate();
    const claimed = await claimProposalDecision(
      client as never,
      { id: "p-1", status: "rejected", decidedBy: "owner-1" },
      NOW,
    );
    expect(claimed).toBe(true);
    expect(calls).toEqual([
      ["id", "p-1"],
      ["status", "pending"],
    ]);
    expect(patchOf()).toEqual({
      status: "rejected",
      decided_at: NOW.toISOString(),
      decided_by: "owner-1",
    });
  });

  it("carries a claim result when the caller has one", async () => {
    const { client, patchOf } = clientForUpdate();
    await claimProposalDecision(
      client as never,
      {
        id: "p-1",
        status: "failed",
        decidedBy: "owner-1",
        result: { error: "nope" },
      },
      NOW,
    );
    expect(patchOf()).toMatchObject({ result: { error: "nope" } });
  });

  it("omits `result` entirely when there is none, rather than nulling it", async () => {
    // A rejection produces nothing. Writing `result: null` would be the value
    // the column already holds, but stating it invites a later reader to think
    // a decision CLEARS a result.
    const { client, patchOf } = clientForUpdate();
    await claimProposalDecision(
      client as never,
      { id: "p-1", status: "rejected", decidedBy: "owner-1" },
      NOW,
    );
    expect(patchOf()).not.toHaveProperty("result");
  });

  it("reports false when nothing was claimed — RLS hid it, or someone won first", async () => {
    // 0 rows and NO error is how PostgREST reports both. Reading it as success
    // would tell a user their approval landed when nothing was written, and
    // would let the loser of a race go on to execute the tool.
    const { client } = clientForUpdate([]);
    expect(
      await claimProposalDecision(
        client as never,
        { id: "p-1", status: "approved", decidedBy: "owner-1" },
        NOW,
      ),
    ).toBe(false);
  });

  it("throws on a DB error", async () => {
    const { client } = clientForUpdate(null, { message: "boom" });
    await expect(
      claimProposalDecision(
        client as never,
        { id: "p-1", status: "failed", decidedBy: "owner-1" },
        NOW,
      ),
    ).rejects.toThrow("claimProposalDecision: boom");
  });
});

describe("settleProposalOutcome", () => {
  it("writes the outcome by id, with NO pending predicate", async () => {
    // Deliberately not `status = 'pending'`: the caller already claimed this
    // row, so it is no longer pending and re-asserting the predicate would
    // discard the result of a write that really happened.
    const { client, calls, patchOf } = clientForUpdate();
    const written = await settleProposalOutcome(client as never, {
      id: "p-1",
      status: "approved",
      result: { ok: true },
    });
    expect(written).toBe(true);
    expect(calls).toEqual([["id", "p-1"]]);
    expect(patchOf()).toEqual({ status: "approved", result: { ok: true } });
  });

  it("does not restamp the decision time or the decider", async () => {
    // The claim recorded WHEN the human decided. The outcome lands later.
    const { client, patchOf } = clientForUpdate();
    await settleProposalOutcome(client as never, {
      id: "p-1",
      status: "failed",
      result: { error: "x" },
    });
    expect(patchOf()).not.toHaveProperty("decided_at");
    expect(patchOf()).not.toHaveProperty("decided_by");
  });

  it("reports false when RLS matched no row", async () => {
    const { client } = clientForUpdate([]);
    expect(
      await settleProposalOutcome(client as never, {
        id: "p-1",
        status: "approved",
        result: null,
      }),
    ).toBe(false);
  });

  it("throws on a DB error", async () => {
    const { client } = clientForUpdate(null, { message: "boom" });
    await expect(
      settleProposalOutcome(client as never, {
        id: "p-1",
        status: "approved",
        result: null,
      }),
    ).rejects.toThrow("settleProposalOutcome: boom");
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

// ---------------------------------------------------------------------------
// PROPOSAL_STATUSES vs. the database's own vocabulary
// ---------------------------------------------------------------------------
//
// `PROPOSAL_STATUSES` mirrors `user_agent_proposals_status_check`, and until
// this block the only thing holding the two together was a comment. That is a
// silent-divergence trap with a user-facing failure: `pnpm db:types` cannot
// catch it (codegen renders `Row.status` as plain `string` because it does not
// read check constraints), so a later migration that adds a sixth status —
// say 'executing' — and forgets the TS array would make `getProposalForDecision`
// throw `unreadable proposal row` on that row, 500-ing the approve page instead
// of rendering a sensible state. `listPendingProposalsForRun` is only partly
// shielded: it filters `status='pending'`, but it throws on the first offending
// row rather than skipping it, killing the whole list.
//
// The direct assertion would be `pg_get_constraintdef` over `pg_constraint`.
// Nothing in this repo's test process can run that: there is no pg driver and
// no `DATABASE_URL` in the test path, supabase-js speaks only PostgREST, and
// PostgREST exposes `public` — never `pg_catalog`. There is no generic
// SQL-executing RPC either (checked the generated `Functions` list). So the
// pin is split in two, and BOTH halves are needed because each catches a
// direction the other cannot:
//
//   * THIS test — the corpus half — catches the reviewer's exact scenario
//     (DB grows a status the TS array lacks). `supabase/migrations/` is the
//     declared source of truth for the schema (AGENTS.md), a sixth status can
//     only arrive through a migration file, and `pnpm db:ledger-check` is what
//     keeps those files and the live ledger one-to-one. It scans the WHOLE
//     corpus in version order rather than this task's file, so a LATER
//     migration redefining the constraint is what the assertion reads.
//   * The live half — `user_agent_proposals.rls.integration.test.ts` — proves
//     every value in the TS array is actually accepted by the running
//     constraint, and that an unknown one is refused by the constraint OF THAT
//     NAME. That catches the opposite drift (TS lists a status the DB rejects)
//     against the real database.
//
// Deliberately NOT solved by making the row mapper tolerant of unknown
// statuses: swallowing one would hide exactly the drift this exists to surface.

/** Quoted literals of the LAST `status` vocabulary any migration declares for
 *  `user_agent_proposals`. Handles both spellings Postgres accepts — the
 *  `in (…)` form this migration writes and the `= any (array[…])` form
 *  `pg_get_constraintdef` echoes back, which a later hand-written migration
 *  might well copy. Returns null when no declaration exists at all, so the
 *  test fails loudly instead of passing vacuously. */
function latestDeclaredStatusVocabulary(): string[] | null {
  let found: string[] | null = null;
  for (const source of readMigrationSources()) {
    // Strip `--` comments first: these migrations discuss the vocabulary in
    // prose above the DDL, and a regex over raw text would read the commentary
    // instead of the statement (same precedent as board-threads.schema.test.ts).
    const sql = source.replace(/--[^\n]*/g, "");
    for (const statement of sql.split(";")) {
      if (!/user_agent_proposals/i.test(statement)) continue;
      const clause =
        statement.match(/status\s+in\s*\(([^)]*)\)/i) ??
        statement.match(/status\s*=\s*any\s*\(\s*array\s*\[([^\]]*)\]/i);
      if (!clause?.[1]) continue;
      const literals = [...clause[1].matchAll(/'([^']*)'/g)].map((m) => m[1]);
      if (literals.length > 0) found = literals;
    }
  }
  return found;
}

describe("PROPOSAL_STATUSES", () => {
  it("matches the status vocabulary the migrations declare, as a set", () => {
    const declared = latestDeclaredStatusVocabulary();
    expect(
      declared,
      "no migration declares a status vocabulary for user_agent_proposals — " +
        "this assertion would otherwise pass vacuously",
    ).not.toBeNull();
    expect([...declared!].sort()).toEqual([...PROPOSAL_STATUSES].sort());
  });

  it("declares each status exactly once", () => {
    expect(new Set(PROPOSAL_STATUSES).size).toBe(PROPOSAL_STATUSES.length);
  });
});
