import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_ASK_HISTORY } from "@/lib/ai/board-intelligence/ask-input";
import { useIntelligenceAsk } from "./use-intelligence-ask";

const RUN_ID = "11111111-1111-4111-8111-111111111111";

/** NDJSON body of `IntelAskEvent`s, matching the route's own framing. */
function ndjson(events: Array<Record<string, unknown>>) {
  const body = new ReadableStream({
    start(c) {
      const e = new TextEncoder();
      for (const ev of events) c.enqueue(e.encode(JSON.stringify(ev) + "\n"));
      c.close();
    },
  });
  return new Response(body);
}

const fetchMock = vi.fn();

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe("useIntelligenceAsk", () => {
  it("streams tokens into a pair and keeps at most five", async () => {
    vi.stubGlobal("fetch", fetchMock);
    // A fresh Response (and thus a fresh, unread body stream) per call — a
    // ReadableStream can only be consumed once, and `mockResolvedValue` would
    // hand every subsequent `ask()` the SAME already-drained stream.
    fetchMock.mockImplementation(async () =>
      ndjson([
        { type: "status", text: "Reading this board…" },
        { type: "token", text: "Two " },
        { type: "token", text: "items slipped." },
        { type: "done" },
      ]),
    );
    const { result } = renderHook(() => useIntelligenceAsk(RUN_ID));

    await act(() => result.current.ask("what slipped?"));
    expect(result.current.pairs).toEqual([
      expect.objectContaining({
        question: "what slipped?",
        answer: "Two items slipped.",
      }),
    ]);

    for (let i = 0; i < 5; i++) await act(() => result.current.ask(`q${i}`));
    expect(result.current.pairs).toHaveLength(5);
    // 6 asks total ("what slipped?" + q0..q4), 5 kept: the oldest
    // ("what slipped?") is dropped, so q0 is now the oldest survivor.
    expect(result.current.pairs[0].question).toBe("q0"); // oldest dropped
    expect(result.current.pairs.map((p) => p.question)).toEqual([
      "q0",
      "q1",
      "q2",
      "q3",
      "q4",
    ]);
  });

  it("sends at most MAX_ASK_HISTORY prior pairs", async () => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockImplementation(async () =>
      ndjson([{ type: "token", text: "ok" }, { type: "done" }]),
    );
    const { result } = renderHook(() => useIntelligenceAsk(RUN_ID));

    for (let i = 0; i < 6; i++) await act(() => result.current.ask(`q${i}`));

    const lastCall = fetchMock.mock.calls.at(-1)!;
    const body = JSON.parse(lastCall[1].body as string);
    expect(body.history).toHaveLength(MAX_ASK_HISTORY);
    // The 4 most recent ANSWERED pairs prior to the final ask (q5): the state
    // at that point was [q1..q4] answered (q0 already dropped by MAX_PAIRS).
    expect(body.history.map((p: { question: string }) => p.question)).toEqual([
      "q1",
      "q2",
      "q3",
      "q4",
    ]);
  });

  it("surfaces an error event and keeps the question visible", async () => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(ndjson([{ type: "error", message: "nope" }]));
    const { result } = renderHook(() => useIntelligenceAsk(RUN_ID));
    await act(() => result.current.ask("q"));
    expect(result.current.error).toBe("nope");
    expect(result.current.pairs[0].question).toBe("q");
  });

  it("refuses to ask with no run", async () => {
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useIntelligenceAsk(null));
    await act(() => result.current.ask("q"));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.pairs).toEqual([]);
  });

  it("clears streaming after the turn settles", async () => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(ndjson([{ type: "done" }]));
    const { result } = renderHook(() => useIntelligenceAsk(RUN_ID));
    await act(() => result.current.ask("q"));
    await waitFor(() => expect(result.current.streaming).toBe(false));
  });

  it("surfaces a recovery message when the fetch itself throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    const { result } = renderHook(() => useIntelligenceAsk(RUN_ID));
    await act(() => result.current.ask("q"));
    expect(result.current.error).toBe("The answer didn't finish. Try again.");
  });
});
