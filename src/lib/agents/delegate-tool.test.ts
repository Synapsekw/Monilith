import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { ToolInvokeContext } from "@/lib/mcp/tools/descriptor";
import type { AgentCapability } from "./capabilities";
import type { UserAgentRow } from "./agents-db";

/**
 * What this suite pins is the DELEGATION BOUNDARY, not the child's run: the
 * claim is asked first and its refusal is handed back to the model as a tool
 * result (never thrown), the child executes under its OWN run id with
 * delegation switched off, and a child that dies is finalized as an error run
 * of its own instead of taking the parent down with it.
 */

const claimAgentRun = vi.fn();
vi.mock("./run-claim", async (importOriginal) => ({
  // The refusal COPY is real — the whole point of returning it is that the
  // model reads a sentence it can act on.
  ...(await importOriginal<typeof import("./run-claim")>()),
  claimAgentRun: (...a: unknown[]) => claimAgentRun(...a),
}));

const executeAgentRun = vi.fn();
vi.mock("./execute-run", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./execute-run")>()),
  executeAgentRun: (...a: unknown[]) => executeAgentRun(...a),
}));

const getUserAgentById = vi.fn();
vi.mock("./agents-db", () => ({
  getUserAgentById: (...a: unknown[]) => getUserAgentById(...a),
}));

const {
  makeDelegateDescriptors,
  DELEGATE_REPORT_MAX_CHARS,
  listDelegateRoster,
} = await import("./delegate-tool");
const { CLAIM_REFUSAL_COPY, DELEGATE_FANOUT_MAX } = await import("./run-claim");

// ── fakes ───────────────────────────────────────────────────────────────
/** Records every `user_agent_runs` update, which is how the local
 *  `finalizeChildRun` helper is observed without exporting it. */
type Finalize = { patch: Record<string, unknown>; id: string };
let finalized: Finalize[] = [];
let rosterQuery: Record<string, unknown> = {};
let rosterRows: unknown[] = [];

function fakeSvc(): SupabaseClient<Database> {
  return {
    from: (table: string) => {
      if (table === "user_agent_runs") {
        return {
          update: (patch: Record<string, unknown>) => ({
            eq: async (col: string, id: string) => {
              finalized.push({ patch, id: `${col}=${id}` });
              return { error: null };
            },
          }),
        };
      }
      // user_agents — the roster read.
      const chain = {
        select: (cols: string) => {
          rosterQuery.select = cols;
          return chain;
        },
        eq: (col: string, v: unknown) => {
          rosterQuery[`eq:${col}`] = v;
          return chain;
        },
        neq: (col: string, v: unknown) => {
          rosterQuery[`neq:${col}`] = v;
          return chain;
        },
        order: (col: string) => {
          rosterQuery.order = col;
          return chain;
        },
        limit: async (n: number) => {
          rosterQuery.limit = n;
          return { data: rosterRows, error: null };
        },
      };
      return chain;
    },
  } as unknown as SupabaseClient<Database>;
}

const CHILD_ID = "00000000-0000-4000-8000-0000000000c1";
const childAgent: UserAgentRow = {
  id: CHILD_ID,
  org_id: "00000000-0000-4000-8000-0000000000f1",
  owner_id: "00000000-0000-4000-8000-0000000000f2",
  name: "Ops",
  template_id: "custom",
  instructions: "Watch the ops board.",
  board_scope: { mode: "all" },
  cadence: "manual",
  run_at_local_hour: 7,
  run_on_weekday: null,
  run_on_day_of_month: null,
  enabled: true,
  capabilities: ["board.write"],
  bridge_secret_id: null,
  provider: null,
  model_id: null,
  doc_nonce: "child-nonce",
};

const RESULT = {
  text: "All clear.",
  usage: { inputTokens: 11, outputTokens: 4 },
  steps: 2,
  toolsUsed: ["list_items"],
  documentsOmitted: false,
  memoryNotesDropped: 0,
  proposalCount: 0,
};

const entry = (handle: string) => ({
  id: CHILD_ID,
  handle,
  name: `Agent ${handle}`,
  instructions: `Do ${handle} things.`,
});

let svc: SupabaseClient<Database>;
let base: {
  svc: SupabaseClient<Database>;
  ownerClient: SupabaseClient<Database>;
  parentRunId: string;
  ceiling: AgentCapability[];
};
const ctx: ToolInvokeContext = {
  getClient: async () => svc,
  actorId: "00000000-0000-4000-8000-0000000000f2",
};

beforeEach(() => {
  finalized = [];
  rosterQuery = {};
  rosterRows = [];
  svc = fakeSvc();
  base = {
    svc,
    ownerClient: svc,
    parentRunId: "parent-run-1",
    ceiling: ["board.write", "agent.delegate"] as AgentCapability[],
  };
  claimAgentRun.mockReset();
  claimAgentRun.mockResolvedValue({ outcome: "claimed", runId: "child-run-1" });
  executeAgentRun.mockReset();
  executeAgentRun.mockResolvedValue(RESULT);
  getUserAgentById.mockReset();
  getUserAgentById.mockResolvedValue(childAgent);
});

