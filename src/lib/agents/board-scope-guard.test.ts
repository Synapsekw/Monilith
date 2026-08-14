import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { ToolDescriptor, ToolScope } from "@/lib/mcp/tools/descriptor";
import { ALL_TOOL_DESCRIPTORS } from "@/lib/mcp/tools/catalog";
import type { BoardScope } from "./agent-config";
import { isBoardInScope, resolveTargetBoardId } from "./board-scope-guard";

const BOARD_1 = "11111111-1111-4111-8111-111111111111";
const BOARD_2 = "22222222-2222-4222-8222-222222222222";
const ITEM = "33333333-3333-4333-8333-333333333333";
const GROUP = "44444444-4444-4444-8444-444444444444";

function descriptor(scope: ToolScope): ToolDescriptor {
  return {
    name: `probe_${scope}`,
    title: "Probe",
    description: "Probe",
    inputSchema: { boardId: z.string().optional() },
    capability: null,
    scope,
    invoke: async () => ({ content: [{ type: "text", text: "ok" }] }),
  };
}

/**
 * A chainable stand-in for the two single-row reads this module performs
 * (`items` → org/board via `resolveItemScope`, `groups` → board_id). Cast once,
 * here, rather than in the module under test: nothing in production takes a
 * client this narrow.
 */
function client(rows: Record<string, Record<string, unknown> | null>) {
  const from = vi.fn((table: string) => ({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({ data: rows[table] ?? null, error: null }),
      }),
    }),
  }));
  return { from } as unknown as SupabaseClient<Database>;
}

/** A client that fails the test if it is touched at all. */
const noClient = new Proxy(
  {},
  {
    get() {
      throw new Error("resolveTargetBoardId must not query for this scope");
    },
  },
) as SupabaseClient<Database>;

describe("isBoardInScope", () => {
  it("admits any board when the scope is `all`", () => {
    expect(isBoardInScope({ mode: "all" }, BOARD_1)).toBe(true);
  });

  it("admits a listed board and refuses an unlisted one", () => {
    const scope: BoardScope = { mode: "list", boardIds: [BOARD_1] };
    expect(isBoardInScope(scope, BOARD_1)).toBe(true);
    expect(isBoardInScope(scope, BOARD_2)).toBe(false);
  });

  // A `scope: "none"` tool — and `log_time_allocation` called with a category
  // instead of an item — addresses NO board, so board scope has nothing to
  // refuse. RLS remains the boundary for these calls, as descriptor.ts states.
  it("admits a null board even under a list scope", () => {
    expect(isBoardInScope({ mode: "list", boardIds: [BOARD_1] }, null)).toBe(
      true,
    );
  });
});

describe("resolveTargetBoardId", () => {
  it("returns null for a `none` tool without querying", async () => {
    expect(
      await resolveTargetBoardId(noClient, descriptor("none"), {
        reportId: "r1",
      }),
    ).toBeNull();
  });

  it("reads `boardId` straight off the input without querying", async () => {
    expect(
      await resolveTargetBoardId(noClient, descriptor("boardId"), {
        boardId: BOARD_1,
      }),
    ).toBe(BOARD_1);
  });

  it("resolves an itemId through the item's board", async () => {
    const c = client({ items: { org_id: "o1", board_id: BOARD_2 } });
    expect(
      await resolveTargetBoardId(c, descriptor("itemId"), { itemId: ITEM }),
    ).toBe(BOARD_2);
  });

  it("resolves a groupId through the group's board", async () => {
    const c = client({ groups: { board_id: BOARD_2 } });
    expect(
      await resolveTargetBoardId(c, descriptor("groupId"), { groupId: GROUP }),
    ).toBe(BOARD_2);
  });

  // log_time_allocation's itemId is OPTIONAL — a call may log against a
  // category instead. No item means no board to resolve, and `isBoardInScope`
  // then admits it (see above), which is correct: the call addresses no board.
  it("returns null when an itemId-scoped tool is called without one", async () => {
    expect(
      await resolveTargetBoardId(noClient, descriptor("itemId"), {
        category: "Admin",
        secs: 60,
      }),
    ).toBeNull();
    expect(
      await resolveTargetBoardId(noClient, descriptor("groupId"), {}),
    ).toBeNull();
  });

  // The lookup runs on the OWNER's client, so an item the owner cannot see is
  // invisible here too — it resolves to null, the call proceeds, and RLS
  // refuses it inside the handler. The guard narrows a preference; it is not
  // the security boundary and must not pretend to be one.
  it("returns null when the item is not visible to the owner", async () => {
    const c = client({ items: null });
    expect(
      await resolveTargetBoardId(c, descriptor("itemId"), { itemId: ITEM }),
    ).toBeNull();
  });

  it("ignores a non-string id rather than coercing it", async () => {
    expect(
      await resolveTargetBoardId(noClient, descriptor("boardId"), {
        boardId: 42,
      }),
    ).toBeNull();
  });

  // Every catalog scope must be handled: a new ToolScope value would otherwise
  // fall through to `null` and silently opt its tools out of board scope.
  it("handles every scope the catalog actually uses", async () => {
    const scopes = new Set(ALL_TOOL_DESCRIPTORS.map((d) => d.scope));
    for (const scope of scopes) {
      const c = client({
        items: { org_id: "o1", board_id: BOARD_1 },
        groups: { board_id: BOARD_1 },
      });
      await expect(
        resolveTargetBoardId(c, descriptor(scope), {
          boardId: BOARD_1,
          itemId: ITEM,
          groupId: GROUP,
        }),
      ).resolves.toBe(scope === "none" ? null : BOARD_1);
    }
  });
});
