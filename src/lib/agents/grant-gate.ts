import "server-only";
import type { ToolApprovalStatus } from "ai";
import type { ToolDescriptor } from "@/lib/mcp/tools/descriptor";
import type { AgentCapability } from "@/lib/agents/capabilities";
import { descriptorsFor } from "./tool-descriptors";

/** The denial the model sees for a tool the owner has not granted. Phrased for
 *  the MODEL: it is the sentence that tells it the call was recorded rather
 *  than lost, so it reports the request instead of retrying it. */
export const UNGRANTED_REASON = "Recorded for your approval.";

/** One recorded, denied write. The shape Task 7 persists as a proposal row. */
export type ProposedCall = {
  toolCallId: string;
  toolName: string;
  capability: AgentCapability;
  input: Record<string, unknown>;
};

/**
 * The capability gate, shaped as an AI SDK approval function.
 *
 * NOT annotated as `GenericToolApprovalFunction<ToolSet, …>`: that type takes
 * the CONCRETE tool set as a generic, and its `toolsContext` member makes a
 * `ToolSet`-instantiated annotation unassignable at the real call site
 * (`generateText({ tools, toolApproval })`). Declaring only the options this
 * gate actually reads keeps it assignable to every instantiation — the SDK's
 * fuller options object is a subtype of this parameter. `grant-gate.test.ts`
 * pins that assignability against a concrete tool set so this cannot rot.
 */
export type GrantGate = (options: {
  toolCall: { toolName: string; toolCallId: string; input?: unknown };
}) => Promise<ToolApprovalStatus>;

/**
 * Build the gate that decides whether one tool call may execute.
 *
 * Effective permission is `granted ∩ ceiling ∩ the owner's RLS`. This function
 * is the first two terms; RLS is unchanged and remains the real security
 * boundary, so a grant can only ever NARROW what an agent reaches, never widen
 * it.
 *
 * Ungranted tools stay VISIBLE to the model on purpose — `activeTools` is not
 * the mechanism here. A model that cannot see `attach_file` can never propose
 * it, and the proposal path (deny, record, let the owner approve later) is the
 * entire point of the design. Enforcement therefore happens HERE, by denying.
 *
 * Denials are returned as `{ type: "denied" }` rather than thrown: the SDK
 * feeds the denial back to the model and the loop CONTINUES, so an unattended
 * 07:00 run that asks for one ungranted write still finishes its briefing.
 */
export function makeGrantGate(args: {
  granted: AgentCapability[];
  ceiling: AgentCapability[];
  onPropose: (call: ProposedCall) => void;
  /** The run-local descriptors, IDENTICAL to what `buildAgentTools` was given.
   *  Both derive their view of the run from `descriptorsFor`, so a tool the
   *  model can see is a tool this gate can classify — an `extra` tool missing
   *  here would be offered and then denied "Unknown tool." on every call. */
  extra?: readonly ToolDescriptor[];
}): GrantGate {
  const granted = new Set(args.granted);
  const ceiling = new Set(args.ceiling);
  const byName = new Map(
    descriptorsFor({ extra: args.extra }).map((d) => [d.name, d]),
  );

  return async ({ toolCall }) => {
    const d = byName.get(toolCall.toolName);
    // Fail closed. An unrecognised name is a hallucinated tool, an
    // `agentExcluded` one, or a tool added without a descriptor; none should
    // execute.
    if (!d) return { type: "denied" as const, reason: "Unknown tool." };
    if (d.capability === null) return undefined;

    // Ceiling BEFORE grant, and no proposal recorded: a proposal nobody in the
    // org is permitted to approve would render an approve button that can only
    // ever fail. An org admin lowering the ceiling silently clamps every agent
    // at once — that is what makes it the admin half of the two-key gate.
    if (!ceiling.has(d.capability)) {
      return {
        type: "denied" as const,
        reason: `${d.capability} is disabled for this organization.`,
      };
    }
    if (granted.has(d.capability)) return undefined;

    args.onPropose({
      toolCallId: toolCall.toolCallId,
      toolName: toolCall.toolName,
      // The DESCRIPTOR's capability, never a caller-supplied one, so the
      // approval UI and the gate cannot disagree about what a tool costs.
      capability: d.capability,
      input: (toolCall.input ?? {}) as Record<string, unknown>,
    });
    return { type: "denied" as const, reason: UNGRANTED_REASON };
  };
}
