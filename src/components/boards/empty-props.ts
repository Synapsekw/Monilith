import type { HeaderGrant } from "@/components/boards/BoardHeader";
import type { EditorMember } from "@/components/boards/cells/editors";

/**
 * Shared empty defaults for the board views' optional list props.
 *
 * Default-parameter empty arrays MUST be module constants: `members = []` in a
 * signature allocates a fresh array on every render, which changes the identity
 * of every memoized bundle / `memo` child it is threaded into. Frozen so an
 * accidental in-place mutation fails loudly instead of leaking between boards.
 */
export const NO_MEMBERS = Object.freeze([]) as unknown as EditorMember[];
export const NO_GRANTS = Object.freeze([]) as unknown as HeaderGrant[];
