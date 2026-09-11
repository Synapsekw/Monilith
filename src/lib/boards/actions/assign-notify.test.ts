import { describe, it, expect, vi, beforeEach } from "vitest";
import { notifyNewAssignees } from "./assign-notify";

const ORG = "org";
const BOARD = "board";
const ITEM = "11111111-1111-4111-8111-111111111111";
const ACTOR = "99999999-9999-4999-8999-999999999999";
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function makeClient(notifyError?: { message: string } | null) {
  const insert = vi.fn().mockResolvedValue({ error: notifyError ?? null });
  const client = { from: (_table: string) => ({ insert }) };
  return { client, insert };
}

beforeEach(() => vi.restoreAllMocks());

describe("notifyNewAssignees", () => {
  it("inserts one row per newly-added id, excluding the actor", async () => {
    const { client, insert } = makeClient();
    await notifyNewAssignees(client as never, {
      orgId: ORG,
      boardId: BOARD,
      itemId: ITEM,
      actorId: ACTOR,
      prior: [A],
      next: [A, B, ACTOR],
    });

    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledWith([
      {
        org_id: ORG,
        recipient_id: B,
        actor_id: ACTOR,
        kind: "assigned",
        board_id: BOARD,
        item_id: ITEM,
      },
    ]);
  });

  it("does not insert when nothing was added", async () => {
    const { client, insert } = makeClient();
    await notifyNewAssignees(client as never, {
      orgId: ORG,
      boardId: BOARD,
      itemId: ITEM,
      actorId: ACTOR,
      prior: [A],
      next: [A],
    });
    expect(insert).not.toHaveBeenCalled();
  });

  it("skips the insert and logs when there is no actor", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client, insert } = makeClient();
    await notifyNewAssignees(client as never, {
      orgId: ORG,
      boardId: BOARD,
      itemId: ITEM,
      actorId: null,
      prior: [],
      next: [A],
    });
    expect(insert).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalledWith(
      "[notifications] assigned fan-out failed",
      expect.objectContaining({ recipients: 1, error: "no actor" }),
    );
  });

  it("logs, but never throws, when the insert errors", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = makeClient({ message: "insert denied" });
    await expect(
      notifyNewAssignees(client as never, {
        orgId: ORG,
        boardId: BOARD,
        itemId: ITEM,
        actorId: ACTOR,
        prior: [],
        next: [A],
      }),
    ).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledWith(
      "[notifications] assigned fan-out failed",
      expect.objectContaining({
        itemId: ITEM,
        recipients: 1,
        error: "insert denied",
      }),
    );
  });
});
