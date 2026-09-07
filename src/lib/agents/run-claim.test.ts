import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import {
  claimAgentRun,
  CLAIM_REFUSAL_COPY,
  DELEGATE_FANOUT_MAX,
  type ClaimOutcome,
} from "./run-claim";

/**
 * `agent_run_claim` is the ONE way a non-scheduled run comes into existence,
 * so what this suite pins is the wrapper's honesty about the RPC's answer:
 * the outcome travels back verbatim, a refusal never carries a run id, and a
 * transport failure degrades to a refusal rather than a throw that would kill
 * the caller's run. The rules themselves (depth, fan-out, cooldown, the daily
 * cap, ownership) live in SQL and are covered by
 * `agent_run_claim.rls.integration.test.ts`.
 */

type RpcAnswer = { outcome: string; run_id: string | null }[] | Error;

const rpc = vi.fn();

function fakeClient(answers: {
  agent_run_claim: RpcAnswer;
}): SupabaseClient<Database> {
  rpc.mockImplementation(async (fn: string, args: Record<string, unknown>) => {
    lastCall = { fn, args };
    const a = answers.agent_run_claim;
    return a instanceof Error
      ? { data: null, error: { message: a.message } }
      : { data: a, error: null };
  });
  return { rpc } as unknown as SupabaseClient<Database>;
}

let lastCall: { fn: string; args: Record<string, unknown> } | null = null;

beforeEach(() => {
  rpc.mockReset();
  lastCall = null;
});

describe("claimAgentRun", () => {
  it("returns the RPC's outcome and run id", async () => {
    const client = fakeClient({
      agent_run_claim: [{ outcome: "claimed", run_id: "r1" }],
    });
    await expect(
      claimAgentRun(client, { agentId: "a1", trigger: "mention" }),
    ).resolves.toEqual({ outcome: "claimed", runId: "r1" });
  });

  it("returns a refusal with a null run id", async () => {
    const client = fakeClient({
      agent_run_claim: [{ outcome: "refused_fanout", run_id: null }],
    });
    await expect(
      claimAgentRun(client, {
        agentId: "a1",
        trigger: "delegation",
        parentRunId: "p",
      }),
    ).resolves.toEqual({ outcome: "refused_fanout", runId: null });
  });

  it("treats an RPC error as a refusal rather than throwing", async () => {
    const client = fakeClient({ agent_run_claim: new Error("boom") });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await claimAgentRun(client, {
      agentId: "a1",
      trigger: "mention",
    });
    expect(r.runId).toBeNull();
    expect(r.outcome).not.toBe("claimed");
    errSpy.mockRestore();
  });

  it("treats an empty result set as a refusal rather than throwing", async () => {
    const client = fakeClient({ agent_run_claim: [] });
    const r = await claimAgentRun(client, {
      agentId: "a1",
      trigger: "mention",
    });
    expect(r).toEqual({ outcome: "refused_not_owner", runId: null });
  });

  // A delegation with no parent would be a depth-0 run the fan-out counter
  // cannot see; the RPC decides that, so the wrapper must send what it was
  // given — including an explicit null — rather than omitting the argument.
  it("passes the trigger and parent run id through to the RPC", async () => {
    const client = fakeClient({
      agent_run_claim: [{ outcome: "claimed", run_id: "r1" }],
    });
    await claimAgentRun(client, {
      agentId: "a1",
      trigger: "delegation",
      parentRunId: "p1",
    });
    expect(lastCall).toEqual({
      fn: "agent_run_claim",
      args: {
        p_agent_id: "a1",
        p_trigger: "delegation",
        p_parent_run_id: "p1",
      },
    });
  });

  it("sends a null parent run id when none is given", async () => {
    const client = fakeClient({
      agent_run_claim: [{ outcome: "claimed", run_id: "r1" }],
    });
    await claimAgentRun(client, { agentId: "a1", trigger: "mention" });
    expect(lastCall!.args.p_parent_run_id).toBeNull();
  });
});

describe("CLAIM_REFUSAL_COPY", () => {
  // A model told only "denied" re-proposes the same call until it runs out of
  // steps — the `remember`/`refused_cap` lesson. Every refusal must say what
  // was wrong AND what to do instead.
  it("has copy for every refusal outcome", () => {
    const outcomes: Exclude<ClaimOutcome, "claimed">[] = [
      "refused_bad_trigger",
      "refused_not_owner",
      "refused_disabled",
      "refused_depth",
      "refused_fanout",
      "refused_cooldown",
      "refused_daily_cap",
    ];
    for (const o of outcomes) expect(CLAIM_REFUSAL_COPY[o]).toBeTruthy();
  });

  it("names the real fan-out maximum rather than a hardcoded number", () => {
    expect(CLAIM_REFUSAL_COPY.refused_fanout).toContain(
      String(DELEGATE_FANOUT_MAX),
    );
  });
});
