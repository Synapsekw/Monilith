/**
 * The ONE offline time window. Cache `maxAge`, session-staleness wipe and the
 * entitlement grace period all read this constant. Two numbers would drift and
 * produce a state where the cache survives but the entitlement does not (or
 * vice versa), which is unreasonable to debug — see the plan's Global
 * Constraints.
 */
export const OFFLINE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Single source for the refusal copy, asserted by tests and shown in toasts. */
export const OFFLINE_MESSAGE = "You're offline — reconnect to make changes.";

/**
 * localStorage keys. They live here rather than in `entitlement.ts` because the
 * `/offline` route reads `LAST_USER_KEY` and must not import the entitlement
 * module — that would make the offline entry point depend on billing.
 */
export const LAST_USER_KEY = "monolith.offline.userId";
export const ENTITLEMENT_KEY = "monolith.offline.entitlement";
