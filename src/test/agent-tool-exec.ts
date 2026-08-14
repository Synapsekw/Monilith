import type { ToolSet } from "ai";

/**
 * Call one tool out of a `buildAgentTools()` set the way the AI SDK's loop
 * would.
 *
 * Exists because `ToolSet` types `execute` as `(input, options) => …` with
 * `options` REQUIRED (`toolCallId`, `messages`, `context`), so a bare
 * `tools.list_items.execute({ boardId })` does not typecheck. The agent tools
 * ignore `options` entirely — the board-scope guard reads only the input and the
 * owner client captured at build time — so a minimal stub is faithful.
 *
 * Shared by `src/lib/agents/tools.test.ts` and the RLS integration suite so the
 * two exercise the SAME entry point the model does.
 */
export async function executeAgentTool(
  tools: ToolSet,
  name: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  const t = tools[name];
  if (!t?.execute) throw new Error(`No executable agent tool named ${name}.`);
  return await t.execute(input, {
    toolCallId: `test-${name}`,
    messages: [],
    context: undefined,
  });
}
