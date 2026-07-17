import { describe, expect, it } from "vitest";
import { readAskStream } from "./use-ask-stream";
import type { AskStreamEvent } from "@/lib/ai/ask/stream-protocol";

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

describe("readAskStream", () => {
  it("parses NDJSON events in order", async () => {
    const got: string[] = [];
    await readAskStream(
      ndjsonResponse([
        '{"type":"token","text":"Hi"}',
        '{"type":"done","conversationId":"c","assistantMessageId":"a","boardsConsulted":[]}',
      ]),
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
});
