import { describe, expect, it } from "vitest";
import { makeFakeClient } from "@/test/mcp-fake-client";
import { createItemHandler } from "./create-item";
import { updateItemHandler } from "./update-item";

const ACTOR = "99999999-9999-4999-8999-999999999999";

/**
 * This file deliberately does NOT `vi.mock("@/lib/validations/boards")`.
 *
 * The sibling `create-item.test.ts` / `update-item.test.ts` suites do, which
 * stubs `cellValueSchema` into an always-succeed passthrough and leaves the
 * per-kind validation guard — the whole point of `writeCellValue` — untested.
 * These tests exercise the REAL `cellValueSchema(column.kind)`.
 */
describe("MCP field writes run the real cellValueSchema", () => {
  it("writes the PARSED value, dropping keys the column kind does not define", async () => {
    // textValueSchema is z.object({ text: z.string() }); zod strips unknown
    // keys, so `bogus` must not reach the database. This simultaneously proves
    // the real schema ran AND that valueParsed.data (not field.value) is written.
    const { getClient, calls } = makeFakeClient({
      column: {
        data: { org_id: "o1", board_id: "b1", kind: "text" },
        error: null,
      },
    });
    const result = await createItemHandler(
      getClient,
      {
        groupId: "g1",
        name: "New task",
        fields: [
          { columnId: "c1", value: { text: "hello", bogus: "dropped" } },
        ],
      },
      ACTOR,
    );
    expect(result.isError).toBeUndefined();
    expect(calls.upserts).toHaveLength(1);
    expect(calls.upserts[0]?.row).toEqual({
      org_id: "o1",
      board_id: "b1",
      item_id: "i1",
      column_id: "c1",
      value: { text: "hello" },
    });
  });

  it("rejects a value that does not match the column kind, surfacing zod's message", async () => {
    const { getClient, calls } = makeFakeClient({
      column: {
        data: { org_id: "o1", board_id: "b1", kind: "numbers" },
        error: null,
      },
    });
    const result = await updateItemHandler(
      getClient,
      {
        itemId: "i1",
        fields: [{ columnId: "c1", value: { n: "not a number" } }],
      },
      ACTOR,
    );
    expect(calls.upserts).toHaveLength(0);
    const parsed = JSON.parse(result.content[0]?.text as string);
    // Verified against the pinned zod 4.4.3. If a zod upgrade changes this
    // string, the text an MCP agent sees changed too — that IS the signal.
    expect(parsed.fieldErrors).toEqual([
      "c1: Invalid input: expected number, received string",
    ]);
    expect(result.isError).toBe(true);
  });

  it("accepts a valid value for a non-text column kind", async () => {
    const { getClient, calls } = makeFakeClient({
      column: {
        data: { org_id: "o1", board_id: "b1", kind: "checkbox" },
        error: null,
      },
    });
    const result = await updateItemHandler(
      getClient,
      {
        itemId: "i1",
        fields: [{ columnId: "c1", value: { checked: true } }],
      },
      ACTOR,
    );
    expect(result.isError).toBeUndefined();
    expect(calls.upserts[0]?.row).toMatchObject({ value: { checked: true } });
  });
});
