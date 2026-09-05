import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

const getPlatformAgentUserId = vi.fn();
vi.mock("@/lib/ai/agentic/board-agents-db", () => ({
  getPlatformAgentUserId: (...a: unknown[]) => getPlatformAgentUserId(...a),
}));

import {
  postAgentReply,
  agentReplyBodyText,
  AGENT_REPLY_MAX_CHARS,
} from "./agent-reply";

const RUN = "00000000-0000-4000-8000-0000000000b1";
const ITEM = "00000000-0000-4000-8000-0000000000c1";
const UPD = "00000000-0000-4000-8000-0000000000d1";
const OWNER = "00000000-0000-4000-8000-0000000000f2";
const BOT = "00000000-0000-4000-8000-0000000000bb";

type Row = Record<string, unknown>;

/** A service-client double over the four tables `postAgentReply` touches. */
function makeSvc(
  over: {
    item?: Row | null;
    run?: Row | null;
    updateError?: { message: string };
    notifError?: { message: string };
  } = {},
) {
  const updateInsert = vi.fn();
  const notifInsert = vi.fn();
  const item =
    over.item === undefined ? { org_id: "org", board_id: "board" } : over.item;
  const run =
    over.run === undefined ? { owner_id: OWNER, org_id: "org" } : over.run;

  const client = {
    from(table: string) {
      if (table === "items")
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: item, error: null }),
            }),
          }),
        };
      if (table === "user_agent_runs")
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: run, error: null }),
            }),
          }),
        };
      if (table === "item_updates")
        return {
          insert: (row: Row) => {
            updateInsert(row);
            return {
              select: () => ({
                maybeSingle: async () =>
                  over.updateError
                    ? { data: null, error: over.updateError }
                    : { data: { id: UPD }, error: null },
              }),
            };
          },
        };
      if (table === "notifications")
        return {
          insert: async (row: Row) => {
            notifInsert(row);
            return { error: over.notifError ?? null };
          },
        };
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient<Database>;
  return { client, updateInsert, notifInsert };
}

const ARGS = {
  runId: RUN,
  itemId: ITEM,
  agentName: "Ops",
  agentHandle: "ops",
  text: "Two items are blocked on the vendor.",
};

beforeEach(() => {
  getPlatformAgentUserId.mockReset().mockResolvedValue(BOT);
});

describe("agentReplyBodyText", () => {
  it("names the agent and its handle, server-composed", () => {
    expect(agentReplyBodyText(ARGS)).toBe(
      "Ops (@ops): Two items are blocked on the vendor.",
    );
  });

  it("caps a runaway report at the human comment ceiling", () => {
    const out = agentReplyBodyText({ ...ARGS, text: "x".repeat(50_000) });
    expect(out).toContain("… (truncated)");
    expect(out.length).toBeLessThan(AGENT_REPLY_MAX_CHARS + 100);
  });
});

describe("postAgentReply", () => {
  it("authors the comment as the PLATFORM BOT, never as a person", async () => {
    const { client, updateInsert } = makeSvc();
    await postAgentReply(client, ARGS);
    expect(updateInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        org_id: "org",
        board_id: "board",
        item_id: ITEM,
        author_id: BOT,
        body_text: "Ops (@ops): Two items are blocked on the vendor.",
      }),
    );
    // Not the owner, not the summoner, not any member.
    expect(updateInsert.mock.calls[0]![0]!.author_id).not.toBe(OWNER);
  });

  it("carries a structured agent marker so the UI can badge it", async () => {
    const { client, updateInsert } = makeSvc();
    await postAgentReply(client, ARGS);
    expect(updateInsert.mock.calls[0]![0]!.body).toMatchObject({
      agent: { name: "Ops", handle: "ops", runId: RUN },
    });
  });

  // ── the reply-loop proof ────────────────────────────────────────────────
  it("records NO mention targets, even when the answer names a handle", async () => {
    const { client, updateInsert } = makeSvc();
    await postAgentReply(client, {
      ...ARGS,
      text: "@ops @planner please pick this up, @everyone",
    });
    // The trigger reads the TAGGED array, never the prose — so an answer full
    // of handles summons nothing.
    expect(updateInsert.mock.calls[0]![0]!.body).toMatchObject({
      mentions: [],
    });
  });

  it("never routes through addUpdate — the only place the trigger lives", async () => {
    // A static guarantee, asserted statically: if this import ever appears,
    // an agent's reply could claim a run and the loop becomes reachable.
    const { readFile } = await import("node:fs/promises");
    const src = await readFile("src/lib/agents/agent-reply.ts", "utf8");
    expect(src).not.toMatch(/from "@\/lib\/collaboration\/actions"/);
    expect(src).not.toMatch(/claimAgentRun|dispatchAgentRun/);
  });

  it("notifies the run's OWNER with kind agent_reply and no actor", async () => {
    const { client, notifInsert } = makeSvc();
    await postAgentReply(client, ARGS);
    expect(notifInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        org_id: "org",
        recipient_id: OWNER,
        actor_id: null,
        kind: "agent_reply",
        board_id: "board",
        item_id: ITEM,
        update_id: UPD,
        payload: { agentName: "Ops", agentHandle: "ops" },
      }),
    );
  });

  it("does not notify when the comment insert failed", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client, notifInsert } = makeSvc({
      updateError: { message: "denied" },
    });
    await postAgentReply(client, ARGS);
    expect(notifInsert).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("writes nothing and logs when the item is gone", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client, updateInsert, notifInsert } = makeSvc({ item: null });
    await postAgentReply(client, ARGS);
    expect(updateInsert).not.toHaveBeenCalled();
    expect(notifInsert).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("writes nothing when the platform bot cannot be resolved", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    getPlatformAgentUserId.mockResolvedValue(null);
    const { client, updateInsert } = makeSvc();
    await postAgentReply(client, ARGS);
    expect(updateInsert).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("never throws — the run already succeeded", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exploding = {
      from() {
        throw new Error("connection reset");
      },
    } as unknown as SupabaseClient<Database>;
    await expect(postAgentReply(exploding, ARGS)).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledWith(
      "[agents] agent reply failed:",
      expect.objectContaining({ runId: RUN }),
    );
    spy.mockRestore();
  });

  it("logs but does not throw when the notification insert fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = makeSvc({ notifError: { message: "gated" } });
    await expect(postAgentReply(client, ARGS)).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
