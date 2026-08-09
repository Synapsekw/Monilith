/** Bytes received so far, and the total when the server declared one. */
export type FetchProgress = { received: number; total: number | null };

/**
 * Fetch a URL into an ArrayBuffer, reporting download progress as it streams.
 *
 * `Response.arrayBuffer()` resolves only once the whole body has arrived, so it
 * can report nothing in between — which is exactly the window where a large
 * attachment looks frozen. Reading the body stream gives real byte counts.
 *
 * Degrades rather than fails: if the environment has no streaming body (jsdom,
 * older Safari) it falls back to `arrayBuffer()` and reports a single final
 * tick. A missing or non-numeric `Content-Length` yields `total: null`, which
 * callers must render as an indeterminate bar rather than inventing a
 * denominator.
 */
export async function fetchWithProgress(
  src: string,
  onProgress?: (p: FetchProgress) => void,
): Promise<ArrayBuffer> {
  const res = await fetch(src);
  if (!res.ok) throw new Error(`Request failed (${res.status})`);

  const declared = Number(res.headers?.get?.("content-length") ?? "");
  const total = Number.isFinite(declared) && declared > 0 ? declared : null;

  const reader = res.body?.getReader?.();
  if (!reader) {
    const buf = await res.arrayBuffer();
    onProgress?.({ received: buf.byteLength, total: total ?? buf.byteLength });
    return buf;
  }

  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      received += value.byteLength;
      onProgress?.({ received, total });
    }
  }

  // Concatenate once at the end — repeatedly growing a buffer per chunk would
  // make this quadratic on exactly the large files it exists to serve.
  const out = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out.buffer;
}
