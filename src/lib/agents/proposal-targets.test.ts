import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { ProposalRow } from "./proposals-db";
import { withResolvedTargets } from "./proposal-targets";

/**
 * `Rename an item to "X".` — WHICH item? Every id in a proposal's payload is
 * MODEL-CHOSEN, and under prompt injection the attacker chooses it. The
 * summary is pure by design and cannot say; this module is where the owner
 * finds out, on their OWN RLS-scoped client.
 */

const ITEM = "11111111-1111-4111-8111-111111111111";
const OTHER_ITEM = "11111111-1111-4111-8111-111111111112";
const BOARD = "22222222-2222-4222-8222-222222222222";
const GROUP = "33333333-3333-4333-8333-333333333333";
const COLUMN = "44444444-4444-4444-8444-444444444444";
const OTHER_COLUMN = "44444444-4444-4444-8444-444444444445";
const THIRD_COLUMN = "44444444-4444-4444-8444-444444444446";

type Read = { table: string; ids: string[]; limit: number };

/**
 * A client holding rows per table. `reads` records every query so a test can
 * assert this is ONE bounded, indexed read per KIND for the whole page —
 * working agreement #5 — rather than one query per card.
 */
function fakeClient(
  tables: Partial<Record<string, { id: string; name: string }[]>>,
  failing: string[] = [],
) {
  const reads: Read[] = [];
  const client = {
    from(table: string) {
      const builder = {
        select: () => builder,
        in(_col: string, ids: string[]) {
          builder.ids = ids;
          return builder;
        },
        ids: [] as string[],
        limit: async (n: number) => {
          reads.push({ table, ids: builder.ids, limit: n });
          if (failing.includes(table))
            return { data: null, error: { message: "boom" } };
          const rows = (tables[table] ?? []).filter((r) =>
            builder.ids.includes(r.id),
          );
          return { data: rows, error: null };
        },
      };
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient<Database>, reads };
}

function row(over: Partial<ProposalRow> & { toolName: string }): ProposalRow {
  return {
    id: `p-${over.toolName}-${JSON.stringify(over.input ?? {})}`,
    userAgentId: "agent-1",
    runId: "run-1",
    orgId: "org-1",
    ownerId: "owner-1",
    capability: "board.write",
    toolCallId: "call-1",
    input: {},
    summary: "…",
    status: "pending",
    expiresAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    result: null,
    ...over,
  };
}

describe("withResolvedTargets", () => {
  it("names the item an update would rename", async () => {
    const { client } = fakeClient({
      items: [{ id: ITEM, name: "Q3 roadmap" }],
    });
    const [p] = await withResolvedTargets(client, [
      row({ toolName: "update_item", input: { itemId: ITEM, name: "X" } }),
    ]);
    expect(p!.target).toEqual({ kind: "item", name: "Q3 roadmap" });
  });

  it("names the board an automation would be filed on", async () => {
    const { client } = fakeClient({
      boards: [{ id: BOARD, name: "Marketing" }],
    });
    const [p] = await withResolvedTargets(client, [
      row({
        toolName: "manage_automation",
        capability: "automation.create",
        // `manage_automation` is a grouped-dispatch tool: its `scope` is a
        // per-action Record, so `scopeFor` needs the row's own `action` to
        // resolve `create` → `boardId`.
        input: { action: "create", boardId: BOARD },
      }),
    ]);
    expect(p!.target).toEqual({ kind: "board", name: "Marketing" });
  });

  it("names the group an item would be created in", async () => {
    const { client } = fakeClient({ groups: [{ id: GROUP, name: "Backlog" }] });
    const [p] = await withResolvedTargets(client, [
      row({ toolName: "create_item", input: { groupId: GROUP, name: "New" } }),
    ]);
    expect(p!.target).toEqual({ kind: "group", name: "Backlog" });
  });

  it("names the column a manage_column proposal targets", async () => {
    const { client } = fakeClient({
      columns: [{ id: COLUMN, name: "Status" }],
    });
    const [p] = await withResolvedTargets(client, [
      row({
        toolName: "manage_column",
        input: { action: "rename", columnId: COLUMN, name: "New name" },
      }),
    ]);
    expect(p!.target).toEqual({ kind: "column", name: "Status" });
  });

  // The scope of a dispatch tool depends on its action: create takes a
  // boardId, rename takes a columnId. Reading descriptor.scope directly
  // would see a Record and resolve nothing.
  it("resolves the column target from the action, not the tool", async () => {
    const { client } = fakeClient({ boards: [{ id: BOARD, name: "Roadmap" }] });
    const [p] = await withResolvedTargets(client, [
      row({
        toolName: "manage_column",
        input: { action: "create", boardId: BOARD, name: "New col" },
      }),
    ]);
    expect(p!.target).toEqual({ kind: "board", name: "Roadmap" });
  });

  // Working agreement #5: one bounded read per kind for a whole page of
  // proposals, never one read per card.
  it("issues one read for a page of manage_column proposals", async () => {
    const { client, reads } = fakeClient({
      columns: [
        { id: COLUMN, name: "Status" },
        { id: OTHER_COLUMN, name: "Owner" },
        { id: THIRD_COLUMN, name: "Priority" },
      ],
    });
    await withResolvedTargets(client, [
      row({
        toolName: "manage_column",
        input: { action: "rename", columnId: COLUMN, name: "x" },
      }),
      row({
        toolName: "manage_column",
        input: { action: "delete", columnId: OTHER_COLUMN },
      }),
      row({
        toolName: "manage_column",
        input: { action: "resize", columnId: THIRD_COLUMN, width: 200 },
      }),
    ]);
    expect(reads.filter((t) => t.table === "columns")).toHaveLength(1);
  });

  // The whole point of resolving on the READ side: one bounded read per kind
  // for the page, never one per card (working agreement #5).
  it("issues ONE bounded read per kind for the whole page", async () => {
    const { client, reads } = fakeClient({
      items: [
        { id: ITEM, name: "First" },
        { id: OTHER_ITEM, name: "Second" },
      ],
      boards: [{ id: BOARD, name: "Marketing" }],
    });
    const out = await withResolvedTargets(client, [
      row({ toolName: "update_item", input: { itemId: ITEM } }),
      row({ toolName: "attach_file", input: { itemId: OTHER_ITEM } }),
      row({ toolName: "create_file", input: { itemId: ITEM } }),
      row({
        toolName: "manage_automation",
        input: { action: "create", boardId: BOARD },
      }),
    ]);
    expect(reads).toHaveLength(2);
    expect(reads.map((r) => r.table).sort()).toEqual(["boards", "items"]);
    // Deduped, and the limit bounds the read to exactly what was asked for.
    const items = reads.find((r) => r.table === "items")!;
    expect(items.ids.sort()).toEqual([ITEM, OTHER_ITEM].sort());
    expect(items.limit).toBe(2);
    expect(out.map((p) => p.target?.name)).toEqual([
      "First",
      "Second",
      "First",
      "Marketing",
    ]);
  });

  it("costs nothing when no proposal addresses an object", async () => {
    const { client, reads } = fakeClient({});
    const out = await withResolvedTargets(client, [
      // `log_time_allocation` is scope `itemId` but may log against a category
      // instead — an optional id the model omitted addresses no item.
      row({
        toolName: "log_time_allocation",
        capability: "time.log",
        input: { category: "admin", date: "2026-08-01", secs: 60 },
      }),
    ]);
    expect(reads).toHaveLength(0);
    expect(out[0]!.target).toBeNull();
  });

  // Honest degradation #1: the read SUCCEEDED and the row was not in it. The
  // owner is told, rather than left reading a sentence that looks complete.
  it("says so when the object is gone or invisible to this reader", async () => {
    const { client } = fakeClient({ items: [] });
    const [p] = await withResolvedTargets(client, [
      row({ toolName: "update_item", input: { itemId: ITEM } }),
    ]);
    expect(p!.target).toEqual({ kind: "item", name: null });
  });

  // Honest degradation #2: the read FAILED, so no claim is made at all.
  // Telling the owner their item was deleted because Postgres blinked would be
  // worse than the id-less sentence they had before.
  it("makes no claim at all when the resolving read fails", async () => {
    const { client } = fakeClient({ items: [{ id: ITEM, name: "Q3" }] }, [
      "items",
    ]);
    const [p] = await withResolvedTargets(client, [
      row({ toolName: "update_item", input: { itemId: ITEM } }),
    ]);
    expect(p!.target).toBeNull();
  });

  // A proposal outlives the tool that produced it.
  it("makes no claim for a tool that no longer exists", async () => {
    const { client, reads } = fakeClient({});
    const [p] = await withResolvedTargets(client, [
      row({ toolName: "gone_tool", input: { itemId: ITEM } }),
    ]);
    expect(p!.target).toBeNull();
    expect(reads).toHaveLength(0);
  });

  // The shared projection still applies: a card never receives the payload.
  it("keeps input and result off the projected row", async () => {
    const { client } = fakeClient({ items: [{ id: ITEM, name: "Q3" }] });
    const [p] = await withResolvedTargets(client, [
      row({
        toolName: "update_item",
        input: { itemId: ITEM, name: "a whole document body" },
      }),
    ]);
    expect(p).not.toHaveProperty("input");
    expect(p).not.toHaveProperty("result");
  });
});
