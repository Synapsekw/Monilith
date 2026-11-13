/**
 * The capability vocabulary every catalog descriptor's `capability` field
 * uses. A null capability is a read; anything else is a write, and
 * `board.destroy` is destructive (see `src/lib/assistant/catalog.ts`).
 * Free of `server-only` so client code may import it.
 */
export const AGENT_CAPABILITIES = [
  "board.write",
  "files.write",
  "automation.create",
  "time.log",
  "memory.write",
  "agent.delegate",
  "board.structure",
  "board.destroy",
] as const;

export type AgentCapability = (typeof AGENT_CAPABILITIES)[number];
