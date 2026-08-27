import type { BoardListEntry } from "@/lib/boards/queries";

/**
 * Every field of a board row that `BoardsNavSortable` actually renders. The key
 * covers exactly this set — no more (cheaper, and unrelated churn must not
 * clobber a drag) and no less (see below).
 */
type NavSyncBoard = Pick<
  BoardListEntry,
  "id" | "position" | "name" | "shared_out"
>;

// A record separator and a field separator that cannot appear in a uuid, a
// number, or a boolean, and are vanishingly unlikely in a board name. Using two
// DISTINCT control characters is what stops a name containing one separator from
// forging a different list shape.
const FIELD = "";
const RECORD = "";

/**
 * A content signature for the owned-boards list, used by `BoardsNavSortable` to
 * decide whether the server sent a genuinely new list.
 *
 * ## Why content and not identity
 *
 * Reorder deliberately does not revalidate (gotcha-44), so the optimistic order
 * held in `BoardsNavSortable` IS the display. That state re-syncs during render
 * when the `boards` prop changes. The original guard compared prop IDENTITY,
 * which made correctness depend on every caller up the tree happening to hand
 * down a memoised array — one `boards.filter(...)` anywhere upstream silently
 * reintroduces "your drag snaps back on the next client re-render", with the
 * whole suite still green. Comparing content moves the invariant into this
 * module, where it can be tested.
 *
 * ## Why all four fields
 *
 * Hashing only ids and positions would be enough to catch a reorder or a
 * create/delete — but a server-side RENAME would then never resync, and the
 * sidebar would show the stale name until a full reload. That trades one silent
 * bug for another. `shared_out` is in for the same reason: it renders a marker
 * on the row. The rule is "every field the row renders", not "every field that
 * affects order".
 */
export function navSyncKey(boards: readonly NavSyncBoard[]): string {
  return boards
    .map((b) =>
      [b.id, b.position, b.name, b.shared_out ? "1" : "0"].join(FIELD),
    )
    .join(RECORD);
}
