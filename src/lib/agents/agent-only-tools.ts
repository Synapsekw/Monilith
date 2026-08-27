import type { ToolDescriptor } from "@/lib/mcp/tools/descriptor";
import { createAutomationDescriptor } from "./create-automation-tool";
import { createFileDescriptor } from "./create-file";
import { createPdfDescriptor } from "./create-pdf";

/**
 * Tools an agent may call that the MCP server deliberately does NOT serve.
 *
 * They are kept out of `ALL_TOOL_DESCRIPTORS` rather than marked
 * `agentExcluded` (which is the opposite exclusion) because the MCP catalog is
 * a contract with third-party clients: `create_file` only makes sense for a
 * caller that emits a document as text in the same turn, `create_automation`
 * is a standing, org-visible side effect that belongs behind the agent's
 * capability grant rather than a generic bearer token, and `create_pdf` renders
 * a document the CALLER authored in the same turn — a remote MCP client that
 * already holds bytes wants `attach_file`, not a Chromium launch.
 *
 * Passed as `buildAgentTools`/`makeGrantGate`'s `extra` — the SAME array to
 * both, which is what keeps the offered tool set and the classification the
 * gate applies from disagreeing (`tool-descriptors.ts`). Names here must not
 * collide with the catalog; `descriptorsFor` throws if they do.
 */
export const AGENT_ONLY_DESCRIPTORS: readonly ToolDescriptor[] = [
  createFileDescriptor,
  createAutomationDescriptor,
  createPdfDescriptor,
];
