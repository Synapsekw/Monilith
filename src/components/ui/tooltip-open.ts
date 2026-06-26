/**
 * Decide the `open` prop for a Tooltip given the pointer type.
 * - Controlled usage (`open` provided) always wins.
 * - Otherwise on a coarse pointer force `open=false` (touch has no hover, and a
 *   long-press tooltip would fight the drag "lift"); essential info should live
 *   in an always-visible label on touch.
 * - On a fine pointer return `undefined` to keep Radix's default hover behavior.
 */
export function resolveTooltipOpen(
  coarse: boolean,
  open?: boolean,
): boolean | undefined {
  if (open !== undefined) return open;
  return coarse ? false : undefined;
}
