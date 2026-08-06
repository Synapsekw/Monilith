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

/**
 * sessionStorage key recording "this pathname has already spent its ONE offline
 * recovery reload".
 *
 * When the live app crashes into a route error boundary while offline (a lazily
 * imported chunk the worker never precached), the browser is already sitting on
 * the right URL, so reloading is the fix: the worker answers the document
 * navigation with `/offline`, which restores the cached board for that URL. But
 * a boundary that reloads itself is an INFINITE reload loop the moment the
 * reloaded document also errors — so the reload is one-shot per pathname, and
 * the key is written BEFORE the reload, never after.
 *
 * `sessionStorage`, not `localStorage`: the one-shot must survive the reload
 * (which rules out memory) but must not outlive the tab, or a single bad
 * recovery months ago would permanently disable offline recovery for that URL.
 *
 * Keyed per pathname so a failed recovery on `/boards/A` cannot suppress a
 * legitimate one on `/boards/B`. Cleared by `<OfflineNavigationGuard>` once a
 * page renders successfully while ONLINE — see the note there for why the error
 * boundary itself must never clear it.
 */
export function offlineRecoveryKey(pathname: string): string {
  return `monolith.offline.recovered:${pathname}`;
}
