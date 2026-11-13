import type { ToolDescriptor } from "@/lib/mcp/tools/descriptor";

/**
 * True when the tool takes an `orgId` input, so it can act in an org. Shared
 * by staging (which pins the call to the active org) and Apply (which runs it
 * only in that same org), so the two cannot disagree on which tools count.
 */
export function takesOrgId(d: Pick<ToolDescriptor, "inputSchema">): boolean {
  return Object.prototype.hasOwnProperty.call(d.inputSchema, "orgId");
}
