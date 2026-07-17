import { describe, expect, it, vi } from "vitest";
import { askPulseStream } from "./ask-stream";
import type { AskStreamEvent } from "./stream-protocol";

// Fake Anthropic .stream() — one round: emits two text deltas, no tool use.
function fakeClient(finalText: string) {
  return {
    messages: {
      stream: vi.fn(() => {
        const handlers: Record<string, (arg: string) => void> = {};
        const p = {
          on: (evt: string, cb: (arg: string) => void) => {
            handlers[evt] = cb;
            return p;
          },
          finalMessage: async () => {
            handlers["text"]?.("Hel");
            handlers["text"]?.("lo");
            return {
              stop_reason: "end_turn",
              content: [{ type: "text", text: finalText }],
              usage: { input_tokens: 5, output_tokens: 2 },
            };
          },
        };
        return p;
      }),
    },
  };
}

describe("askPulseStream", () => {
  it("streams text deltas and returns the final answer + usage", async () => {
    const tokens: string[] = [];
    const res = await askPulseStream({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- fake streaming client (structural)
      client: fakeClient("Hello") as any,
      apiKey: "k",
      workspaceId: "ws1",
      messages: [{ role: "user", content: "hi" }],
      system: "SYS",
      emit: (e: AskStreamEvent) => {
        if (e.type === "token") tokens.push(e.text);
      },
    });
    expect(tokens.join("")).toBe("Hello");
    expect(res.answer).toBe("Hello");
    expect(res.usage).toEqual({ inputTokens: 5, outputTokens: 2 });
    expect(res.boardsConsulted).toEqual([]);
  });
});