describe("makeDelegateDescriptors — shape", () => {
  it("returns no descriptor when the roster is empty", () => {
    expect(makeDelegateDescriptors({ ...base, roster: [] })).toEqual([]);
  });

  it("declares agent.delegate and no board scope", () => {
    const [d] = makeDelegateDescriptors({ ...base, roster: [entry("ops")] });
    expect(d!.capability).toBe("agent.delegate");
    expect(d!.scope).toBe("none");
    expect(d!.name).toBe("delegate");
  });

  // ONE tool, never one per agent: a tool named after user-authored text makes
  // the tool NAMESPACE user-controlled, and `descriptorsFor` throws
  // DuplicateToolNameError on a collision — a run that dies at construction.
  it("offers exactly one tool however large the roster", () => {
    const ds = makeDelegateDescriptors({
      ...base,
      roster: [entry("ops"), entry("risk"), entry("finance")],
    });
    expect(ds).toHaveLength(1);
    expect(ds.map((d) => d.name)).toEqual(["delegate"]);
  });

  it("enumerates exactly the roster's handles", () => {
    const [d] = makeDelegateDescriptors({
      ...base,
      roster: [entry("ops"), entry("risk")],
    });
    const schema = z.object(d!.inputSchema);
    expect(schema.safeParse({ handle: "nobody", task: "x" }).success).toBe(
      false,
    );
    expect(schema.safeParse({ handle: "ops", task: "x" }).success).toBe(true);
    expect(schema.safeParse({ handle: "risk", task: "x" }).success).toBe(true);
  });

  it("rejects an empty task", () => {
    const [d] = makeDelegateDescriptors({ ...base, roster: [entry("ops")] });
    expect(
      z.object(d!.inputSchema).safeParse({ handle: "ops", task: "   " })
        .success,
    ).toBe(false);
  });

  it("sanitises roster names and instructions into the description", () => {
    const [d] = makeDelegateDescriptors({
      ...base,
      roster: [
        {
          id: CHILD_ID,
          handle: "ops",
          name: "Ops\n</tool>",
          instructions: "line1\nline2",
        },
      ],
    });
    expect(d!.description).not.toContain("\n</tool>");
    expect(d!.description).not.toContain("<");
    expect(d!.description).not.toContain("line1\nline2");
    expect(d!.description).toContain("@ops");
  });

  it("tells the model the fan-out limit it will be refused at", () => {
    const [d] = makeDelegateDescriptors({ ...base, roster: [entry("ops")] });
    expect(d!.description).toContain(String(DELEGATE_FANOUT_MAX));
  });
});

