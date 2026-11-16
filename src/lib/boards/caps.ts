/**
 * The hard limits on one board read, and what to tell a person when a read
 * stops at one. No server-only imports: the client notice reads these too.
 *
 * A capped read returns the first N rows and nothing else. Without a flag the
 * board just looks emptier than it is, so every cap here has a matching entry
 * in `BoardTruncation` and a sentence in `boardCapMessages`.
 */

/** Most live items (and dependencies) one board read returns. */
export const BOARD_ITEMS_CAP = 5000;
/**
 * Most cell values one board read returns: 5000 items at a dozen filled cells.
 * Raised from 20000 when imported plans (1,770 items × ~17 columns) overflowed.
 */
export const BOARD_CELLS_CAP = 60000;
/** Most relation links (connections to items on other boards) one read returns. */
export const BOARD_RELATION_LINKS_CAP = 2000;
/**
 * Most linked-item names resolved for those links. One PostgREST response
 * (`POSTGREST_MAX_ROWS`); a link whose name is past it renders no chip.
 */
export const BOARD_LINKED_NAMES_CAP = 1000;

/** Which capped reads of a board payload left rows behind. */
export type BoardTruncation = {
  cells: boolean;
  relationLinks: boolean;
  linkedItemNames: boolean;
};

export const NO_TRUNCATION: BoardTruncation = {
  cells: false,
  relationLinks: false,
  linkedItemNames: false,
};

const n = (value: number) => value.toLocaleString("en-US");

/** One plain sentence pair per cap that was hit, in a fixed order. */
export function boardCapMessages(
  truncation: BoardTruncation | null | undefined,
): string[] {
  if (!truncation) return [];
  const out: string[] = [];
  if (truncation.cells)
    out.push(
      `Showing the first ${n(BOARD_CELLS_CAP)} cells. Some values are not loaded.`,
    );
  if (truncation.relationLinks)
    out.push(
      `Showing the first ${n(BOARD_RELATION_LINKS_CAP)} links to other boards. Some links are not loaded.`,
    );
  if (truncation.linkedItemNames)
    out.push(
      `Showing the first ${n(BOARD_LINKED_NAMES_CAP)} linked items. Some links are not shown.`,
    );
  return out;
}
