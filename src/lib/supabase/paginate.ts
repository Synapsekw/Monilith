/**
 * PostgREST silently truncates every response to the project's `max_rows`
 * (1000 on Supabase, see supabase/config.toml), whatever `.limit(n)` asks for.
 * A read that can exceed it must page with `.range()`, or the caller gets an
 * arbitrary first 1000 rows and no error. The query MUST have a total order
 * (end with a unique key) or rows can repeat or vanish across pages.
 */
export const POSTGREST_MAX_ROWS = 1000;

type PageResult<T> = PromiseLike<{
  data: T[] | null;
  error: { message: string } | null;
}>;

/**
 * Read up to `cap` rows by issuing `page(from, to)` (inclusive range) requests.
 * The first page goes alone, so small reads cost one round trip; if it comes
 * back full, the rest are fetched `wave` pages at a time in parallel until a
 * short page or the cap.
 */
export async function fetchAllRows<T>(
  page: (from: number, to: number) => PageResult<T>,
  opts: { cap: number; pageSize?: number; wave?: number },
): Promise<{ data: T[] | null; error: { message: string } | null }> {
  const size = opts.pageSize ?? POSTGREST_MAX_ROWS;
  const wave = opts.wave ?? 8;
  const cap = opts.cap;
  const span = (from: number) => page(from, Math.min(from + size, cap) - 1);

  const first = await span(0);
  if (first.error) return { data: null, error: first.error };
  const rows: T[] = [...(first.data ?? [])];
  if (rows.length < Math.min(size, cap)) return { data: rows, error: null };

  let next = size;
  while (next < cap) {
    const starts: number[] = [];
    for (let i = 0; i < wave && next < cap; i++, next += size)
      starts.push(next);
    const results = await Promise.all(starts.map(span));
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.error) return { data: null, error: r.error };
      const got = r.data ?? [];
      rows.push(...got);
      const want = Math.min(starts[i] + size, cap) - starts[i];
      if (got.length < want) return { data: rows, error: null };
    }
  }
  return { data: rows, error: null };
}
