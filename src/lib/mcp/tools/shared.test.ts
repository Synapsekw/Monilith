import { describe, expect, it } from "vitest";
import { z } from "zod";
import { toToolResult, parseAction } from "./shared";

describe("toToolResult", () => {
  it("serializes a success payload as JSON with no error flag", () => {
    const r = toToolResult({ ok: true, data: { boardId: "b1" } });
    expect(r.isError).toBeUndefined();
    expect(JSON.parse(r.content[0]!.text)).toEqual({ boardId: "b1" });
  });

  // A void action returns `data: undefined`. JSON.stringify(undefined) is
  // undefined, not a string — writing that into `text` yields the string
  // "undefined" and a model reading it cannot tell success from a bug.
  it("renders a void success as an explicit ok marker", () => {
    const r = toToolResult({ ok: true, data: undefined });
    expect(r.isError).toBeUndefined();
    expect(JSON.parse(r.content[0]!.text)).toEqual({ ok: true });
  });

  it("surfaces a failure as the error message with isError set", () => {
    const r = toToolResult({ ok: false, error: "Board not found." });
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toBe("Board not found.");
  });
});

describe("parseAction", () => {
  const schema = z.discriminatedUnion("action", [
    z.object({ action: z.literal("rename"), name: z.string().min(1) }),
    z.object({ action: z.literal("archive") }),
  ]);

  it("returns the narrowed value on a valid input", () => {
    const r = parseAction(schema, { action: "rename", name: "Q3" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ action: "rename", name: "Q3" });
  });

  it("returns a tool failure naming the problem on invalid input", () => {
    const r = parseAction(schema, { action: "rename" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.result.isError).toBe(true);
      expect(r.result.content[0]!.text.length).toBeGreaterThan(0);
    }
  });

  it("rejects an unknown action rather than falling through", () => {
    const r = parseAction(schema, { action: "purge" });
    expect(r.ok).toBe(false);
  });
});
