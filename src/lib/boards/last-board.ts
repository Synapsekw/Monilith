/**
 * Last-visited-board cookie. WRITTEN by the proxy (cookies can't be set during
 * RSC render in Next 16; the proxy already runs on every board navigation and
 * owns response-cookie writes) and READ by the /home dispatcher, which turns
 * the common login into ONE bounded PK probe instead of the 3-list fallback.
 * Deliberately NOT "server-only": the proxy imports it too, and it is pure.
 */
export const LAST_BOARD_COOKIE = "pulse_last_board";

const BOARD_PATH_RE =
  /^\/boards\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** The boardId of an exact `/boards/<uuid>` path, else null. UUID-shape
 * validation means a tampered cookie can never reach Postgres as a malformed
 * uuid filter (22P02) — a non-matching value is simply ignored. */
export function boardIdFromPath(pathname: string): string | null {
  return BOARD_PATH_RE.exec(pathname)?.[1] ?? null;
}
