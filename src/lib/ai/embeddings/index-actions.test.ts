import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EmbeddingClient } from "./client";
import { EMBEDDING_MODEL } from "./client";
import { AiDisabledError } from "@/lib/ai/errors";

// runEmbedding is exercised end-to-end in gateway.test.ts; here we stub it to a
// pass-through that records the args, so we can assert embedTexts wires the
// client + input-only usage correctly without the service-client/entitlement chain.
const runEmbedding = vi.fn(
  async (
    _args: { orgId: string; userId: string | null; feature: string },
    fn: () => Promise<{ result: unknown; usage: unknown; model: string }>,
  ) => (await fn()).result,
);
vi.mock("@/lib/ai/gateway", () => ({
  runEmbedding: (...a: unknown[]) =>
    (runEmbedding as (...x: unknown[]) => unknown)(...a),
}));

beforeEach(() => vi.clearAllMocks());

// ── A tiny thenable PostgREST query-builder fake ────────────────────────────
// Enough of the supabase-js surface for embedBatch/embedBackfill: chainable
// select/in/gt/order/limit resolving to a per-table dataset, plus upsert/delete
// that record what was written. `id`-based gt/limit power the backfill paging.
type Row = Record<string, unknown>;
type Capture = {
  upserts: { table: string; rows: Row[] }[];
  deletes: { table: string; ids: unknown[] }[];
};

function makeSvc(data: Record<string, Row[]>, capture: Capture) {
  return {
    from(table: string) {
      const b = {
        _gt: undefined as unknown,
        _limit: undefined as number | undefined,
        select() {
          return b;
        },
        in() {
          return b;
        },
        order() {
          return b;
        },
        gt(_c: string, v: unknown) {
          b._gt = v;
          return b;
        },
        limit(n: number) {
          b._limit = n;
          return b;
        },
        upsert(rows: Row[]) {
          capture.upserts.push({ table, rows });
          return Promise.resolve({ error: null });
        },
        delete() {
          return {
            in(_c: string, ids: unknown[]) {
              capture.deletes.push({ table, ids });
              return Promise.resolve({ error: null });
            },
          };
        },
        then(
          resolve: (v: { data: Row[]; error: null }) => unknown,
          reject?: (e: unknown) => unknown,
        ) {
          let rows = data[table] ?? [];
          if (b._gt !== undefined)
            rows = rows.filter((r) => String(r.id) > String(b._gt));
          if (b._limit !== undefined) rows = rows.slice(0, b._limit);
          return Promise.resolve({ data: rows, error: null }).then(
            resolve,
            reject,
          );
        },
      };
      return b;
    },
  };
}

const svcDeps = (data: Record<string, Row[]>, capture: Capture) =>
  ({ svc: makeSvc(data, capture) }) as unknown as { svc: never };

describe("toVectorLiteral", () => {
  it("serializes to pgvector text form", async () => {
    const { toVectorLiteral } = await import("./index-actions");
    expect(toVectorLiteral([0.1, 0.2, 0.3])).toBe("[0.1,0.2,0.3]");
    expect(toVectorLiteral([])).toBe("[]");
  });
});

describe("embedTexts", () => {
  it("meters an input-only call and returns the vectors + model", async () => {
    const client: EmbeddingClient = {
      embed: vi.fn(async (texts: string[]) => ({
        vectors: texts.map(() => [1, 2, 3]),
        inputTokens: 42,
        model: "text-embedding-3-small",
      })),
    };
    const { embedTexts } = await import("./index-actions");

    const out = await embedTexts(
      { orgId: "org-1", userId: "u-1", feature: "semantic_index" },
      client,
      ["a", "b"],
    );

    expect(client.embed).toHaveBeenCalledWith(["a", "b"]);
    expect(out).toEqual({
      vectors: [
        [1, 2, 3],
        [1, 2, 3],
      ],
      model: "text-embedding-3-small",
    });
    // metered exactly once, input-only (outputTokens 0)
    expect(runEmbedding).toHaveBeenCalledTimes(1);
    const [meterArgs] = runEmbedding.mock.calls[0];
    expect(meterArgs).toEqual({
      orgId: "org-1",
      userId: "u-1",
      feature: "semantic_index",
    });
    const fn = runEmbedding.mock.calls[0][1] as () => Promise<{
      usage: { inputTokens: number; outputTokens: number };
    }>;
    const metered = await fn();
    expect(metered.usage).toEqual({ inputTokens: 42, outputTokens: 0 });
  });
});

function fakeClient() {
  return {
    embed: vi.fn(async (texts: string[]) => ({
      vectors: texts.map((_, i) => [i, i, i]),
      inputTokens: texts.length,
      model: EMBEDDING_MODEL,
    })),
  } satisfies EmbeddingClient;
}

