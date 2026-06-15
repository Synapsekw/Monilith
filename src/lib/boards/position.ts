/**
 * Compute a float8 position between two neighbours for midpoint reordering.
 * - prev=null,next=null → 0 (first row)
 * - prev=null,next set  → next/2 (prepend)
 * - prev set, next=null → prev+1 (append)
 * - both set            → (prev+next)/2 (insert between)
 */
export function midpoint(prev: number | null, next: number | null): number {
  if (prev === null && next === null) return 0;
  if (prev === null) return next! / 2;
  if (next === null) return prev + 1;
  return (prev + next) / 2;
}
