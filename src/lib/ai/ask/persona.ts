import { sanitizeInline } from "@/lib/ai/prompt-sanitize";

/**
 * Tell the model which board the user is looking at.
 *
 * Saves the list_boards → get_board_overview round-trip that /ask needs to
 * resolve "this board", which is the dock's substantive latency advantage. The
 * id is authoritative (a uuid from the database, not user-authored) and is
 * interpolated as-is; the name is authored by ANY member of the board — not
 * necessarily the thread owner — so it crosses a user trust boundary and is
 * sanitised inline before it lands in the (un-delimited) prose line below.
 */
export function composeBoardScope(
  baseSystem: string,
  board: { id: string; name: string } | null,
): string {
  if (!board) return baseSystem;
  const name = sanitizeInline(board.name);
  return [
    baseSystem,
    "",
    `The user is looking at the board "${name}" (id ${board.id}).`,
    'Resolve "this board", "here" and unqualified questions to that id without calling list_boards first.',
    "You may still call get_board_overview on it to decode option and user ids.",
  ].join("\n");
}

/**
 * Tell the model which folder the user is looking at, and which boards make
 * it up (spec §5.1).
 *
 * Same trust boundary as `composeBoardScope` above: the folder id and each
 * board id are uuids read back through RLS, not user-authored, so they are
 * interpolated as-is; the folder name and every board name ARE authored by a
 * member of the workspace — not necessarily the thread owner — so each is
 * sanitised inline before it lands in the (un-delimited) prose/list lines
 * below. Listing the boards by id up front is what saves the
 * list_boards → get_board_overview round-trip that "this project" would
 * otherwise cost.
 */
export function composeFolderScope(
  baseSystem: string,
  folder: {
    id: string;
    name: string;
    boards: { id: string; name: string }[];
  } | null,
): string {
  if (!folder) return baseSystem;
  const name = sanitizeInline(folder.name);
  const boards = folder.boards.map(
    (b) => `- ${sanitizeInline(b.name)} (id ${b.id})`,
  );
  return [
    baseSystem,
    "",
    `The user is looking at the folder "${name}" (id ${folder.id}), a project made of these boards:`,
    ...(boards.length > 0 ? boards : ["- (no boards yet)"]),
    'Resolve "this project", "this folder", "here" and unqualified questions to those boards without calling list_boards first.',
    "Call get_board_overview on a board before decoding its option and user ids.",
  ].join("\n");
}
