/**
 * A bounded read that returns exactly its cap may have been truncated. Say so
 * on the server log (reader name and numbers only, never user data), so a
 * silent cut-off becomes visible instead of showing as "some boards missing".
 */
export function warnIfAtCap(
  reader: string,
  table: string,
  rows: readonly unknown[] | null | undefined,
  cap: number,
): void {
  if (rows && rows.length >= cap) {
    console.warn(`${reader}: ${table} read hit its cap of ${cap} rows`);
  }
}
