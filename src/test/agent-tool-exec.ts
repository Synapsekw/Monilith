import type { ToolSet } from "ai";

/**
 * Call one tool out of an AI SDK `ToolSet` the way the AI SDK's loop
 * would.
 *
 * Exists because `ToolSet` types `execute` as `(input, options) => …` with
 * `options` REQUIRED (`toolCallId`, `messages`, `context`), so a bare
 * `tools.list_items.execute({ boardId })` does not typecheck. The tools under
 * test ignore `options` entirely — they read only the input and the client
 * captured at build time — so a minimal stub is faithful.
 *
 * Shared by the assistant tool suites so they exercise the SAME entry point the
 * model does.
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
