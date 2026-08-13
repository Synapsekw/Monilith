import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";

/**
 * THE DECIDE PATH IS SECURITY CODE, not CRUD, and this file pins the order it
 * runs in. A proposal is a blob of MODEL-CHOSEN input that has sat in Postgres
 * for up to seven days; approving it executes that blob against real data with
 * the approver's own privileges. Every step below exists because skipping it
 * runs something the owner did not agree to:
 *
 *   load on the REQUEST-scoped client (RLS is the ownership check)
 *   → refuse anything not `pending`   (no double execution)
 *   → refuse anything expired         (the world has moved on)
 *   → look the descriptor up          (the tool may be gone)
 *   → re-validate against the CURRENT schema (the schema may have moved)
 *   → execute → record → revalidate.
 */

// ── Mocks ────────────────────────────────────────────────────────────────────

const requireUser = vi.fn();
const createClientCalls: number[] = [];
const revalidatePath = vi.fn();
const getProposalForDecision = vi.fn();
const claimProposalDecision = vi.fn();
const settleProposalOutcome = vi.fn();
const listPendingProposalsForRuns = vi.fn();
const invoke = vi.fn();
const descriptorsForArgs: unknown[] = [];

/** The client sentinel. Identity matters: the action must load, decide AND
 *  execute on the REQUEST-scoped client, never a service client. */
const CLIENT = { tag: "request-scoped" };

vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    createClientCalls.push(1);
    return CLIENT;
  },
}));
vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => revalidatePath(p),
}));
vi.mock("./proposals-db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./proposals-db")>()),
  getProposalForDecision: (...a: unknown[]) => getProposalForDecision(...a),
  claimProposalDecision: (...a: unknown[]) => claimProposalDecision(...a),
  settleProposalOutcome: (...a: unknown[]) => settleProposalOutcome(...a),
  listPendingProposalsForRuns: (...a: unknown[]) =>
    listPendingProposalsForRuns(...a),
}));

/** ONE fake tool stands in for the catalog, so the schema under test is a
 *  schema this file controls — "the stored blob no longer parses" is otherwise
 *  unreachable without waiting for a real tool to change shape. That the action
 *  derives its real lookup from `descriptorsFor({ extra })` is asserted
 *  separately, against the unmocked module, at the bottom of this file. */
vi.mock("./tool-descriptors", () => ({
  descriptorsFor: (args: unknown) => {
    descriptorsForArgs.push(args);
    return [
      {
        name: "create_item",
        title: "Create item",
        description: "",
        inputSchema: { name: z.string().min(1) },
        capability: "board.write",
        scope: "groupId",
        invoke: (...a: unknown[]) => invoke(...a),
      },
    ];
  },
}));

const { decideProposal } = await import("./proposal-actions");

// ── Fixtures ─────────────────────────────────────────────────────────────────

const USER_ID = "22222222-2222-4222-8222-222222222222";
const PROPOSAL_ID = "11111111-1111-4111-8111-111111111111";
const DAY_MS = 24 * 60 * 60 * 1000;

function proposal(over: Record<string, unknown> = {}) {
  return {
    id: PROPOSAL_ID,
    userAgentId: "agent-1",
    runId: "run-1",
    orgId: "org-1",
    ownerId: USER_ID,
    capability: "board.write",
    toolName: "create_item",
    toolCallId: "call-1",
    input: { name: "Draft proposal" },
    summary: 'Add "Draft proposal" to a board group.',
    status: "pending",
    expiresAt: new Date(Date.now() + 6 * DAY_MS).toISOString(),
    createdAt: new Date(Date.now() - DAY_MS).toISOString(),
    result: null,
    ...over,
  };
}

/** The status the row ENDED on — the last thing either writer wrote, which is
 *  the test's stand-in for re-reading the row. */
function writtenStatus(): string | undefined {
  const writes = [
    ...claimProposalDecision.mock.calls,
    ...settleProposalOutcome.mock.calls,
  ];
  const last = writes.at(-1);
  return (last?.[1] as { status?: string } | undefined)?.status;
}

/** Every status written, in order — so a test can see the claim AND the
 *  outcome, not just where the row came to rest. */
function writtenStatuses(): string[] {
  return [
    ...claimProposalDecision.mock.calls,
    ...settleProposalOutcome.mock.calls,
  ].map((c) => (c[1] as { status: string }).status);
}

beforeEach(() => {
  requireUser.mockReset().mockResolvedValue({ id: USER_ID });
  revalidatePath.mockReset();
  getProposalForDecision.mockReset().mockResolvedValue(proposal());
  claimProposalDecision.mockReset().mockResolvedValue(true);
  settleProposalOutcome.mockReset().mockResolvedValue(true);
  listPendingProposalsForRuns.mockReset().mockResolvedValue([]);
  invoke
    .mockReset()
    .mockResolvedValue({ content: [{ type: "text", text: "Item created." }] });
  createClientCalls.length = 0;
  // `descriptorsForArgs` is NOT cleared: the lookup map is built once, at
  // module load, which is the property the last test in this file asserts.
});

// ── The four cases the brief pins ────────────────────────────────────────────

