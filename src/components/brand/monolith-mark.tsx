/**
 * The MONOLITH logo mark — a cleaved monolith silhouette rendered in
 * `currentColor`, so it adapts to light/dark chrome. Matches the angled-top
 * slab on the landing hero. Decorative when paired with the wordmark; give it
 * a label via the wrapping control when used alone.
 */
export function MonolithMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      aria-hidden="true"
    >
      {/* cleaved slab: top edge slopes up to the right */}
      <path d="M8.6 5 15.4 3.2V20.8H8.6Z" fill="currentColor" />
    </svg>
  );
}
