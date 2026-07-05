/**
 * The MONOLITH mark — a cleaved monolith. A standing slab with a thin slice
 * sheared off the top along a diagonal, the crack reading as light through
 * split stone. Rendered in `currentColor`, so it adapts to light/dark chrome.
 * This is the standalone symbol (favicon, app icon, collapsed nav rail); the
 * wordmark keeps the solid slab-I. Decorative when paired with a label — give
 * it an accessible name via the wrapping control when used alone.
 */
export function MonolithMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      fill="none"
      aria-hidden="true"
    >
      {/* sheared top slice */}
      <path d="M36 26 L64 18 L64 27 L36 35 Z" fill="currentColor" />
      {/* body below the cleave */}
      <path d="M36 43 L64 35 L64 84 L36 84 Z" fill="currentColor" />
    </svg>
  );
}
