/**
 * Client-minted ids for optimistically-inserted rows.
 *
 * An optimistic "add item"/"add subitem" paints the row before the server has
 * assigned it a real uuid, so the temp row carries a locally-generated id that
 * is deliberately NOT uuid-shaped: any write keyed by it would target a row
 * that does not exist yet, so every id-keyed affordance must be able to
 * recognise it and stand down until reconciliation.
 *
 * ── The temp-row rule (referenced from the components that enforce it) ──
 * While a row's id is optimistic:
 *   • its cells are READ-ONLY (dimmed) — a cell write keyed by the temp id
 *     would 404 on the server and be rolled back;
 *   • it cannot be renamed (rename is keyed by item id);
 *   • it cannot be opened in the item panel (`?item=<id>` would not resolve);
 *   • it cannot be bulk-selected (the selection store is keyed by item id, and
 *     the id it holds is about to be replaced).
 * The window is one server round-trip; `replaceItemId` in `./cache` swaps the
 * temp row for the real one in place, and every affordance turns back on.
 */
const OPTIMISTIC_ID_PREFIX = "optimistic-";

/** Mint a temp id for an optimistically-inserted row. */
export function newOptimisticId(): string {
  return `${OPTIMISTIC_ID_PREFIX}${crypto.randomUUID()}`;
}

/** True when `id` is a client-minted temp id (row not yet persisted). */
export function isOptimisticId(id: string): boolean {
  return id.startsWith(OPTIMISTIC_ID_PREFIX);
}