describe("embedBatch", () => {
  it("embeds changed items, skips hash+model matches, meters once per org, clears the queue", async () => {
    // item-1: no existing embedding → must embed. item-2: stored hash matches the
    // freshly-built doc → skip (no model call), queue still cleared.
    const capture: Capture = { upserts: [], deletes: [] };
    const { embedBatch } = await import("./index-actions");
    const { buildItemDocument, contentHash } = await import("./document");
    const item2Doc = buildItemDocument({
      name: "Two",
      textCells: [],
      comments: [],
      statusLabels: [],
    });
    const data: Record<string, Row[]> = {
      items: [
        { id: "item-1", name: "One", org_id: "org-1", board_id: "b1" },
        { id: "item-2", name: "Two", org_id: "org-1", board_id: "b1" },
      ],
      cell_values: [],
      item_updates: [],
      item_embeddings: [
        {
          item_id: "item-2",
          content_hash: contentHash(item2Doc),
          model: EMBEDDING_MODEL,
        },
      ],
      columns: [],
      item_embed_queue: [],
    };
    const client = fakeClient();
    const res = await embedBatch(["item-1", "item-2"], {
      client,
      userId: null,
      ...svcDeps(data, capture),
    });

    // Only the changed item was embedded — one embed call, one doc.
    expect(client.embed).toHaveBeenCalledTimes(1);
    expect(client.embed).toHaveBeenCalledWith([
      buildItemDocument({
        name: "One",
        textCells: [],
        comments: [],
        statusLabels: [],
      }),
    ]);
    expect(runEmbedding).toHaveBeenCalledTimes(1); // metered once for the org
    expect(res).toEqual({ embedded: 1, skipped: 1, notIndexed: 0 });
    // Upserted item-1's embedding; queue cleared for both the embedded + skipped id.
    expect(capture.upserts[0].rows.map((r) => r.item_id)).toEqual(["item-1"]);
    const clearedIds = capture.deletes.flatMap((d) => d.ids as string[]);
    expect(clearedIds).toContain("item-1");
    expect(clearedIds).toContain("item-2");
  });

  it("composes text cells + status/dropdown labels into the embedded doc (labels, not ids)", async () => {
    const capture: Capture = { upserts: [], deletes: [] };
    const { embedBatch } = await import("./index-actions");
    const data: Record<string, Row[]> = {
      items: [
        { id: "i1", name: "Onboard Dana", org_id: "org-1", board_id: "b1" },
      ],
      cell_values: [
        { item_id: "i1", column_id: "c-text", value: { text: "Send laptop" } },
        { item_id: "i1", column_id: "c-status", value: { optionId: "o1" } },
        {
          item_id: "i1",
          column_id: "c-drop",
          value: { optionIds: ["o2", "o3"] },
        },
      ],
      columns: [
        { id: "c-text", kind: "text", settings: {} },
        {
          id: "c-status",
          kind: "status",
          settings: { options: [{ id: "o1", label: "To do" }] },
        },
        {
          id: "c-drop",
          kind: "dropdown",
          settings: {
            options: [
              { id: "o2", label: "Design" },
              { id: "o3", label: "Urgent" },
            ],
          },
        },
      ],
      item_updates: [
        { item_id: "i1", body_text: "welcome!", created_at: "2026-01-01" },
      ],
      item_embeddings: [],
      item_embed_queue: [],
    };
    const client = fakeClient();
    await embedBatch(["i1"], {
      client,
      userId: null,
      ...svcDeps(data, capture),
    });
    const doc = (client.embed.mock.calls[0][0] as string[])[0];
    expect(doc).toContain("Onboard Dana");
    expect(doc).toContain("Send laptop");
    expect(doc).toContain("welcome!");
    expect(doc).toContain("To do");
    expect(doc).toContain("Design");
    expect(doc).toContain("Urgent");
    expect(doc).not.toContain("o1"); // option IDs never leak into the doc
  });

  it("leaves queue rows for an AI-off org (not indexed), never throwing", async () => {
    runEmbedding.mockRejectedValueOnce(new AiDisabledError());
    const capture: Capture = { upserts: [], deletes: [] };
    const { embedBatch } = await import("./index-actions");
    const data: Record<string, Row[]> = {
      items: [{ id: "i1", name: "One", org_id: "org-off", board_id: "b1" }],
      cell_values: [],
      columns: [],
      item_updates: [],
      item_embeddings: [],
      item_embed_queue: [],
    };
    const res = await embedBatch(["i1"], {
      client: fakeClient(),
      userId: null,
      ...svcDeps(data, capture),
    });
    expect(res).toEqual({ embedded: 0, skipped: 0, notIndexed: 1 });
    expect(capture.upserts).toEqual([]);
    expect(capture.deletes).toEqual([]); // queue untouched → retried when AI is re-enabled
  });

  it("no-ops on an empty batch", async () => {
    const capture: Capture = { upserts: [], deletes: [] };
    const { embedBatch } = await import("./index-actions");
    const res = await embedBatch([], {
      client: fakeClient(),
      userId: null,
      ...svcDeps({}, capture),
    });
    expect(res).toEqual({ embedded: 0, skipped: 0, notIndexed: 0 });
  });
});

describe("embedBackfill", () => {
  it("pages items by id and returns a resumable cursor", async () => {
    const capture: Capture = { upserts: [], deletes: [] };
    const { embedBackfill } = await import("./index-actions");
    const data: Record<string, Row[]> = {
      items: [
        { id: "a", name: "A", org_id: "org-1", board_id: "b1" },
        { id: "b", name: "B", org_id: "org-1", board_id: "b1" },
        { id: "c", name: "C", org_id: "org-1", board_id: "b1" },
      ],
      cell_values: [],
      columns: [],
      item_updates: [],
      item_embeddings: [],
      item_embed_queue: [],
    };
    const first = await embedBackfill(
      { limit: 2 },
      { client: fakeClient(), userId: null, ...svcDeps(data, capture) },
    );
    expect(first.processed).toBe(2);
    expect(first.nextCursor).toBe("b"); // full page → resume after last id
    const second = await embedBackfill(
      { cursor: "b", limit: 2 },
      { client: fakeClient(), userId: null, ...svcDeps(data, capture) },
    );
    expect(second.processed).toBe(1); // only "c" remains
    expect(second.nextCursor).toBeNull(); // short page → done
  });
});
