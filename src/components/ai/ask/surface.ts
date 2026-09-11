/**
 * Where a chat surface renders. `card` is `/ask`: a centred column inside the
 * content card with a raised composer strip. `atmosphere` is the board dock
 * (spec 2026-09-11-agent-dock-atmosphere §3): the transcript sits directly on
 * the app wash — no card, the column is the width — and the composer is the
 * one raised surface. The default is `card`, so `/ask` never changes.
 */
export type ChatSurface = "card" | "atmosphere";
