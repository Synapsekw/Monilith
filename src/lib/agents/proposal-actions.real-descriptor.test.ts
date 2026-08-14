import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  FAKE_ACTOR,
  FAKE_BOARD,
  makeAutomationClient,
  notifyAction,
  someTrigger,
  webhookAction,
  type AutomationClientSpec,
} from "@/test/automation-fake-client";

/**
 * The approve path, END TO END, through a REAL descriptor.
 *
 * `proposal-actions.test.ts` mocks `./tool-descriptors` wholesale — deliberately,
 * so it can control the schema and reach branches like "the stored blob no
 * longer parses". The cost is that nothing there ever drives a real tool: the
 * seam between the decide path and the descriptors it executes is tested from
 * both sides and joined by nobody.
 *
 * This file joins it, on the highest-risk path in the branch: `create_automation`
 * files a rule that then fires for everyone on the board, forever, and its
 * stored input is a blob a LANGUAGE MODEL chose up to seven days earlier.
 * Nothing is mocked but the row store, the session and `next/cache`.
 */

const requireUser = vi.fn();
const getProposalForDecision = vi.fn();
const claimProposalDecision = vi.fn();
const settleProposalOutcome = vi.fn();

let fake = makeAutomationClient();

vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => fake.client,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("./proposals-db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./proposals-db")>()),
  getProposalForDecision: (...a: unknown[]) => getProposalForDecision(...a),
  claimProposalDecision: (...a: unknown[]) => claimProposalDecision(...a),
  settleProposalOutcome: (...a: unknown[]) => settleProposalOutcome(...a),
}));

const { decideProposal } = await import("./proposal-actions");

const PROPOSAL_ID = "11111111-1111-4111-8111-111111111111";
const DAY_MS = 24 * 60 * 60 * 1000;

function automationProposal(actions: unknown[]) {
  return {
    id: PROPOSAL_ID,
    userAgentId: "agent-1",
    runId: "run-1",
    orgId: "org-1",
    ownerId: FAKE_ACTOR,
    capability: "automation.create",
    toolName: "create_automation",
    toolCallId: "call-1",
    input: {
      boardId: FAKE_BOARD,
      name: "Nudge on done",
      trigger: someTrigger,
      actions,
    },
    summary: "…",
    status: "pending",
    expiresAt: new Date(Date.now() + 6 * DAY_MS).toISOString(),
    createdAt: new Date(Date.now() - DAY_MS).toISOString(),
    result: null,
  };
}

function client(spec: AutomationClientSpec = {}) {
  fake = makeAutomationClient(spec);
}

beforeEach(() => {
  requireUser.mockReset().mockResolvedValue({ id: FAKE_ACTOR });
  claimProposalDecision.mockReset().mockResolvedValue(true);
  settleProposalOutcome.mockReset().mockResolvedValue(true);
  getProposalForDecision.mockReset();
  client();
});

describe("decideProposal — a real create_automation descriptor", () => {
  it("executes the stored call as the approver and records the outcome", async () => {
    client({ role: "member" });
    getProposalForDecision.mockResolvedValue(
      automationProposal([notifyAction]),
    );

    const r = await decideProposal({ id: PROPOSAL_ID, approve: true });

    expect(r).toEqual({ ok: true, data: { status: "approved" } });
    // The rule really landed, written by the APPROVER — not by the agent, and
    // not by a service client.
    expect(fake.inserts).toHaveLength(1);
    expect(fake.inserts[0]).toMatchObject({
      board_id: FAKE_BOARD,
      created_by: FAKE_ACTOR,
    });
    // Claimed before executing, settled after. Both halves, in that order.
    expect(claimProposalDecision).toHaveBeenCalledOnce();
    expect(settleProposalOutcome.mock.calls[0]?.[1]).toMatchObject({
      status: "approved",
    });
  });

  /**
   * THE ONE THAT MATTERS. A proposal outlives the schema that produced it, and
   * the agent tool has since stopped offering `call_webhook` at all. A stored
   * row carrying one must be refused at step 5 — re-validation against the
   * tool's CURRENT input schema — and never reach `createAutomationCore`, whose
   * own guard would have waved it through for an org admin.
   */
  it("refuses a stored webhook action against the tool's CURRENT schema", async () => {
    // An org ADMIN approving: the exact actor the core's guard admits.
    client({ role: "admin" });
    getProposalForDecision.mockResolvedValue(
      automationProposal([webhookAction]),
    );

    const r = await decideProposal({ id: PROPOSAL_ID, approve: true });

    expect(r.ok).toBe(false);
    expect(fake.inserts).toHaveLength(0);
    // Terminal, not left pending: the row is decided `failed` rather than
    // offering an Approve button whose only possible outcome is failure.
    expect(claimProposalDecision.mock.calls[0]?.[1]).toMatchObject({
      status: "failed",
    });
    expect(settleProposalOutcome).not.toHaveBeenCalled();
  });

  it("surfaces a real core refusal as a failed decision", async () => {
    // The board is gone — `createAutomationCore`'s own "Board not found."
    client({ board: null });
    getProposalForDecision.mockResolvedValue(
      automationProposal([notifyAction]),
    );

    const r = await decideProposal({ id: PROPOSAL_ID, approve: true });

    expect(r.ok).toBe(false);
    expect(fake.inserts).toHaveLength(0);
    expect(settleProposalOutcome.mock.calls[0]?.[1]).toMatchObject({
      status: "failed",
    });
  });
});