describe("decideProposal", () => {
  it("re-validates the stored input against the CURRENT schema", async () => {
    // The blob sat in the DB for days; the tool's schema may have moved since.
    getProposalForDecision.mockResolvedValue(
      proposal({ input: { title: "Draft proposal" } }),
    );

    const r = await decideProposal({ id: PROPOSAL_ID, approve: true });

    expect(r.ok).toBe(false);
    expect(writtenStatus()).toBe("failed");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("refuses an expired proposal instead of executing it", async () => {
    getProposalForDecision.mockResolvedValue(
      proposal({ expiresAt: new Date(Date.now() - DAY_MS).toISOString() }),
    );

    const r = await decideProposal({ id: PROPOSAL_ID, approve: true });

    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/expired/i);
    expect(invoke).not.toHaveBeenCalled();
    // And it is not silently rewritten either: with no sweep, the row's own
    // status stays the historical truth of what the agent asked for.
    expect(claimProposalDecision).not.toHaveBeenCalled();
    expect(settleProposalOutcome).not.toHaveBeenCalled();
  });

  it("executes as the approver and records the result", async () => {
    const r = await decideProposal({ id: PROPOSAL_ID, approve: true });

    expect(r.ok).toBe(true);
    expect(r.ok && r.data.status).toBe("approved");
    expect(writtenStatus()).toBe("approved");
    // The APPROVER's id and the request-scoped client — an execution that ran
    // as the agent's service context would bypass the approver's RLS.
    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: USER_ID }),
      { name: "Draft proposal" },
    );
    const ctx = invoke.mock.calls[0]?.[0] as {
      getClient: () => Promise<unknown>;
    };
    expect(await ctx.getClient()).toBe(CLIENT);
  });

  it("rejecting never executes", async () => {
    const r = await decideProposal({ id: PROPOSAL_ID, approve: false });

    expect(r.ok).toBe(true);
    expect(invoke).not.toHaveBeenCalled();
    expect(writtenStatus()).toBe("rejected");
  });
});

// ── Everything else the ordering buys ────────────────────────────────────────

