import { ALL_TOOL_DESCRIPTORS } from "@/lib/mcp/tools/catalog";
import type { ToolDescriptor } from "@/lib/mcp/tools/descriptor";

/**
 * THE descriptor list one agent run uses — the single source of truth shared by
 * `buildAgentTools` (which turns it into the tool set the model sees) and
 * `makeGrantGate` (which classifies each call against it).
 *
 * It exists because those two must never disagree. When the tool set was built
 * from `catalog + extra` while the gate keyed off the catalog alone, two bugs
 * followed: a run-local `extra` tool was offered to the model and then denied
 * "Unknown tool." on every call — capability-free reads included — and an
 * `extra` descriptor reusing a catalog NAME executed its own handler while
 * being classified from the catalog entry, which for a capability-free catalog
 * name meant an ungated write. Deriving both from this one function makes the
 * disagreeing pair unrepresentable, provided the caller passes the same `extra`
 * to both (Task 7 does; there is deliberately no second place to pass it).
 *
 * Deliberately free of `server-only`: it imports only the catalog (which is
 * itself kept server-only-free so client components can read it) and a type.
 */

/** Thrown when `extra` would shadow a catalog tool or another extra. */
export class DuplicateToolNameError extends Error {
  constructor(name: string) {
    super(
      `Duplicate agent tool name "${name}". An extra descriptor may not reuse ` +
        `a catalog tool's name: the tool set would run the extra's handler ` +
        `while the grant gate classified the call from the catalog entry — an ` +
        `extra write tool shadowing a capability-free read name would execute ` +
        `ungated. Rename the extra descriptor.`,
    );
    this.name = "DuplicateToolNameError";
  }
}

/**
 * Every descriptor an agent may call this run, in catalog order with `extra`
 * appended.
 *
 * `agentExcluded` descriptors are dropped HERE, once, so the model is never
 * offered one and the gate treats it as unknown (fail-closed) if a call for it
 * somehow arrives.
 *
 * A name collision THROWS rather than resolving last-wins. Silent shadowing is
 * precisely how the ungated case above arises, and a run that fails loudly at
 * construction is recoverable in a way a quietly mis-classified write is not.
 * The check runs over the pre-filter list, so reusing the name of an excluded
 * catalog tool is an error too — a name in the catalog means one thing only.
 */
export function descriptorsFor(
  args: { extra?: readonly ToolDescriptor[] } = {},
): ToolDescriptor[] {
  const merged = [...ALL_TOOL_DESCRIPTORS, ...(args.extra ?? [])];

  const seen = new Set<string>();
  for (const d of merged) {
    if (seen.has(d.name)) throw new DuplicateToolNameError(d.name);
    seen.add(d.name);
  }

  return merged.filter((d) => !d.agentExcluded);
}
