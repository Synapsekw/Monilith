/**
 * The ASK AI mark — the cleaved monolith with a single diamond of light rising
 * off the crown: the stone *illuminated*, the monolith answering. A sibling of
 * {@link MonolithMark} in the same filled-`currentColor` language, so one glyph
 * inherits neutral chrome in the nav/⌘K and the periwinkle accent on the /ask
 * hero. Sized via `className` (e.g. `size-4`, `size-5`). Decorative — give it an
 * accessible name via the wrapping control when it stands alone.
 */
export function AskAiMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      aria-hidden="true"
    >
      {/* sheared top slice */}
      <path d="M8 6.1 L15.6 4.1 L15.6 6.5 L8 8.5 Z" fill="currentColor" />
      {/* body below the cleave */}
      <path d="M8 10.4 L15.6 8.4 L15.6 20 L8 20 Z" fill="currentColor" />
      {/* the spark — a single diamond of light off the crown */}
      <path d="M18.8 2.8 L21 5 L18.8 7.2 L16.6 5 Z" fill="currentColor" />
    </svg>
  );
}
