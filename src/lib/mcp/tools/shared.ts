import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { upsertCellCore } from "@/lib/boards/actions/cell-core";
import type { ActionResult } from "@/lib/actions/result";

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

/**
 * The uniform shape an MCP tool handler returns: one text block, plus an
 * optional `isError` flag. Declaring it (rather than letting TS infer a union
 * of the success and failure literals) is what lets callers and tests read
 * `result.isError` without narrowing gymnastics.
 */
export type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

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

/**
 * The one place an `ActionResult` becomes an MCP `ToolResult`.
 *
 * Every core function in this surface returns `ActionResult` — the repo's
 * canonical shape — and every descriptor needs the `{content, isError}`
 * envelope. Hand-rolling that per descriptor is how the two drift: a handler
 * that forgets `isError` reports a refusal to the model as an ordinary success
 * string, and the model then tells the owner the work is done.
 */
export function toToolResult<T>(r: ActionResult<T>): ToolResult {
  if (!r.ok) {
    return { content: [{ type: "text", text: r.error }], isError: true };
  }
  // `data: undefined` is the mutation-only shape. JSON.stringify(undefined)
  // returns undefined, not a string, so an explicit marker goes in instead.
  const text = r.data === undefined ? '{"ok":true}' : JSON.stringify(r.data);
  return { content: [{ type: "text", text }] };
}

/**
 * Validates a grouped-dispatch tool's input against its discriminated union.
 *
 * WHY THIS EXISTS RATHER THAN THE SDK DOING IT: `ToolDescriptor.inputSchema` is
 * a `z.ZodRawShape` because that is what `McpServer.registerTool` takes, and a
 * discriminated union is not a raw shape. So a dispatch tool declares a raw
 * shape whose `action` is a `z.enum` — enough for the SDK and the AI SDK to
 * reject a missing or misspelled action — and applies the real union HERE, as
 * the first statement of `invoke`.
 *
 * The failure is returned as an ordinary tool result, not thrown: the model
 * gets a message it can act on and the run continues.
 */
export function parseAction<T>(
  schema: z.ZodType<T>,
  input: Record<string, unknown>,
): { ok: true; value: T } | { ok: false; result: ToolResult } {
  const parsed = schema.safeParse(input);
  if (parsed.success) return { ok: true, value: parsed.data };
  const issue = parsed.error.issues[0];
  const where = issue?.path.length ? ` at ${issue.path.join(".")}` : "";
  return {
    ok: false,
    result: {
      content: [
        {
          type: "text",
          text: `Invalid input${where}: ${issue?.message ?? "unrecognised action"}`,
        },
      ],
      isError: true,
    },
  };
}
