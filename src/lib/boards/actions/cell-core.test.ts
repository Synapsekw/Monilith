import { describe, it, expect, vi, beforeEach } from "vitest";
import { upsertCellCore } from "./cell-core";

const ITEM = "11111111-1111-4111-8111-111111111111";
const COL = "22222222-2222-4222-8222-222222222222";
const ACTOR = "99999999-9999-4999-8999-999999999999";
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

type Ctx = {
  client: unknown;
  upsert: ReturnType<typeof vi.fn>;
  notify: ReturnType<typeof vi.fn>;
  authTouched: () => boolean;
};

/** A minimal chainable Supabase stub with an auth tripwire (spec §3.1). */
function makeClient(opts: {
  kind: string;
  prior?: { userIds: string[] } | null;
  notifyError?: { message: string } | null;
  itemBoardId?: string;
  columnMissing?: boolean;
}): Ctx {
  let touchedAuth = false;
  const upsert = vi.fn().mockResolvedValue({ error: null });
  const notify = vi.fn().mockResolvedValue({ error: opts.notifyError ?? null });
  const read = (table: string) =>
    table === "columns"
      ? {
          data: opts.columnMissing
            ? null
            : { org_id: "org", board_id: "board", kind: opts.kind },
          error: null,
        }
      : table === "items"
        ? {
            data: { board_id: opts.itemBoardId ?? "board" },
            error: null,
          }
        : { data: opts.prior ? { value: opts.prior } : null, error: null };
  const client = {
    from: (table: string) => {
      type Chain = { eq: () => Chain; maybeSingle: () => Promise<unknown> };
      const chain: Chain = {
        eq: () => chain,
        maybeSingle: async () => read(table),
      };
      return { select: () => chain, upsert, insert: notify };
    },
    get auth() {
      touchedAuth = true;
      return { getUser: async () => ({ data: { user: null } }) };
    },
  };
  return { client, upsert, notify, authTouched: () => touchedAuth };
}

const call = (ctx: Ctx, value: unknown, actorId: string | null = ACTOR) =>
  upsertCellCore(
    ctx.client as never,
    { itemId: ITEM, columnId: COL, value },
    actorId,
  );

beforeEach(() => vi.restoreAllMocks());

describe("upsertCellCore", () => {
  it("notifies only newly-added members, excluding the actor", async () => {
    const ctx = makeClient({ kind: "people", prior: { userIds: [A] } });
    const res = await call(ctx, { userIds: [A, B, ACTOR] });

    expect(res).toEqual({ ok: true, data: undefined });
    expect(ctx.upsert).toHaveBeenCalledTimes(1);
    expect(ctx.notify).toHaveBeenCalledTimes(1);
    expect(ctx.notify).toHaveBeenCalledWith([
      {
        org_id: "org",
        recipient_id: B,
        actor_id: ACTOR,
        kind: "assigned",
        board_id: "board",
        item_id: ITEM,
      },
    ]);
  });

  it("does not notify when no member was added", async () => {
    const ctx = makeClient({ kind: "people", prior: { userIds: [A] } });
    const res = await call(ctx, { userIds: [A] });

    expect(res).toEqual({ ok: true, data: undefined });
    expect(ctx.notify).not.toHaveBeenCalled();
  });

  it("never reads ambient auth, and skips the fan-out for a non-people column", async () => {
    const ctx = makeClient({ kind: "text" });
    const res = await call(ctx, { text: "hi" });

    expect(res).toEqual({ ok: true, data: undefined });
    expect(ctx.notify).not.toHaveBeenCalled();
    expect(ctx.authTouched()).toBe(false);
  });

  it("skips the insert and logs when there is no actor", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ctx = makeClient({ kind: "people" });
    const res = await call(ctx, { userIds: [A] }, null);

    expect(res).toEqual({ ok: true, data: undefined });
    expect(ctx.notify).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalledWith(
      "[notifications] assigned fan-out failed",
      expect.objectContaining({ recipients: 1, error: "no actor" }),
    );
  });

  it("returns ok but logs when the notification insert fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ctx = makeClient({
      kind: "people",
      notifyError: { message: "insert denied" },
    });
    const res = await call(ctx, { userIds: [A] });

    expect(res).toEqual({ ok: true, data: undefined });
    expect(spy).toHaveBeenCalledWith(
      "[notifications] assigned fan-out failed",
      expect.objectContaining({
        itemId: ITEM,
        recipients: 1,
        error: "insert denied",
      }),
    );
  });

  it("guards: missing column, cross-board item, invalid value", async () => {
    const missing = makeClient({ kind: "text", columnMissing: true });
    expect(await call(missing, { text: "x" })).toEqual({
      ok: false,
      error: "Column not found.",
    });

    const crossBoard = makeClient({ kind: "text", itemBoardId: "other" });
    expect(await call(crossBoard, { text: "x" })).toEqual({
      ok: false,
      error: "Item and column belong to different boards.",
    });
    expect(crossBoard.upsert).not.toHaveBeenCalled();

    const badValue = makeClient({ kind: "people" });
    const res = await call(badValue, { userIds: "not-an-array" });
    expect(res.ok).toBe(false);
    expect(badValue.upsert).not.toHaveBeenCalled();
  });
});
