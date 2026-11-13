/** People-only view of a roster that may carry Monos (`mono` set). Share
 *  dialogs, automation targets and anything that means "a person" use this.
 *  `T extends object` (not `{ mono?: unknown }`) so rosters whose type does not
 *  declare `mono` yet still pass TypeScript's weak-type check. */
export function peopleOnly<T extends object>(members: readonly T[]): T[] {
  return members.filter((m) => !("mono" in m && m.mono));
}
