/**
 * Instant loading fallback for a board. Rendered immediately on navigation
 * while the board page streams in; the layout (sidebar + header) stays mounted,
 * so only this content area shows the skeleton.
 */
export default function BoardLoading() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading board"
      className="flex h-full flex-col gap-4 p-6"
    >
      <div className="bg-muted h-8 w-48 animate-pulse rounded-md" />
      <div className="flex flex-col gap-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="bg-muted/60 h-10 w-full animate-pulse rounded-md"
          />
        ))}
      </div>
    </div>
  );
}
