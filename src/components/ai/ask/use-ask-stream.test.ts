import { describe, expect, it, vi, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { readAskStream, useAskStream } from "./use-ask-stream";
import type { AskStreamEvent } from "@/lib/ai/ask/stream-protocol";

const DONE =
  '{"type":"done","conversationId":"c","assistantMessageId":"a","boardsConsulted":[]}';

function ndjsonResponse(lines: string[]) {
  const body = new ReadableStream({
    start(c) {
      const e = new TextEncoder();
      for (const l of lines) c.enqueue(e.encode(l + "\n"));
      c.close();
    },
  });
  return new Response(body);
}

/** A stream severed mid-turn: some tokens land, then the body simply ends with
 *  no `done` — optionally leaving a truncated final line, which is what a real
 *  socket cut produces. This is the gotcha-61 failure mode. */
function severedResponse({ truncatedTail = false } = {}) {
  const body = new ReadableStream({
    start(c) {
      const e = new TextEncoder();
      c.enqueue(e.encode('{"type":"token","text":"Partial ans"}\n'));
      if (truncatedTail) c.enqueue(e.encode('{"type":"token","tex'));
      c.close();
    },
  });
  return new Response(body);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("readAskStream", () => {
  it("parses NDJSON events in order", async () => {
    const got: string[] = [];
    await readAskStream(
      ndjsonResponse(['{"type":"token","text":"Hi"}', DONE]),
      (e: AskStreamEvent) => got.push(e.type),
    );
    expect(got).toEqual(["token", "done"]);
  });

  it("reassembles events split across chunk boundaries", async () => {
    const e = new TextEncoder();
    const body = new ReadableStream({
      start(c) {
        c.enqueue(e.encode('{"type":"to'));
        c.enqueue(e.encode('ken","text":"Hey"}\n'));
        c.close();
      },
    });
    const got: AskStreamEvent[] = [];
    await readAskStream(new Response(body), (ev) => got.push(ev));
    expect(got).toEqual([{ type: "token", text: "Hey" }]);
  });

  it("reports a terminator when the turn ends at `done`", async () => {
    await expect(readAskStream(ndjsonResponse([DONE]), () => {})).resolves.toBe(
      true,
    );
  });

  it("reports a terminator for an `error` event — that path already surfaces a message", async () => {
    await expect(
      readAskStream(
        ndjsonResponse(['{"type":"error","message":"nope"}']),
        () => {},
      ),
    ).resolves.toBe(true);
  });

  it("reports NO terminator when the stream is severed mid-turn", async () => {
    const got: AskStreamEvent[] = [];
    await expect(
      readAskStream(severedResponse(), (e) => got.push(e)),
    ).resolves.toBe(false);
    // The tokens that did arrive are still dispatched.
    expect(got).toEqual([{ type: "token", text: "Partial ans" }]);
  });

  it("survives a truncated trailing line instead of throwing", async () => {
    await expect(
      readAskStream(severedResponse({ truncatedTail: true }), () => {}),
    ).resolves.toBe(false);
  });
});

describe("useAskStream", () => {
  it("reports `dropped` for a severed stream and clears `streaming`", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => severedResponse()),
    );
    const { result } = renderHook(() => useAskStream());

    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current.send("c1", () => {});
    });

    expect(outcome).toBe("dropped");
    await waitFor(() => expect(result.current.streaming).toBe(false));
  });

  it("reports `dropped` when fetch itself throws, without stranding the composer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("Failed to fetch");
      }),
    );
    const { result } = renderHook(() => useAskStream());

    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current.send("c1", () => {});
    });

    expect(outcome).toBe("dropped");
    await waitFor(() => expect(result.current.streaming).toBe(false));
  });

  it("reports `ok` for a normally terminated turn", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ndjsonResponse([DONE])),
    );
    const { result } = renderHook(() => useAskStream());

    const got: AskStreamEvent[] = [];
    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current.send("c1", (e) => got.push(e));
    });

    expect(outcome).toBe("ok");
    expect(got.map((e) => e.type)).toEqual(["done"]);
  });

  it("reports `ok` for an HTTP failure — the error event already surfaces it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "Out of credits." }), {
            status: 402,
          }),
      ),
    );
    const { result } = renderHook(() => useAskStream());

    const got: AskStreamEvent[] = [];
    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current.send("c1", (e) => got.push(e));
    });

    expect(outcome).toBe("ok");
    expect(got).toEqual([{ type: "error", message: "Out of credits." }]);
  });
});
