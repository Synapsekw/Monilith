/**
 * The single declaration of the agent-capability vocabulary. Deliberately its
 * own tiny module, free of `server-only`, so both the server-side MCP
 * descriptor layer (`src/lib/mcp/tools/descriptor.ts`) and the client-side
 * agent editor import it without either depending on the other.
 */
export const AGENT_CAPABILITIES = [
  "board.write",
  "files.write",
  "automation.create",
  "time.log",
  "memory.write",
] as const;

export type AgentCapability = (typeof AGENT_CAPABILITIES)[number];
