import { ALL_TOOL_DESCRIPTORS } from "@/lib/mcp/tools/catalog";
import { capabilityFor, type ToolDescriptor } from "@/lib/mcp/tools/descriptor";

/**
 * Catalog tools the assistant does not get, by name. `list_organizations`
 * stays in the MCP catalog (a user-level connection spans orgs), but the
 * assistant works inside the ONE active org, so offering it only invites the
 * model to reach into another.
 */
const NOT_FOR_ASSISTANT: ReadonlySet<string> = new Set(["list_organizations"]);

/** Every catalog tool the assistant may call. */
export function assistantDescriptors(): readonly ToolDescriptor[] {
  return ALL_TOOL_DESCRIPTORS.filter(
    (d) => !d.agentExcluded && !NOT_FOR_ASSISTANT.has(d.name),
  );
}

export function findDescriptor(name: string): ToolDescriptor | undefined {
  return assistantDescriptors().find((d) => d.name === name);
}

export type CallEffect = "read" | "write" | "destructive";

/**
 * What one call does. `capabilityFor` is the single reader of a descriptor's
 * capability and fails closed for an unknown action, so an action nobody
 * declared is never treated as a read.
 */
export function effectOf(
  d: ToolDescriptor,
  input: Record<string, unknown>,
): CallEffect {
  const capability = capabilityFor(d, input);
  if (capability === null) return "read";
  return capability === "board.destroy" ? "destructive" : "write";
}
