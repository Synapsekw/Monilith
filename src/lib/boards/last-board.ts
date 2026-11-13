/**
 * Last-visited-board cookie. WRITTEN by the proxy (cookies can't be set during
 * RSC render in Next 16; the proxy already runs on every board navigation and
 * owns response-cookie writes) and READ in two places: by the proxy itself,
 * which sends an authenticated hit on `/` straight to that board (no `/home`
 * hop), and by the /home dispatcher, which turns the remaining logins into ONE
 * bounded PK probe instead of the 3-list fallback.
 * Deliberately NOT "server-only": the proxy imports it too, and it is pure.
 */
export const LAST_BOARD_COOKIE = "pulse_last_board";

/**
 * Marks "the proxy just sent this visitor from `/` to this board on the
 * strength of the last-board cookie alone" — the proxy runs no DB lookups, so
 * it cannot know the board still exists. The board page reads it: when the
 * board turns out to be gone, hidden or archived AND this marker names it, the
 * visitor is handed to the /home dispatcher (which probes and falls through to
 * a live board) instead of being parked on "Board not found" every time they
 * open the app. Short-lived on purpose, so an ordinary later visit to a dead
 * board link still gets the honest not-found page.
 */
export const BOARD_ENTRY_COOKIE = "pulse_board_entry";
export const BOARD_ENTRY_MAX_AGE_SECONDS = 60;

const BOARD_PATH_RE =
  /^\/boards\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** The boardId of an exact `/boards/<uuid>` path, else null. UUID-shape
 * validation means a tampered cookie can never reach Postgres as a malformed
 * uuid filter (22P02) — a non-matching value is simply ignored. */
export function boardIdFromPath(pathname: string): string | null {
  return BOARD_PATH_RE.exec(pathname)?.[1] ?? null;
}

/** A bare board id (a cookie value) when it is UUID-shaped, else null. */
export function validBoardId(raw: string | undefined | null): string | null {
  return raw ? boardIdFromPath(`/boards/${raw}`) : null;
}
