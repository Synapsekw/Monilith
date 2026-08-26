import { describe, expect, it } from "vitest";
import {
  FAKE_ACTOR,
  FAKE_BOARD,
  FAKE_ORG,
  makeAutomationClient,
  notifyAction,
  someTrigger,
  webhookAction,
} from "@/test/automation-fake-client";
import { createAutomationCore } from "./automation-core";

describe("createAutomationCore — webhook admin guard", () => {
  // The guard is the thing most likely to be lost in an extraction
  // (gotcha-60). These cases pin BOTH directions: it still refuses, and it was
  // not over-applied to every automation.
  it("refuses a webhook automation when the actor is not an org admin", async () => {
    const { client, inserts } = makeAutomationClient({ role: "member" });
    const r = await createAutomationCore(
      client,
      { boardId: FAKE_BOARD, trigger: someTrigger, actions: [webhookAction] },
      FAKE_ACTOR,
    );
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toMatch(/organization admin/i);
    expect(inserts).toHaveLength(0);
  });

  it("creates a non-webhook automation for a non-admin", async () => {
    const { client } = makeAutomationClient({ role: "member" });
    const r = await createAutomationCore(
      client,
      { boardId: FAKE_BOARD, trigger: someTrigger, actions: [notifyAction] },
      FAKE_ACTOR,
    );
    expect(r).toEqual({ ok: true, data: { id: "auto-1" } });
  });

  it("allows a webhook automation for an org admin", async () => {
    const { client } = makeAutomationClient({ role: "admin" });
    const r = await createAutomationCore(
      client,
      { boardId: FAKE_BOARD, trigger: someTrigger, actions: [webhookAction] },
      FAKE_ACTOR,
    );
    expect(r.ok).toBe(true);
  });

  it("allows a webhook automation for an org owner", async () => {
    const { client } = makeAutomationClient({ role: "owner" });
    const r = await createAutomationCore(
      client,
      { boardId: FAKE_BOARD, trigger: someTrigger, actions: [webhookAction] },
      FAKE_ACTOR,
    );
    expect(r.ok).toBe(true);
  });

  it("refuses a webhook automation when the actor is not an org member", async () => {
    const { client } = makeAutomationClient({ role: null });
    const r = await createAutomationCore(
      client,
      { boardId: FAKE_BOARD, trigger: someTrigger, actions: [webhookAction] },
      FAKE_ACTOR,
    );
    expect(r.ok).toBe(false);
  });

  it("refuses a webhook automation when there is no actor at all", async () => {
    const { client, reads } = makeAutomationClient({ role: "admin" });
    const r = await createAutomationCore(
      client,
      { boardId: FAKE_BOARD, trigger: someTrigger, actions: [webhookAction] },
      null,
    );
    expect(r.ok).toBe(false);
    // No actor means no role to look up — the refusal costs zero queries.
    expect(reads.some((x) => x.table === "org_members")).toBe(false);
  });

  it("does not look up a role for a non-webhook automation", async () => {
    const { client, reads } = makeAutomationClient({ role: "member" });
    await createAutomationCore(
      client,
      { boardId: FAKE_BOARD, trigger: someTrigger, actions: [notifyAction] },
      FAKE_ACTOR,
    );
    expect(reads.some((x) => x.table === "org_members")).toBe(false);
  });
});

