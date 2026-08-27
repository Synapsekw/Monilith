import { z } from "zod";
import type { ToolDescriptor } from "@/lib/mcp/tools/descriptor";
import type { ToolResult } from "@/lib/mcp/tools/shared";
import {
  memoryKeySchema,
  memoryValueSchema,
} from "@/lib/validations/agent-memory";
import { MEMORY_MAX_NOTES } from "@/lib/agents/document-budget";
import { agentRemember, agentForget, listMemoryKeys } from "./memory-db";

function ok(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}
function err(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

const rememberShape = { key: memoryKeySchema, value: memoryValueSchema };
const forgetShape = { key: memoryKeySchema };

/**
 * The two memory tools, built PER RUN.
 *
 * WHY A FACTORY AND NOT A MODULE CONSTANT like `createFileDescriptor`:
 * `ToolInvokeContext` is `{ getClient, actorId }` and carries neither an agent
 * id nor a run id. `remember` needs both — WHICH note store, and WHICH run
 * authored the note. Taking them from MODEL INPUT would be a cross-agent write
 * primitive: the model could name any agent id it liked. Closing over
 * server-known values is the only shape that cannot be addressed by the model,
 * and it is why both handlers ignore any `userAgentId`/`runId` the model puts
 * in its input.
 *
 * The returned array must be passed to `buildAgentRuntime`'s `extra` (which
 * hands the SAME array to both `buildAgentTools` and `makeGrantGate`) — never
 * to one of them alone, or the tools would be offered and then denied "Unknown
 * tool." on every call.
 *
 * `scope: "none"` is correct: memory addresses no board, so `board_scope` does
 * not narrow it. RLS remains the boundary, as `descriptor.ts` documents for
 * every `"none"` tool.
 */
export function makeMemoryDescriptors(args: {
  userAgentId: string;
  /**
   * Null on the proposal-approval path: the note is being written by the
   * OWNER'S APPROVAL, not by a run. Recording the original run id there would
   * claim a run wrote something it was actually denied.
   */
  runId: string | null;
}): ToolDescriptor[] {
  const remember: ToolDescriptor = {
    name: "remember",
    title: "Remember",
    description:
      "Keep one short fact you have worked out, so you still know it on your " +
      "next run. `key` is a short lowercase slug that identifies the fact " +
      "(letters, numbers and hyphens). `value` is ONE line of at most 500 " +
      "characters. Writing to a key you already have REPLACES it — if a note " +
      "about this already exists, reuse its exact key rather than inventing a " +
      `similar one. You may keep at most ${MEMORY_MAX_NOTES} notes. Your notes ` +
      "are listed at the top of your instructions each run, so read them there " +
      "before writing. A note you write now takes effect on your NEXT run, not " +
      "this one. Notes your owner wrote cannot be changed.",
    inputSchema: rememberShape,
    capability: "memory.write",
    scope: "none",
    invoke: async (ctx, raw): Promise<ToolResult> => {
      // PARSED, not cast. Both transports validate against `inputSchema`
      // first, but this handler is the one the MODEL reaches most directly and
      // the refusal message it returns is the model's only route back to a
      // valid call, so it re-parses to produce that message itself.
      const parsed = z.object(rememberShape).safeParse(raw);
      if (!parsed.success)
        return err(parsed.error.issues[0]?.message ?? "Invalid note.");

      // ONCE per invocation: `getClient()` charges the MCP rate limit and
      // rotates the OAuth bridge secret (shared.ts). The cap path below reuses
      // this client rather than resolving a second one.
      const client = await ctx.getClient();
      const status = await agentRemember(client, {
        userAgentId: args.userAgentId,
        key: parsed.data.key,
        value: parsed.data.value,
        runId: args.runId,
      });

      switch (status) {
        case "written":
          return ok(
            `Remembered as "${parsed.data.key}". You will see it at the start ` +
              "of your next run.",
          );
        case "replaced":
          return ok(
            `Replaced your earlier note "${parsed.data.key}". You will see the ` +
              "new version at the start of your next run.",
          );
        case "refused_owner_note":
          return err(
            `"${parsed.data.key}" was written by your owner, so you cannot ` +
              "change it. Use a different key, or leave it alone.",
          );
        case "refused_cap": {
          // NAME THE KEYS. Without them the model has nothing to choose
          // between and will re-propose the same refused call until it runs
          // out of steps.
          const keys = await listMemoryKeys(client, args.userAgentId);
          return err(
            `You already have ${MEMORY_MAX_NOTES} notes, the maximum. ` +
              "Replace one instead by writing to its key, or use `forget` to " +
              `remove one. Your keys: ${keys.join(", ")}`,
          );
        }
      }
    },
  };

  const forget: ToolDescriptor = {
    name: "forget",
    title: "Forget",
    description:
      "Delete one of your own notes by its key, to make room or because it is " +
      "no longer true. This only removes YOUR note; it never touches a board, " +
      "a document, or a note your owner wrote.",
    inputSchema: forgetShape,
    capability: "memory.write",
    scope: "none",
    invoke: async (ctx, raw): Promise<ToolResult> => {
      const parsed = z.object(forgetShape).safeParse(raw);
      if (!parsed.success)
        return err(parsed.error.issues[0]?.message ?? "Invalid key.");
      const client = await ctx.getClient();
      const gone = await agentForget(client, args.userAgentId, parsed.data.key);
      return gone
        ? ok(`Forgot "${parsed.data.key}".`)
        : err(`There is no note with the key "${parsed.data.key}".`);
    },
  };

  return [remember, forget];
}
