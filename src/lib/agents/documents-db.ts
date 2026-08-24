import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { estimateTokens } from "@/lib/agents/document-budget";
import type { SourceFormat } from "@/lib/documents/extract-text";

type Client = SupabaseClient<Database>;

/** Metadata only. First paint lists the library WITHOUT bodies: 30 documents
 *  must not ship 30 documents of text to render 30 titles. */
export type AgentDocumentRow = {
  id: string;
  title: string;
  tokenEstimate: number;
  sourceFormat: SourceFormat;
  sourceFileName: string | null;
  updatedAt: string;
};

export type AgentDocumentFull = AgentDocumentRow & { body: string };

const META_COLUMNS =
  "id, title, token_estimate, source_format, source_file_name, updated_at";

/** Hard ceiling on a personal library page. Bounded read over the
 *  (owner_id, updated_at desc) index — never an unbounded select. */
export const LIBRARY_PAGE_SIZE = 100;

function toRow(r: {
  id: string;
  title: string;
  token_estimate: number;
  source_format: string;
  source_file_name: string | null;
  updated_at: string;
}): AgentDocumentRow {
  return {
    id: r.id,
    title: r.title,
    tokenEstimate: r.token_estimate,
    sourceFormat: r.source_format as SourceFormat,
    sourceFileName: r.source_file_name,
    updatedAt: r.updated_at,
  };
}

export async function listDocumentsForOwner(
  client: Client,
  ownerId: string,
  limit: number = LIBRARY_PAGE_SIZE,
): Promise<AgentDocumentRow[]> {
  const { data, error } = await client
    .from("agent_documents")
    .select(META_COLUMNS)
    .eq("owner_id", ownerId)
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`listDocumentsForOwner: ${error.message}`);
  return (data ?? []).map(toRow);
}

export async function getDocument(
  client: Client,
  id: string,
): Promise<AgentDocumentFull | null> {
  const { data, error } = await client
    .from("agent_documents")
    .select(`${META_COLUMNS}, body`)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`getDocument: ${error.message}`);
  return data ? { ...toRow(data), body: data.body } : null;
}

/**
 * THE run-loop read helper. Task 6 imports this rather than writing its own —
 * one query shape means the injection order and the meter can never disagree
 * about which documents an agent has.
 *
 * Ordered by `position` then `created_at` (on the embedded `agent_documents`
 * table) so the prompt is byte-stable across runs, which is what makes the
 * Anthropic cache breakpoint worth having.
 */
export async function listDocumentsForAgent(
  client: Client,
  userAgentId: string,
): Promise<
  Array<{ id: string; title: string; body: string; tokenEstimate: number }>
> {
  const { data, error } = await client
    .from("user_agent_documents")
    .select(
      "position, agent_documents!inner(id, title, body, token_estimate, created_at)",
    )
    .eq("user_agent_id", userAgentId)
    .order("position", { ascending: true })
    .order("created_at", {
      ascending: true,
      referencedTable: "agent_documents",
    });
  if (error) throw new Error(`listDocumentsForAgent: ${error.message}`);
  return (data ?? []).map((r) => {
    const d = r.agent_documents as unknown as {
      id: string;
      title: string;
      body: string;
      token_estimate: number;
    };
    return {
      id: d.id,
      title: d.title,
      body: d.body,
      tokenEstimate: d.token_estimate,
    };
  });
}

/**
 * Every user_agent's attached document ids, for one owner, keyed by agent id.
 * One query for the whole roster (e.g. the settings page listing every
 * agent's attachments) instead of N queries — join filtered through
 * `user_agents!inner(owner_id)` because the join table itself carries no
 * owner column.
 */
export async function listAttachmentsByAgent(
  client: Client,
  ownerId: string,
): Promise<Record<string, string[]>> {
  const { data, error } = await client
    .from("user_agent_documents")
    .select("user_agent_id, document_id, user_agents!inner(owner_id)")
    .eq("user_agents.owner_id", ownerId)
    .order("position", { ascending: true });
  if (error) throw new Error(`listAttachmentsByAgent: ${error.message}`);
  const out: Record<string, string[]> = {};
  for (const r of data ?? []) {
    (out[r.user_agent_id] ??= []).push(r.document_id);
  }
  return out;
}

export async function insertDocument(
  client: Client,
  args: {
    orgId: string;
    ownerId: string;
    title: string;
    body: string;
    sourceFormat: SourceFormat;
    sourceFileName: string | null;
  },
): Promise<{ id: string }> {
  const { data, error } = await client
    .from("agent_documents")
    .insert({
      org_id: args.orgId,
      owner_id: args.ownerId,
      title: args.title,
      body: args.body,
      // SERVER-computed, always. A client-supplied estimate would let the
      // budget meter be lied to, which is the whole guarantee this feature has.
      token_estimate: estimateTokens(args.body),
      source_format: args.sourceFormat,
      source_file_name: args.sourceFileName,
    })
    .select("id")
    .single();
  if (error) throw new Error(`insertDocument: ${error.message}`);
  return { id: data.id };
}

export async function updateDocumentRow(
  client: Client,
  id: string,
  args: { title: string; body: string },
): Promise<void> {
  const { error } = await client
    .from("agent_documents")
    .update({
      title: args.title,
      body: args.body,
      // RECOMPUTED on every write, from the body that's actually being saved
      // — never trust a token_estimate the caller supplies alongside it.
      token_estimate: estimateTokens(args.body),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw new Error(`updateDocumentRow: ${error.message}`);
}

export async function deleteDocumentRow(
  client: Client,
  id: string,
): Promise<void> {
  const { error } = await client.from("agent_documents").delete().eq("id", id);
  if (error) throw new Error(`deleteDocumentRow: ${error.message}`);
}

/** Replace an agent's attachment set. Delete-then-insert, because the join
 *  table has no UPDATE grant and `position` is derived from array order. */
export async function replaceAgentDocuments(
  client: Client,
  userAgentId: string,
  documentIds: readonly string[],
): Promise<void> {
  const del = await client
    .from("user_agent_documents")
    .delete()
    .eq("user_agent_id", userAgentId);
  if (del.error)
    throw new Error(`replaceAgentDocuments (delete): ${del.error.message}`);
  if (documentIds.length === 0) return;
  const ins = await client.from("user_agent_documents").insert(
    documentIds.map((document_id, position) => ({
      user_agent_id: userAgentId,
      document_id,
      position,
    })),
  );
  if (ins.error)
    throw new Error(`replaceAgentDocuments (insert): ${ins.error.message}`);
}
