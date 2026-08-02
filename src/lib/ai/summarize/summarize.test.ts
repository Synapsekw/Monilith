import { describe, expect, it } from "vitest";
import { buildTranscript, summarizeThread } from "@/lib/ai/summarize/summarize";
import { modelFor } from "@/lib/ai/model-map";
import type {
  ItemActivityRow,
  ItemUpdateRow,
} from "@/lib/ai/summarize/summarize";
import type { Tables } from "@/types/database.types";

const COL: Tables<"columns"> = {
  id: "col-status",
  org_id: "o",
  board_id: "b",
  kind: "status",
  name: "Status",
  settings: {
    options: [
      { id: "s1", label: "Working on it", color: "#fdab3d" },
      { id: "s2", label: "Done", color: "#00c875" },
    ],
  },
  position: 0,
  created_at: "",
  updated_at: "",
} as unknown as Tables<"columns">;

const MEMBERS = [
  { userId: "u1", fullName: "Ada Lovelace" },
  { userId: "u2", fullName: "Grace Hopper" },
];

function update(partial: Partial<ItemUpdateRow>): ItemUpdateRow {
  return {
    id: "up-1",
    org_id: "o",
    board_id: "b",
    item_id: "i1",
    author_id: "u1",
    body: {},
    body_text: "hello",
    created_at: "2026-06-17T00:00:00Z",
    edited_at: null,
    updated_at: "2026-06-17T00:00:00Z",
    ...partial,
  } as ItemUpdateRow;
}

function activity(partial: Partial<ItemActivityRow>): ItemActivityRow {
  return {
    id: "a1",
    org_id: "o",
    board_id: "b",
    item_id: "i1",
    actor_id: "u2",
    action: "item_created",
    column_id: null,
    old_value: null,
    new_value: null,
    created_at: "2026-06-17T00:00:00Z",
    ...partial,
  } as ItemActivityRow;
}

describe("buildTranscript", () => {
  it("returns the empty sentinel when there is nothing to summarize", () => {
    expect(
      buildTranscript({
        updates: [],
        activities: [],
        columns: [],
        members: [],
      }),
    ).toBe("");
  });

  it("orders updates and activities chronologically, oldest first", () => {
    const transcript = buildTranscript({
      updates: [
        update({
          id: "up-2",
          created_at: "2026-06-17T02:00:00Z",
          body_text: "second",
        }),
        update({
          id: "up-1",
          created_at: "2026-06-17T00:00:00Z",
          body_text: "first",
        }),
      ],
      activities: [
        activity({
          id: "a-1",
          created_at: "2026-06-17T01:00:00Z",
          action: "item_created",
        }),
      ],
      columns: [COL],
      members: MEMBERS,
    });
    const lines = transcript.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("first");
    expect(lines[1]).toContain("created this item");
    expect(lines[2]).toContain("second");
  });

  it("resolves author names for updates from members", () => {
    const transcript = buildTranscript({
      updates: [update({ author_id: "u2", body_text: "shipped it" })],
      activities: [],
      columns: [],
      members: MEMBERS,
    });
    expect(transcript).toContain("Grace Hopper: shipped it");
  });

  it("falls back to 'Someone' when the author isn't in members", () => {
    const transcript = buildTranscript({
      updates: [update({ author_id: "unknown-user", body_text: "hi" })],
      activities: [],
      columns: [],
      members: MEMBERS,
    });
    expect(transcript).toContain("Someone: hi");
  });

  it("renders an activity via resolveActivity (cell_changed)", () => {
    const transcript = buildTranscript({
      updates: [],
      activities: [
        activity({
          actor_id: "u1",
          action: "cell_changed",
          column_id: "col-status",
          old_value: { optionId: "s1" },
          new_value: { optionId: "s2" },
        }),
      ],
      columns: [COL],
      members: MEMBERS,
    });
    expect(transcript).toContain("Ada Lovelace Status: Working on it → Done");
  });

  it("renders item_renamed with from/to text", () => {
    const transcript = buildTranscript({
      updates: [],
      activities: [
        activity({
          action: "item_renamed",
          old_value: "Old name",
          new_value: "New name",
        }),
      ],
      columns: [],
      members: MEMBERS,
    });
    expect(transcript).toContain("renamed Old name → New name");
  });
});

describe("summarizeThread", () => {
  function fakeClient(text: string) {
    const create = async () => ({
      content: [{ type: "text", text }],
      usage: { input_tokens: 42, output_tokens: 7 },
    });
    return { messages: { create } };
  }

  it("returns the summary + usage from the injected client with no network call", async () => {
    const client = fakeClient("Here's what happened.");
    const result = await summarizeThread({
      apiKey: "unused",
      updates: [update({})],
      activities: [],
      columns: [],
      members: MEMBERS,
      client: client as never,
    });
    expect(result.summary).toBe("Here's what happened.");
    expect(result.usage).toEqual({ inputTokens: 42, outputTokens: 7 });
  });

  it("passes the built transcript as the sole user message", async () => {
    let capturedMessages: unknown;
    const client = {
      messages: {
        create: async (params: { messages: unknown }) => {
          capturedMessages = params.messages;
          return {
            content: [{ type: "text", text: "ok" }],
            usage: { input_tokens: 1, output_tokens: 1 },
          };
        },
      },
    };
    await summarizeThread({
      apiKey: "unused",
      updates: [update({ body_text: "the transcript body" })],
      activities: [],
      columns: [],
      members: MEMBERS,
      client: client as never,
    });
    expect(capturedMessages).toEqual([
      { role: "user", content: expect.stringContaining("the transcript body") },
    ]);
  });

  // Regression guard: the request must state `thinking` explicitly. Omitting it
  // on a Sonnet-tier model means ADAPTIVE thinking at effort "high", and
  // max_tokens caps thinking PLUS text — a thinking block would consume this
  // 1024-token budget and the user would get an empty summary, no error.
  // Deliberately NOT choice.thinking (which is adaptive for this feature).
  it("routes thread_summary through the model map and disables thinking", async () => {
    let params: Record<string, unknown> | undefined;
    const client = {
      messages: {
        create: async (p: Record<string, unknown>) => {
          params = p;
          return {
            content: [{ type: "text", text: "ok" }],
            usage: { input_tokens: 1, output_tokens: 1 },
          };
        },
      },
    };
    const res = await summarizeThread({
      apiKey: "unused",
      updates: [update({})],
      activities: [],
      columns: [],
      members: MEMBERS,
      client: client as never,
    });
    expect(params?.model).toBe(modelFor("thread_summary").model);
    expect(params?.thinking).toEqual({ type: "disabled" });
    expect(params?.max_tokens).toBe(1024);
    // Reported back so runAi's ledger row names the model that actually ran.
    expect(res.model).toBe(modelFor("thread_summary").model);
  });
});
