import { ALL_TOOL_DESCRIPTORS } from "@/lib/mcp/tools/catalog";
import { capabilityFor, type ToolDescriptor } from "@/lib/mcp/tools/descriptor";

/** Every catalog tool the assistant may call. */
export function assistantDescriptors(): readonly ToolDescriptor[] {
  return ALL_TOOL_DESCRIPTORS.filter((d) => !d.agentExcluded);
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
