import { beforeEach, describe, expect, it, vi } from "vitest";
import * as z from "zod";

// The real core runs: these tests prove the tool reaches `item_updates` and
// `notifications` through `addUpdateCore`, the function the `addUpdate` Server
// Action calls, with the caller as author.
import {
  addCommentDescriptor,
  addCommentHandler,
  COMMENT_MAX_CHARS,
  COMMENT_MAX_MENTIONS,
} from "./add-comment";
import * as core from "@/lib/collaboration/update-core";

const ITEM = "11111111-1111-4111-8111-111111111111";
const UPD = "22222222-2222-4222-8222-222222222222";
const ME = "99999999-9999-4999-8999-999999999999";
const ANA = "33333333-3333-4333-8333-333333333333";
const MONO = "44444444-4444-4444-8444-444444444444";

type Insert = { table: string; row: unknown };

/** The call shapes `addUpdateCore` issues, recording every insert. */
function client(opts: {
  item?: { org_id: string; board_id: string } | null;
  monos?: { user_id: string; owner_id: string }[];
  insertError?: string;
}) {
  const inserts: Insert[] = [];
  const item =
    opts.item === undefined ? { org_id: "o1", board_id: "b1" } : opts.item;
  const from = (table: string) => {
    if (table === "items")
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: item, error: null }),
          }),
        }),
      };
    if (table === "monos")
      return {
        select: () => ({
          eq: () => ({
            in: async () => ({ data: opts.monos ?? [], error: null }),
          }),
        }),
      };
    if (table === "item_updates")
      return {
        insert: (row: unknown) => {
          inserts.push({ table, row });
          return {
            select: () => ({
              single: async () =>
                opts.insertError
                  ? { data: null, error: { message: opts.insertError } }
                  : { data: { id: UPD }, error: null },
            }),
          };
        },
      };
    if (table === "notifications")
      return {
        insert: async (row: unknown) => {
          inserts.push({ table, row });
          return { error: null };
        },
      };
    throw new Error(`unexpected table ${table}`);
  };
  return { supabase: { from } as never, inserts };
}

beforeEach(() => vi.restoreAllMocks());

describe("addCommentHandler", () => {
  it("posts through addUpdateCore as the caller and returns the comment id", async () => {
    const spy = vi.spyOn(core, "addUpdateCore");
    const { supabase, inserts } = client({});
    const getClient = vi.fn(async () => supabase);
    const result = await addCommentHandler(getClient, ME, {
      itemId: ITEM,
      text: "  Waiting on legal.  ",
    });
    expect(getClient).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(
      supabase,
      { itemId: ITEM, text: "Waiting on legal.", mentions: [] },
      ME,
    );
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0]!.text)).toEqual({
      commentId: UPD,
      posted: true,
    });
    expect(inserts).toEqual([
      {
        table: "item_updates",
        row: {
          org_id: "o1",
          board_id: "b1",
          item_id: ITEM,
          author_id: ME,
          body: { text: "Waiting on legal.", mentions: [] },
          body_text: "Waiting on legal.",
        },
      },
    ]);
  });

  it("notifies each mentioned person once, never the author and never a Mono", async () => {
    const { supabase, inserts } = client({
      monos: [{ user_id: MONO, owner_id: "someone-else" }],
    });
    await addCommentHandler(async () => supabase, ME, {
      itemId: ITEM,
      text: "Ana, can you look?",
      mentionUserIds: [ANA, ANA, ME, MONO],
    });
    const notif = inserts.find((i) => i.table === "notifications");
    expect(notif?.row).toEqual([
      {
        org_id: "o1",
        recipient_id: ANA,
        actor_id: ME,
        kind: "mention",
        board_id: "b1",
        item_id: ITEM,
        update_id: UPD,
      },
    ]);
    const update = inserts.find((i) => i.table === "item_updates")!.row as {
      body: { mentions: unknown[] };
    };
    expect(update.body.mentions).toEqual([
      { kind: "user", userId: ANA },
      { kind: "user", userId: ME },
    ]);
  });

  it("reports an item the caller cannot see as an error and writes nothing", async () => {
    const { supabase, inserts } = client({ item: null });
    const result = await addCommentHandler(async () => supabase, ME, {
      itemId: ITEM,
      text: "hello",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toBe("Item not found.");
    expect(inserts).toEqual([]);
  });

  it("surfaces a refused insert (RLS) as an error, never as posted", async () => {
    const { supabase } = client({ insertError: "permission denied" });
    const result = await addCommentHandler(async () => supabase, ME, {
      itemId: ITEM,
      text: "hello",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("permission denied");
  });

  it("rejects malformed input before opening a client", async () => {
    const getClient = vi.fn();
    const result = await addCommentHandler(getClient as never, ME, {
      itemId: "not-a-uuid",
      text: "hello",
    });
    expect(result.isError).toBe(true);
    expect(getClient).not.toHaveBeenCalled();
  });
});

describe("addCommentDescriptor", () => {
  const schema = z.object(addCommentDescriptor.inputSchema);

  it("is a board write addressed by item, so the assistant stages it", () => {
    expect(addCommentDescriptor.capability).toBe("board.write");
    expect(addCommentDescriptor.scope).toBe("itemId");
  });

  it("bounds the text and the mentions", () => {
    expect(schema.safeParse({ itemId: ITEM, text: "" }).success).toBe(false);
    expect(
      schema.safeParse({
        itemId: ITEM,
        text: "x".repeat(COMMENT_MAX_CHARS + 1),
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        itemId: ITEM,
        text: "x",
        mentionUserIds: Array.from(
          { length: COMMENT_MAX_MENTIONS + 1 },
          () => ANA,
        ),
      }).success,
    ).toBe(false);
  });

  it("accepts null mentions as absent (strict function-calling callers)", async () => {
    expect(
      schema.safeParse({ itemId: ITEM, text: "x", mentionUserIds: null })
        .success,
    ).toBe(true);
    const { supabase, inserts } = client({});
    const result = await addCommentDescriptor.invoke(
      { getClient: async () => supabase, actorId: ME },
      { itemId: ITEM, text: "x", mentionUserIds: null },
    );
    expect(result.isError).toBeUndefined();
    expect(inserts).toHaveLength(1);
  });
});