describe("createAutomationCore — insert", () => {
  it("writes the actor as created_by without consulting supabase.auth", async () => {
    const { client, inserts } = makeAutomationClient({
      role: "member",
      position: 4,
    });
    await createAutomationCore(
      client,
      {
        boardId: FAKE_BOARD,
        name: "  Nightly nudge  ",
        trigger: someTrigger,
        actions: [notifyAction],
      },
      FAKE_ACTOR,
    );
    expect(inserts[0]).toMatchObject({
      org_id: FAKE_ORG,
      board_id: FAKE_BOARD,
      name: "Nightly nudge",
      created_by: FAKE_ACTOR,
      position: 5,
    });
  });

  it("starts positions at 0 on a board with no automations", async () => {
    const { client, inserts } = makeAutomationClient({ position: null });
    await createAutomationCore(
      client,
      { boardId: FAKE_BOARD, trigger: someTrigger, actions: [notifyAction] },
      FAKE_ACTOR,
    );
    expect(inserts[0]).toMatchObject({ position: 0, name: null });
  });

  it("stores a null condition when none is supplied", async () => {
    const { client, inserts } = makeAutomationClient({});
    await createAutomationCore(
      client,
      { boardId: FAKE_BOARD, trigger: someTrigger, actions: [notifyAction] },
      FAKE_ACTOR,
    );
    expect(inserts[0].condition).toBeNull();
  });

  it("surfaces an insert failure", async () => {
    const { client } = makeAutomationClient({ insertError: "denied by RLS" });
    const r = await createAutomationCore(
      client,
      { boardId: FAKE_BOARD, trigger: someTrigger, actions: [notifyAction] },
      FAKE_ACTOR,
    );
    expect(r).toEqual({ ok: false, error: "denied by RLS" });
  });
});

// The fake used to discard the arguments to `.eq()`, so EVERY predicate in
// this core was invisible to its own suite: the membership check could have
// dropped `user_id` (asking "is anyone an admin of this org?"), the board read
// could have dropped `id` (resolving some other org), and the position read
// could have dropped `board_id` (numbering against another board's rules) —
// all three still green. The fake now records each predicate, so the suite can
// state which ROWS the core addresses, not merely which tables it touched.
describe("createAutomationCore — which rows each lookup addresses", () => {
  it("keys the board, membership and position reads on the right columns", async () => {
    const { client, reads } = makeAutomationClient({ role: "admin" });
    const r = await createAutomationCore(
      client,
      { boardId: FAKE_BOARD, trigger: someTrigger, actions: [webhookAction] },
      FAKE_ACTOR,
    );
    expect(r.ok).toBe(true);

    const board = reads.find((x) => x.table === "boards");
    expect(board?.eq).toEqual([["id", FAKE_BOARD]]);

    // Both halves: the org resolved FROM the board, and the actor passed in.
    // Dropping either turns the admin gate into a different question.
    const member = reads.find((x) => x.table === "org_members");
    expect(member?.eq).toEqual([
      ["org_id", FAKE_ORG],
      ["user_id", FAKE_ACTOR],
    ]);

    const position = reads.find((x) => x.table === "automations");
    expect(position?.eq).toEqual([["board_id", FAKE_BOARD]]);
  });

  it("asks for the HIGHEST existing position, one row only", async () => {
    // `(nextPos?.position ?? -1) + 1` is only "append to the end" if the read
    // is ordered descending and limited to one row.
    const { client, reads } = makeAutomationClient({ position: 4 });
    await createAutomationCore(
      client,
      { boardId: FAKE_BOARD, trigger: someTrigger, actions: [notifyAction] },
      FAKE_ACTOR,
    );
    const position = reads.find((x) => x.table === "automations");
    expect(position?.order).toEqual([["position", { ascending: false }]]);
    expect(position?.limit).toEqual([1]);
  });
});

describe("createAutomationCore — boundary validation", () => {
  it("rejects an invalid trigger before touching the database", async () => {
    const { client, reads } = makeAutomationClient({});
    const r = await createAutomationCore(
      client,
      {
        boardId: FAKE_BOARD,
        trigger: { type: "nope" },
        actions: [notifyAction],
      },
      FAKE_ACTOR,
    );
    expect(r.ok).toBe(false);
    expect(reads).toHaveLength(0);
  });

  it("rejects an empty actions array", async () => {
    const { client } = makeAutomationClient({});
    const r = await createAutomationCore(
      client,
      { boardId: FAKE_BOARD, trigger: someTrigger, actions: [] },
      FAKE_ACTOR,
    );
    expect(r.ok).toBe(false);
  });

  it("reports a missing board", async () => {
    const { client } = makeAutomationClient({ board: null });
    const r = await createAutomationCore(
      client,
      { boardId: FAKE_BOARD, trigger: someTrigger, actions: [notifyAction] },
      FAKE_ACTOR,
    );
    expect(r).toEqual({ ok: false, error: "Board not found." });
  });
});
