/**
 * How long an MCP connection may sit unused before it has to reconnect — the
 * ONE place this number lives. The window slides: every successful token
 * refresh starts a fresh one (`rotateTokenPair`), so a connection in regular
 * use never expires, and a refresh token that leaked is only good for this long
 * after the real client last used it.
 *
 * Dependency-free on purpose: the consent screen and the settings page quote
 * the number in their copy and must not drag the token store in to do it.
 */
export const REFRESH_TOKEN_IDLE_DAYS = 90;
export const REFRESH_TOKEN_IDLE_TTL_SECONDS =
  REFRESH_TOKEN_IDLE_DAYS * 24 * 60 * 60;