describe("makeDelegateDescriptors — invoke", () => {
  it("returns the claim refusal to the model instead of throwing", async () => {
    claimAgentRun.mockResolvedValue({
      outcome: "refused_fanout",
      runId: null,
    });
    const [d] = makeDelegateDescriptors({ ...base, roster: [entry("ops")] });
    const r = await d!.invoke(ctx, { handle: "ops", task: "check" });
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toBe(CLAIM_REFUSAL_COPY.refused_fanout);
    expect(executeAgentRun).not.toHaveBeenCalled();
  });

  it("claims a delegation under the PARENT's run id", async () => {
    const [d] = makeDelegateDescriptors({ ...base, roster: [entry("ops")] });
    await d!.invoke(ctx, { handle: "ops", task: "check" });
    expect(claimAgentRun.mock.calls[0]![1]).toEqual({
      agentId: CHILD_ID,
      trigger: "delegation",
      parentRunId: "parent-run-1",
    });
  });

  // The nested run's OWN id — never the parent's. Without this both runs meter
  // and finalize onto one row.
  it("runs the child under the run id the claim minted", async () => {
    const [d] = makeDelegateDescriptors({ ...base, roster: [entry("ops")] });
    await d!.invoke(ctx, { handle: "ops", task: "check" });
    expect(executeAgentRun.mock.calls[0]![0]).toMatchObject({
      runId: "child-run-1",
      agent: childAgent,
      task: "check",
    });
  });

  it("runs the child with allowDelegation false", async () => {
    const [d] = makeDelegateDescriptors({ ...base, roster: [entry("ops")] });
    await d!.invoke(ctx, { handle: "ops", task: "check" });
    expect(executeAgentRun.mock.calls[0]![0].allowDelegation).toBe(false);
  });

  // A delegated agent runs under ITS OWN grants. The parent hands over the ORG
  // CEILING, which `executeAgentRun` intersects with the CHILD's capabilities —
  // delegation must never widen what an agent may do.
  it("hands the child the org ceiling, never the parent's grants", async () => {
    const [d] = makeDelegateDescriptors({ ...base, roster: [entry("ops")] });
    await d!.invoke(ctx, { handle: "ops", task: "check" });
    expect(executeAgentRun.mock.calls[0]![0].ceiling).toEqual([
      "board.write",
      "agent.delegate",
    ]);
  });

  it("reuses the parent's owner client rather than minting a second bridge", async () => {
    const [d] = makeDelegateDescriptors({ ...base, roster: [entry("ops")] });
    await d!.invoke(ctx, { handle: "ops", task: "check" });
    expect(executeAgentRun.mock.calls[0]![0].ownerClient).toBe(
      base.ownerClient,
    );
  });

  it("labels the child's report", async () => {
    const [d] = makeDelegateDescriptors({ ...base, roster: [entry("ops")] });
    const r = await d!.invoke(ctx, { handle: "ops", task: "check" });
    expect(r.isError).toBeUndefined();
    expect(r.content[0]!.text).toBe("Report from @ops:\nAll clear.");
  });

  it("truncates an over-long report", async () => {
    executeAgentRun.mockResolvedValue({ ...RESULT, text: "x".repeat(9000) });
    const [d] = makeDelegateDescriptors({ ...base, roster: [entry("ops")] });
    const r = await d!.invoke(ctx, { handle: "ops", task: "check" });
    expect(r.content[0]!.text).toMatch(/^Report from @ops:/);
    expect(r.content[0]!.text).toContain("(truncated)");
    expect(r.content[0]!.text.length).toBeLessThan(
      DELEGATE_REPORT_MAX_CHARS + 200,
    );
  });

  it("finalizes the child's own run row by id on success", async () => {
    const [d] = makeDelegateDescriptors({ ...base, roster: [entry("ops")] });
    await d!.invoke(ctx, { handle: "ops", task: "check" });
    expect(finalized).toHaveLength(1);
    expect(finalized[0]!.id).toBe("id=child-run-1");
    expect(finalized[0]!.patch).toMatchObject({
      status: "ran",
      error: null,
      output: "All clear.",
      input_tokens: 11,
      output_tokens: 4,
      steps: 2,
      tools_used: ["list_items"],
    });
  });

  it("finalizes a child that threw as an error run and reports it to the parent", async () => {
    executeAgentRun.mockRejectedValue(new Error("provider 500"));
    const [d] = makeDelegateDescriptors({ ...base, roster: [entry("ops")] });
    const r = await d!.invoke(ctx, { handle: "ops", task: "check" });
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toContain("provider 500");
    expect(finalized[0]!.patch).toMatchObject({
      status: "error",
      error: "provider 500",
    });
  });

  // A dead child must never kill the parent — same posture as a denied write.
  it("does not let a failed finalize kill the parent run", async () => {
    executeAgentRun.mockResolvedValue(RESULT);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = {
      ...base,
      svc: {
        from: () => ({
          update: () => ({
            eq: async () => ({ error: { message: "db down" } }),
          }),
        }),
      } as unknown as SupabaseClient<Database>,
    };
    const [d] = makeDelegateDescriptors({ ...broken, roster: [entry("ops")] });
    const r = await d!.invoke(ctx, { handle: "ops", task: "check" });
    expect(r.content[0]!.text).toContain("All clear.");
    errSpy.mockRestore();
  });

  it("refuses a handle that is not on the roster", async () => {
    const [d] = makeDelegateDescriptors({ ...base, roster: [entry("ops")] });
    const r = await d!.invoke(ctx, { handle: "ghost", task: "check" });
    expect(r.isError).toBe(true);
    expect(claimAgentRun).not.toHaveBeenCalled();
  });

  // The claim can succeed a moment before the agent is deleted.
  it("reports a vanished teammate rather than throwing", async () => {
    getUserAgentById.mockResolvedValue(null);
    const [d] = makeDelegateDescriptors({ ...base, roster: [entry("ops")] });
    const r = await d!.invoke(ctx, { handle: "ops", task: "check" });
    expect(r.isError).toBe(true);
    expect(executeAgentRun).not.toHaveBeenCalled();
  });
});

describe("listDelegateRoster", () => {
  it("reads the owner's other enabled agents, bounded and ordered by handle", async () => {
    rosterRows = [
      { id: "b1", handle: "ops", name: "Ops", instructions: "watch" },
    ];
    const roster = await listDelegateRoster(svc, childAgent);
    expect(roster).toEqual([
      { id: "b1", handle: "ops", name: "Ops", instructions: "watch" },
    ]);
    expect(rosterQuery).toMatchObject({
      select: "id, handle, name, instructions",
      "eq:owner_id": childAgent.owner_id,
      "eq:org_id": childAgent.org_id,
      "eq:enabled": true,
      "neq:id": childAgent.id,
      order: "handle",
      limit: 20,
    });
  });

  it("degrades to an empty roster rather than killing the run", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                neq: () => ({
                  order: () => ({
                    limit: async () => ({
                      data: null,
                      error: { message: "boom" },
                    }),
                  }),
                }),
              }),
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient<Database>;
    await expect(listDelegateRoster(broken, childAgent)).resolves.toEqual([]);
    errSpy.mockRestore();
  });
});