describe("decideProposal — refusals before execution", () => {
  it("refuses a proposal that was already decided", async () => {
    getProposalForDecision.mockResolvedValue(proposal({ status: "approved" }));

    const r = await decideProposal({ id: PROPOSAL_ID, approve: true });

    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/already/i);
    expect(invoke).not.toHaveBeenCalled();
    expect(claimProposalDecision).not.toHaveBeenCalled();
  });

  it("treats a row RLS will not show as simply not there", async () => {
    // `getProposalForDecision` runs on the request-scoped client, so another
    // person's proposal resolves to null. There is nothing to leak here and
    // nothing to write.
    getProposalForDecision.mockResolvedValue(null);

    const r = await decideProposal({ id: PROPOSAL_ID, approve: true });

    expect(r.ok).toBe(false);
    expect(claimProposalDecision).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("fails a proposal whose tool no longer exists", async () => {
    getProposalForDecision.mockResolvedValue(
      proposal({ toolName: "tool_that_was_removed" }),
    );

    const r = await decideProposal({ id: PROPOSAL_ID, approve: true });

    expect(r.ok).toBe(false);
    expect(writtenStatus()).toBe("failed");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("rejects a malformed id without touching the database", async () => {
    const r = await decideProposal({ id: "not-a-uuid", approve: true });

    expect(r.ok).toBe(false);
    expect(getProposalForDecision).not.toHaveBeenCalled();
    expect(createClientCalls).toHaveLength(0);
  });

  it("reads the row through the request-scoped client", async () => {
    await decideProposal({ id: PROPOSAL_ID, approve: true });
    expect(getProposalForDecision).toHaveBeenCalledWith(CLIENT, PROPOSAL_ID);
    expect(claimProposalDecision.mock.calls[0]?.[0]).toBe(CLIENT);
    expect(settleProposalOutcome.mock.calls[0]?.[0]).toBe(CLIENT);
  });
});

describe("decideProposal — execution outcomes", () => {
  it("records a tool that refused as failed, not approved", async () => {
    invoke.mockResolvedValue({
      content: [{ type: "text", text: "Board not found." }],
      isError: true,
    });

    const r = await decideProposal({ id: PROPOSAL_ID, approve: true });

    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/board not found/i);
    expect(writtenStatus()).toBe("failed");
  });

  it("records a handler that threw as failed", async () => {
    invoke.mockRejectedValue(new Error("connection reset"));

    const r = await decideProposal({ id: PROPOSAL_ID, approve: true });

    expect(r.ok).toBe(false);
    expect(writtenStatus()).toBe("failed");
  });

  it("reports a decision RLS refused as a failure, not a success", async () => {
    // 0 rows affected and no error: the row was hidden or already gone.
    claimProposalDecision.mockResolvedValue(false);

    const r = await decideProposal({ id: PROPOSAL_ID, approve: false });

    expect(r.ok).toBe(false);
  });

  it("revalidates the settings page so the roster badge stops counting it", async () => {
    await decideProposal({ id: PROPOSAL_ID, approve: true });
    expect(revalidatePath).toHaveBeenCalledWith("/settings/agents");
  });
});

// ── Concurrency: the DATABASE picks the winner, not a prior read ─────────────

describe("decideProposal — two deciders racing on one row", () => {
  /**
   * Both requests read the row while it is still `pending` — that is the whole
   * point, and it is what the two-tab case really looks like. The claim is
   * modelled exactly as the `status = 'pending'` predicate behaves: the FIRST
   * update to reach the row matches, every later one affects 0 rows.
   */
  function oneShotClaim() {
    let taken = false;
    claimProposalDecision.mockImplementation(async () => {
      if (taken) return false;
      taken = true;
      return true;
    });
  }

  /** A slow tool, so the second request is genuinely inside the first one's
   *  execution window rather than politely after it. */
  function slowInvoke() {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    invoke.mockImplementation(async () => {
      await gate;
      return { content: [{ type: "text", text: "Item created." }] };
    });
    return release;
  }

  it("executes the tool EXACTLY ONCE when two approvals race", async () => {
    oneShotClaim();
    const release = slowInvoke();

    const first = decideProposal({ id: PROPOSAL_ID, approve: true });
    // Second request lands while the first is still inside `invoke`.
    const second = decideProposal({ id: PROPOSAL_ID, approve: true });
    release();
    const [a, b] = await Promise.all([first, second]);

    // The assertion that matters: one execution, not two. Without the claim
    // both requests reach `invoke` and the item is created twice.
    expect(invoke).toHaveBeenCalledTimes(1);
    const outcomes = [a.ok, b.ok].sort();
    expect(outcomes).toEqual([false, true]);
    const loser = a.ok ? b : a;
    expect(!loser.ok && loser.error).toMatch(/just decided|already/i);
    // And the loser wrote nothing at all — no result overwriting the winner's.
    expect(settleProposalOutcome).toHaveBeenCalledTimes(1);
  });

  it("declines exactly once when a decline races an approval", async () => {
    oneShotClaim();
    const release = slowInvoke();

    const approve = decideProposal({ id: PROPOSAL_ID, approve: true });
    const decline = decideProposal({ id: PROPOSAL_ID, approve: false });
    release();
    const [a, d] = await Promise.all([approve, decline]);

    expect(claimProposalDecision).toHaveBeenCalledTimes(2); // both tried
    expect([a.ok, d.ok].filter(Boolean)).toHaveLength(1); // one won
    expect(invoke.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it("claims BEFORE executing, never after", async () => {
    // Ordering is the property; a claim taken after the call has already run
    // arbitrates nothing.
    const order: string[] = [];
    claimProposalDecision.mockImplementation(async () => {
      order.push("claim");
      return true;
    });
    invoke.mockImplementation(async () => {
      order.push("invoke");
      return { content: [{ type: "text", text: "ok" }] };
    });
    settleProposalOutcome.mockImplementation(async () => {
      order.push("settle");
      return true;
    });

    await decideProposal({ id: PROPOSAL_ID, approve: true });
    expect(order).toEqual(["claim", "invoke", "settle"]);
  });

  it("claims conservatively, then upgrades — a run that dies mid-execution reads as unfinished", async () => {
    // Same posture as `claimRun`'s placeholder in the run route: the row must
    // never read `approved` while the tool call is still in flight.
    await decideProposal({ id: PROPOSAL_ID, approve: true });
    expect(writtenStatuses()).toEqual(["failed", "approved"]);
    expect(claimProposalDecision.mock.calls[0]?.[1]).toMatchObject({
      status: "failed",
      decidedBy: USER_ID,
    });
  });

  it("does not execute when the claim itself fails", async () => {
    claimProposalDecision.mockRejectedValue(new Error("db down"));

    const r = await decideProposal({ id: PROPOSAL_ID, approve: true });

    expect(r.ok).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });
});

// ── The descriptor lookup must span BOTH descriptor sets ─────────────────────

describe("the tool lookup", () => {
  it("is derived from descriptorsFor with the agent-only descriptors", async () => {
    const { AGENT_ONLY_DESCRIPTORS } = await import("./agent-only-tools");
    expect(descriptorsForArgs[0]).toEqual({ extra: AGENT_ONLY_DESCRIPTORS });
  });

  it("covers create_file and create_automation, which the catalog does NOT hold", async () => {
    // The real composition, unmocked. A lookup built from `ALL_TOOL_DESCRIPTORS`
    // alone would make every create_file proposal permanently un-approvable —
    // and `create_attachment_upload` must stay absent, since an agent is never
    // offered it and so can never legitimately propose it.
    const { descriptorsFor } =
      await vi.importActual<typeof import("./tool-descriptors")>(
        "./tool-descriptors",
      );
    const { AGENT_ONLY_DESCRIPTORS } = await import("./agent-only-tools");
    const names = descriptorsFor({ extra: AGENT_ONLY_DESCRIPTORS }).map(
      (d) => d.name,
    );
    expect(names).toContain("create_file");
    expect(names).toContain("create_automation");
    expect(names).not.toContain("create_attachment_upload");
  });
});
