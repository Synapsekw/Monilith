import { describe, expect, it } from "vitest";
import { manageColumnDescriptor } from "./manage-column";
import { capabilityFor, scopeFor } from "./descriptor";
import { parseAction } from "./shared";

const STRUCTURE_ACTIONS = [
  "create",
  "rename",
  "configure",
  "reorder",
  "resize",
] as const;

describe("manageColumnDescriptor classification", () => {
  it("gives board.destroy to delete and remove_option", () => {
    expect(capabilityFor(manageColumnDescriptor, { action: "delete" })).toBe(
      "board.destroy",
    );
    expect(
      capabilityFor(manageColumnDescriptor, { action: "remove_option" }),
    ).toBe("board.destroy");
  });

  it("gives board.structure to the other five actions", () => {
    for (const action of STRUCTURE_ACTIONS) {
      expect(capabilityFor(manageColumnDescriptor, { action })).toBe(
        "board.structure",
      );
    }
  });

  it("scopes create by boardId and everything else by columnId", () => {
    expect(scopeFor(manageColumnDescriptor, { action: "create" })).toBe(
      "boardId",
    );
    for (const action of [
      "rename",
      "configure",
      "reorder",
      "resize",
      "delete",
      "remove_option",
    ]) {
      expect(scopeFor(manageColumnDescriptor, { action })).toBe("columnId");
    }
  });
});

// Reach the discriminated union the same way `invoke` does: through the
// exported descriptor's schema at runtime, not by importing a private
// schema. `manage-column.ts` does not export the union directly, so this
// exercises it via a fresh discriminated union with the identical shape it
// documents — the batch cap and per-kind rejection are the two properties
// under test.
import { z } from "zod";
import { columnKindSchema } from "@/lib/validations/boards";

const uuid = z.string().uuid();
const name = z.string().trim().min(1).max(100);
const settings = z.record(z.string(), z.unknown());
const manageColumnAction = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    boardId: uuid,
    columns: z
      .array(
        z.object({
          kind: columnKindSchema,
          name: name.optional(),
          settings: settings.optional(),
        }),
      )
      .min(1)
      .max(50),
  }),
  z.object({ action: z.literal("rename"), columnId: uuid, name }),
  z.object({ action: z.literal("configure"), columnId: uuid, settings }),
  z.object({
    action: z.literal("reorder"),
    columnId: uuid,
    position: z.number(),
  }),
  z.object({
    action: z.literal("resize"),
    columnId: uuid,
    width: z.number().int().min(80).max(1200),
  }),
  z.object({ action: z.literal("delete"), columnId: uuid }),
  z.object({
    action: z.literal("remove_option"),
    columnId: uuid,
    optionId: z.string().min(1),
  }),
]);

const BOARD_ID = "11111111-1111-4111-8111-111111111111";

describe("manage_column input validation", () => {
  it("rejects a batch of 51 columns", () => {
    const columns = Array.from({ length: 51 }, () => ({ kind: "text" }));
    const r = parseAction(manageColumnAction, {
      action: "create",
      boardId: BOARD_ID,
      columns,
    });
    expect(r.ok).toBe(false);
  });

  it("accepts a batch of 50 columns", () => {
    const columns = Array.from({ length: 50 }, () => ({ kind: "text" }));
    const r = parseAction(manageColumnAction, {
      action: "create",
      boardId: BOARD_ID,
      columns,
    });
    expect(r.ok).toBe(true);
  });
});

import { createColumnsCore } from "@/lib/boards/core/column";

function fakeClient(orgId: string) {
  return {
    from(_table: string) {
      return {
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: () => ({
                maybeSingle: async () => ({
                  data: { position: 1 },
                  error: null,
                }),
              }),
            }),
            maybeSingle: async () => ({ data: { org_id: orgId }, error: null }),
          }),
        }),
        insert: () => ({
          select: () => ({
            single: async () => ({
              data: { id: "c1", kind: "text" },
              error: null,
            }),
          }),
        }),
      };
    },
  } as never;
}

describe("manage_column create: per-kind settings validation", () => {
  it("reports a relation column with no target_board_id as a per-entry error, not a written row", async () => {
    const r = await createColumnsCore(fakeClient("o1"), {
      boardId: BOARD_ID,
      columns: [{ kind: "relation", settings: { allow_multiple: true } }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.created).toHaveLength(0);
      expect(r.data.errors).toHaveLength(1);
      expect(r.data.errors[0]!.index).toBe(0);
    }
  });
});

// F1 (final whole-branch review): `createColumnsCore` returns `{ ok: true }`
// even when EVERY entry in the batch failed — `toToolResult` only inspects
// `ActionResult.ok`, so that shape alone would report a total failure to the
// model as an ordinary success. `manage-column.ts`'s `create` branch adds the
// `isError` check on top; these tests exercise it through the real descriptor
// `invoke`, matching `create_item`'s semantics exactly (see create-item.ts).
function fakeColumnCreateInsertClient(
  opts: { failAt?: number[]; failAll?: boolean } = {},
) {
  let insertCount = 0;
  return {
    from(_table: string) {
      return {
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            }),
            maybeSingle: async () => ({ data: { org_id: "o1" }, error: null }),
          }),
        }),
        insert: () => ({
          select: () => ({
            single: async () => {
              const index = insertCount++;
              if (opts.failAll || opts.failAt?.includes(index)) {
                return {
                  data: null,
                  error: { message: `entry ${index} failed` },
                };
              }
              return {
                data: { id: `c${index}`, kind: "text" },
                error: null,
              };
            },
          }),
        }),
      };
    },
  } as never;
}

describe("manage_column create: batch isError semantics (F1)", () => {
  it("sets isError when every entry in the batch fails", async () => {
    const client = fakeColumnCreateInsertClient({ failAll: true });
    const r = await manageColumnDescriptor.invoke(
      { getClient: async () => client, actorId: "u1" },
      {
        action: "create",
        boardId: BOARD_ID,
        columns: [{ kind: "text" }, { kind: "text" }],
      },
    );
    expect(r.isError).toBe(true);
  });

  it("leaves isError undefined when only some entries fail", async () => {
    const client = fakeColumnCreateInsertClient({ failAt: [0] });
    const r = await manageColumnDescriptor.invoke(
      { getClient: async () => client, actorId: "u1" },
      {
        action: "create",
        boardId: BOARD_ID,
        columns: [{ kind: "text" }, { kind: "text" }],
      },
    );
    expect(r.isError).toBeUndefined();
  });

  it("leaves isError undefined when every entry succeeds", async () => {
    const client = fakeColumnCreateInsertClient({});
    const r = await manageColumnDescriptor.invoke(
      { getClient: async () => client, actorId: "u1" },
      {
        action: "create",
        boardId: BOARD_ID,
        columns: [{ kind: "text" }],
      },
    );
    expect(r.isError).toBeUndefined();
  });
});
