import { describe, it, expect, vi } from "vitest";
import {
  fetchWithProgress,
  type FetchProgress,
} from "@/lib/collaboration/fetch-with-progress";

function streamingResponse(chunks: number[][], contentLength?: string) {
  let i = 0;
  return {
    ok: true,
    headers: {
      get: (k: string) =>
        k === "content-length" ? (contentLength ?? null) : null,
    },
    body: {
      getReader: () => ({
        read: async () =>
          i < chunks.length
            ? { done: false, value: new Uint8Array(chunks[i++]) }
            : { done: true, value: undefined },
      }),
    },
  } as unknown as Response;
}

describe("fetchWithProgress", () => {
  it("streams the body and reports cumulative bytes against the declared total", async () => {
    global.fetch = vi.fn(async () =>
      streamingResponse([[1, 2, 3], [4, 5], [6]], "6"),
    ) as unknown as typeof fetch;

    const seen: FetchProgress[] = [];
    const buf = await fetchWithProgress("https://x/f.pdf", (p) => seen.push(p));

    expect(seen).toEqual([
      { received: 3, total: 6 },
      { received: 5, total: 6 },
      { received: 6, total: 6 },
    ]);
    expect(new Uint8Array(buf)).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6]));
  });

  it("reports total: null when the server declares no length", async () => {
    global.fetch = vi.fn(async () =>
      streamingResponse([[1, 2]]),
    ) as unknown as typeof fetch;

    const seen: FetchProgress[] = [];
    await fetchWithProgress("https://x/f.pdf", (p) => seen.push(p));
    // Callers must render this as indeterminate, not invent a denominator.
    expect(seen).toEqual([{ received: 2, total: null }]);
  });

  it("falls back to arrayBuffer when the environment has no streaming body", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      headers: { get: () => null },
      body: undefined,
      arrayBuffer: async () => new Uint8Array([9, 9, 9]).buffer,
    })) as unknown as typeof fetch;

    const seen: FetchProgress[] = [];
    const buf = await fetchWithProgress("https://x/f.pdf", (p) => seen.push(p));
    expect(new Uint8Array(buf)).toEqual(new Uint8Array([9, 9, 9]));
    expect(seen).toEqual([{ received: 3, total: 3 }]);
  });

  it("throws on a non-ok response rather than returning an empty buffer", async () => {
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 403,
      headers: { get: () => null },
    })) as unknown as typeof fetch;

    await expect(fetchWithProgress("https://x/f.pdf")).rejects.toThrow("403");
  });
});
