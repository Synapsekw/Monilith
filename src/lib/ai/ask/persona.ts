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
