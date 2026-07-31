import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { runEmbedding } from "@/lib/ai/gateway";
import { AiDisabledError, AiQuotaExceededError } from "@/lib/ai/errors";
import type { Database } from "@/types/database.types";
import {
  createEmbeddingClient,
  EMBEDDING_MODEL,
  type EmbeddingClient,
} from "./client";
import {
  buildItemDocument,
  contentHash,
  type ItemDocumentParts,
} from "./document";

/** The two metered embedding features (spec §5). */
export type EmbeddingFeature = "semantic_index" | "semantic_query";

/**
 * A row ready to upsert into public.item_embeddings. `embedding` is the pgvector
 * text literal (e.g. "[0.1,0.2,…]") — see toVectorLiteral.
 */
export type ItemEmbeddingUpsert =
  Database["public"]["Tables"]["item_embeddings"]["Insert"];

/**
 * Serialize a numeric vector to pgvector's text input form. PostgREST passes RPC
 * args / row values as JSON, and pgvector accepts a text literal it casts to
 * `vector` — so both match_items(p_query_embedding) and item_embeddings inserts
 * take this string form.
 */
export function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(",")}]`;
}

/**
 * Meter one embedding call through the gateway (input-only) and return the raw
 * vectors + model. Wraps runEmbedding so entitlement gating + ai_usage metering
 * are never bypassed; the fixed platform key lives inside the EmbeddingClient.
 */
export async function embedTexts(
  // userId is nullable: the sweep/backfill runs from cron with no user session.
  args: { orgId: string; userId: string | null; feature: EmbeddingFeature },
  client: EmbeddingClient,
  texts: string[],
): Promise<{ vectors: number[][]; model: string }> {
  return runEmbedding(args, async () => {
    const { vectors, inputTokens, model } = await client.embed(texts);
    return {
      result: { vectors, model },
      usage: { inputTokens, outputTokens: 0 },
      model,
    };
  });
}

/**
 * Batch upsert embeddings (keyed by item_id). Writes with the service role — the
 * table is default-deny for clients (writes only through the service embed
 * endpoint). No-op on an empty batch.
 */
async function upsertItemEmbeddings(
  rows: ItemEmbeddingUpsert[],
  svc: SupabaseClient<Database> = createServiceClient(),
): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await svc
    .from("item_embeddings")
    .upsert(rows, { onConflict: "item_id" });
  if (error) throw error;
}

// ── Async embedding pipeline (spec §4.4) ────────────────────────────────────
// The sweep cron and the backfill endpoint both call embedBatch/embedBackfill.
// All model work is here, OUT of the hot write path (a trigger only enqueues).

/** Per-sweep and per-backfill-page item cap — bounds embedding cost + input window. */
const BACKFILL_PAGE = 50;
const MAX_BACKFILL_PAGE = 200;

/** Shared cell-value shapes (see board-snapshot.ts): text vs status/dropdown option refs. */
type CellValue = { text?: string; optionId?: string; optionIds?: string[] };
type ColumnMeta = { kind: string; options: Map<string, string> }; // optionId → label

export type EmbedDeps = {
  svc?: SupabaseClient<Database>;
  client?: EmbeddingClient;
  /** Attribution for metering; null for the system sweep/backfill (no session). */
  userId?: string | null;
};

export type EmbedBatchResult = {
  embedded: number; // items (re)embedded + upserted
  skipped: number; // hash+model already current — no model call, queue cleared
  notIndexed: number; // org is AI-off / over quota — left queued to retry later
};

type ItemRow = { id: string; name: string; org_id: string; board_id: string };

function pushInto<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const a = m.get(k);
  if (a) a.push(v);
  else m.set(k, [v]);
}

/** Resolve a status/dropdown cell's option ids to their LABELS (never ids). */
function optionLabels(meta: ColumnMeta, value: CellValue): string[] {
  const ids =
    meta.kind === "status"
      ? value.optionId
        ? [value.optionId]
        : []
      : (value.optionIds ?? []);
  return ids.map((id) => meta.options.get(id)).filter((l): l is string => !!l);
}

/**
 * Embed a bounded batch of items (by id). For each item: build the composite
 * document, compute its content hash, **skip if the stored hash + model already
 * match** (re-embedding bound), else meter one embed call per org through
 * `runEmbedding` (feature `semantic_index`, entitlement-gated — AI-off/over-quota
 * orgs are left queued, never indexed), upsert `item_embeddings`, and clear the
 * queue rows. Never touches the hot write path. Idempotent — re-running skips
 * anything already current (this is what makes the sweep + backfill safe to retry).
 */
export async function embedBatch(
  itemIds: string[],
  deps: EmbedDeps = {},
): Promise<EmbedBatchResult> {
  const svc = deps.svc ?? createServiceClient();
  const client = deps.client ?? createEmbeddingClient();
  const userId = deps.userId ?? null;
  const ids = [...new Set(itemIds)].filter(Boolean);
  const result: EmbedBatchResult = { embedded: 0, skipped: 0, notIndexed: 0 };
  if (ids.length === 0) return result;

  const [itemsRes, cellsRes, updatesRes, existingRes] = await Promise.all([
    svc.from("items").select("id, name, org_id, board_id").in("id", ids),
    svc
      .from("cell_values")
      .select("item_id, column_id, value")
      .in("item_id", ids),
    svc
      .from("item_updates")
      .select("item_id, body_text, created_at")
      .in("item_id", ids)
      .order("created_at", { ascending: true }),
    svc
      .from("item_embeddings")
      .select("item_id, content_hash, model")
      .in("item_id", ids),
  ]);
  const items = (itemsRes.data ?? []) as ItemRow[];
  if (items.length === 0) return result;

  // Column metadata (kind + option-label map) for the involved boards.
  const boardIds = [...new Set(items.map((i) => i.board_id))];
  const columnsRes = await svc
    .from("columns")
    .select("id, kind, settings")
    .in("board_id", boardIds);
  const colMeta = new Map<string, ColumnMeta>();
  for (const c of columnsRes.data ?? []) {
    const options = new Map<string, string>();
    const opts =
      (c.settings as { options?: { id?: string; label?: string }[] } | null)
        ?.options ?? [];
    for (const o of opts) if (o?.id && o?.label) options.set(o.id, o.label);
    colMeta.set(c.id, { kind: c.kind, options });
  }

  const cellsByItem = new Map<
    string,
    { column_id: string; value: CellValue }[]
  >();
  for (const cv of cellsRes.data ?? [])
    pushInto(cellsByItem, cv.item_id, {
      column_id: cv.column_id,
      value: (cv.value ?? {}) as CellValue,
    });
  const commentsByItem = new Map<string, string[]>();
  for (const u of updatesRes.data ?? [])
    pushInto(commentsByItem, u.item_id, u.body_text);
  const existingByItem = new Map<
    string,
    { content_hash: string; model: string }
  >();
  for (const e of existingRes.data ?? [])
    existingByItem.set(e.item_id, {
      content_hash: e.content_hash,
      model: e.model,
    });

  // Build each item's doc + hash; partition into skip (already current) vs
  // embed (grouped by org so metering + entitlement gate are per-org).
  type Prepared = { item: ItemRow; doc: string; hash: string };
  const toEmbedByOrg = new Map<string, Prepared[]>();
  const skippedIds: string[] = [];
  for (const item of items) {
    const textCells: string[] = [];
    const statusLabels: string[] = [];
    for (const { column_id, value } of cellsByItem.get(item.id) ?? []) {
      const meta = colMeta.get(column_id);
      if (!meta) continue;
      if (meta.kind === "text") {
        if (value.text) textCells.push(value.text);
      } else if (meta.kind === "status" || meta.kind === "dropdown") {
        statusLabels.push(...optionLabels(meta, value));
      }
    }
    const parts: ItemDocumentParts = {
      name: item.name,
      textCells,
      comments: commentsByItem.get(item.id) ?? [],
      statusLabels,
    };
    const doc = buildItemDocument(parts);
    const hash = contentHash(doc);
    const prev = existingByItem.get(item.id);
    if (prev && prev.content_hash === hash && prev.model === EMBEDDING_MODEL) {
      skippedIds.push(item.id);
      continue;
    }
    pushInto(toEmbedByOrg, item.org_id, { item, doc, hash });
  }

  // Unchanged items: clear the stale queue mark, no model call.
  if (skippedIds.length > 0) {
    await svc.from("item_embed_queue").delete().in("item_id", skippedIds);
    result.skipped += skippedIds.length;
  }

  for (const [orgId, prepared] of toEmbedByOrg) {
    let vectors: number[][];
    let model: string;
    try {
      ({ vectors, model } = await embedTexts(
        { orgId, userId, feature: "semantic_index" },
        client,
        prepared.map((p) => p.doc),
      ));
    } catch (e) {
      // AI-off / over-quota orgs are not indexed — leave their queue rows so the
      // backlog indexes if the org later enables AI / the quota resets.
      if (e instanceof AiDisabledError || e instanceof AiQuotaExceededError) {
        result.notIndexed += prepared.length;
        continue;
      }
      throw e;
    }
    const rows: ItemEmbeddingUpsert[] = prepared.map((p, i) => ({
      item_id: p.item.id,
      org_id: orgId,
      board_id: p.item.board_id,
      embedding: toVectorLiteral(vectors[i]),
      content_hash: p.hash,
      model,
    }));
    await upsertItemEmbeddings(rows, svc);
    await svc
      .from("item_embed_queue")
      .delete()
      .in(
        "item_id",
        prepared.map((p) => p.item.id),
      );
    result.embedded += prepared.length;
  }
  return result;
}

/**
 * Resumable, idempotent backfill of existing items (spec §4.4). Pages `items` by
 * `id` (a stable cursor over the PK) in capped batches through the same
 * `embedBatch` path — so a re-run skips anything already current (hash+model).
 * Returns the page result plus `nextCursor` (the last id when the page was full,
 * else null = done) so an admin/script can drive it to completion.
 */
export async function embedBackfill(
  opts: { cursor?: string | null; limit?: number },
  deps: EmbedDeps = {},
): Promise<
  EmbedBatchResult & { processed: number; nextCursor: string | null }
> {
  const svc = deps.svc ?? createServiceClient();
  const limit = Math.min(
    Math.max(opts.limit ?? BACKFILL_PAGE, 1),
    MAX_BACKFILL_PAGE,
  );
  let q = svc.from("items").select("id");
  if (opts.cursor) q = q.gt("id", opts.cursor);
  const { data, error } = await q.order("id", { ascending: true }).limit(limit);
  if (error) throw error;
  const ids = (data ?? []).map((r) => r.id);
  const batch = await embedBatch(ids, deps);
  return {
    ...batch,
    processed: ids.length,
    nextCursor: ids.length === limit ? (ids[ids.length - 1] ?? null) : null,
  };
}
