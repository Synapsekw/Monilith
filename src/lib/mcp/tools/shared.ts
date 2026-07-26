import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { upsertCellCore } from "@/lib/boards/actions/cell-core";

/**
 * Resolves the per-request, RLS-respecting Supabase client for the authenticated
 * MCP connection. Produced once per tool call in `register.ts`, which closes over
 * `getRequestClient` (`src/lib/mcp/context.ts`).
 *
 * Call it exactly ONCE per handler invocation: each call charges the MCP rate
 * limit and rotates the OAuth bridge secret (`context.ts:39,50-51`). Never call
 * it inside a per-field loop.
 */
export type GetClient = () => Promise<SupabaseClient<Database>>;

/** One field write in `create_item` / `update_item`: a column id plus its raw value. */
export const fieldInput = z.object({
  columnId: z.string().uuid(),
  value: z.record(z.string(), z.unknown()),
});

export type FieldInput = z.infer<typeof fieldInput>;

/**
 * Writes one cell value on behalf of the authenticated MCP user. Returns `null`
 * on success, or a human-readable message the caller surfaces to the agent in
 * `fieldErrors`.
 *
 * Delegates to `upsertCellCore` — the same function the `upsertCell` Server
 * Action calls — so the `people` assignment fan-out happens on this path by
 * construction. (Before 2026-07-26 this re-implemented the guards and silently
 * dropped the fan-out: gotcha-60.) `upsertCell` itself still cannot be called
 * here: it is a `"use server"` action bound to `next/headers` cookies, and an
 * MCP request carries only an OAuth bearer token resolved to a bridged client.
 *
 * `actorId` is injected rather than read from `supabase.auth`: it is already
 * known (`mcpActorId(auth)`), and an auth lookup on a bridged client would cost
 * a GoTrue round-trip per write while depending on supabase-js's
 * custom-Authorization-header internals. See spec §3.1
 * (`docs/superpowers/specs/2026-07-26-mcp-assigned-notification-design.md`).
 */
export async function writeCellValue(
  supabase: SupabaseClient<Database>,
  itemId: string,
  field: FieldInput,
  actorId: string,
): Promise<string | null> {
  const res = await upsertCellCore(
    supabase,
    { itemId, columnId: field.columnId, value: field.value },
    actorId,
  );
  return res.ok ? null : res.error;
}
