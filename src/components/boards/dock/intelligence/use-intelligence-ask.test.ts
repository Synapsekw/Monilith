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

/**
 * `ndjson` fed a list with no `done`/`error` in it IS the severed-stream
 * shape: the body closes cleanly (no thrown exception) after `status` and/or
 * `token` events, exactly like a proxy timeout, an idle load-balancer kill, or
 * a server crash after the opening status but before `done`. `readAskStream`
 * reports this via its `terminated: false` return, not a rejection — so this
 * failure mode is invisible to a `try`/`catch` around it. Same failure shape
 * as `severedResponse` in `use-ask-stream.test.ts`, reproduced here because
 * `IntelAskEvent`'s framing (and this hook's handling of it) is a distinct
 * contract from `AskStreamEvent`'s. */

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
    // A turn that really did answer: a token, then `done`. A body of `done`
    // alone is NOT "settled" — see the zero-token cases below.
    fetchMock.mockResolvedValue(
      ndjson([{ type: "token", text: "Two items." }, { type: "done" }]),
    );
    const { result } = renderHook(() => useIntelligenceAsk(RUN_ID));
    await act(() => result.current.ask("q"));
    await waitFor(() => expect(result.current.streaming).toBe(false));
    expect(result.current.error).toBeNull();
  });

  it("tells the user the answer didn't finish when the turn ends with done but no tokens", async () => {
    vi.stubGlobal("fetch", fetchMock);
    // `askPulseStream` has two exits that emit NO token and still let the
    // route write `done`: the early return when `stop_reason !== "tool_use"`
    // and `stream.on("text")` never fired (thinking consumed `max_tokens`),
    // and the capped tail whose single token can be `""`. The route discards
    // the return value by design — no row is written — so token events are
    // the ONLY channel to the reader. `terminated` is true here, so the
    // severed-stream guard cannot catch it: without an empty-answer check the
    // bubble renders "Thinking…" forever, with `streaming` false and `error`
    // null, on a surface with no persistence and no retry.
    fetchMock.mockResolvedValue(ndjson([{ type: "done" }]));
    const { result } = renderHook(() => useIntelligenceAsk(RUN_ID));
    await act(() => result.current.ask("q"));

    expect(result.current.error).toBe("The answer didn't finish. Try again.");
    expect(result.current.streaming).toBe(false);
    expect(result.current.pairs[0].answer).toBe("");
    expect(result.current.status).toBeNull();
  });

  it("tells the user the answer didn't finish when the only token is empty", async () => {
    vi.stubGlobal("fetch", fetchMock);
    // The capped tail: `args.emit({ type: "token", text: answer })` where
    // `textOf(capped.content)` came back empty. A token event arrived, but no
    // answer did.
    fetchMock.mockResolvedValue(
      ndjson([
        { type: "status", text: "Reading this board…" },
        { type: "token", text: "" },
        { type: "done" },
      ]),
    );
    const { result } = renderHook(() => useIntelligenceAsk(RUN_ID));
    await act(() => result.current.ask("q"));

    expect(result.current.error).toBe("The answer didn't finish. Try again.");
    expect(result.current.streaming).toBe(false);
  });

  it("keeps an error event's own message when the turn also produced no answer", async () => {
    vi.stubGlobal("fetch", fetchMock);
    // An `error` event is terminal AND leaves the answer empty, so the
    // empty-answer check must not overwrite the message the server sent.
    fetchMock.mockResolvedValue(
      ndjson([{ type: "error", message: "That board is too large to read." }]),
    );
    const { result } = renderHook(() => useIntelligenceAsk(RUN_ID));
    await act(() => result.current.ask("q"));

    expect(result.current.error).toBe("That board is too large to read.");
  });

  it("tells the user the answer didn't finish when the stream closes with no terminal event", async () => {
    vi.stubGlobal("fetch", fetchMock);
    // Status and a couple of tokens land, then the body just ends — no
    // `done`, no `error`, no thrown exception. Before the fix this left
    // `error` null and the bubble either stuck on "Thinking…" (no tokens) or
    // silently passing off a partial answer as complete (some tokens).
    fetchMock.mockResolvedValue(
      ndjson([
        { type: "status", text: "Reading this board…" },
        { type: "token", text: "Partial ans" },
      ]),
    );
    const { result } = renderHook(() => useIntelligenceAsk(RUN_ID));
    await act(() => result.current.ask("q"));

    expect(result.current.error).toBe("The answer didn't finish. Try again.");
    // The turn settled — not stuck "streaming" with nothing in flight.
    expect(result.current.streaming).toBe(false);
    // The tokens that DID arrive are still there (not discarded)...
    expect(result.current.pairs[0].answer).toBe("Partial ans");
    // ...but `status` is cleared, so the pair can no longer render as if it
    // were quietly still in progress ("Thinking…") once `error` is checked
    // by the composer that reads this hook.
    expect(result.current.status).toBeNull();
  });

  it("tells the user the answer didn't finish when the stream closes before any token arrives", async () => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(
      ndjson([{ type: "status", text: "Reading this board…" }]),
    );
    const { result } = renderHook(() => useIntelligenceAsk(RUN_ID));
    await act(() => result.current.ask("q"));

    expect(result.current.error).toBe("The answer didn't finish. Try again.");
    expect(result.current.streaming).toBe(false);
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
