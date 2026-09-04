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

// Field and record separators: control characters that cannot appear in a uuid,
// a number or a boolean, and are vanishingly unlikely in a board name.
//
// They are punctuation, NOT the safety property. Distinct separators only make
// an encoding unforgeable if the payload is escaped, and `name` is not escaped:
// `boardNameSchema` is `z.string().trim().min(1).max(100)` with no
// control-character filter, so a board could be named `Alpha\x010\x02b2\x011\x01Beta`
// and the naive `join` produced byte-for-byte the key of a DIFFERENT two-board
// list. That forged "content unchanged" strands the sidebar's optimistic order
// across a real server rename/create/delete/reorder until a full reload.
//
// What actually makes the key unforgeable is the LENGTH PREFIX below.
const FIELD = "\x01";
const RECORD = "\x02";

/**
 * One field, encoded `<char count>\x01<value>`. This is what makes the whole key
 * injective: a reader takes the digits up to the separator and then exactly that
 * many characters, whatever they are — so no value, however crafted, can move a
 * field or record boundary. It is unconditional (no escaping, no filtering, no
 * lossiness: two different names still hash apart) and costs one `.length`.
 */
function field(value: string): string {
  return `${value.length}${FIELD}${value}`;
}

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
      [b.id, String(b.position), b.name, b.shared_out ? "1" : "0"]
        .map(field)
        .join(""),
    )
    .join(RECORD);
}
