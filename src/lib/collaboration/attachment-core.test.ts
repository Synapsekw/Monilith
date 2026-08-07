import { describe, expect, it } from "vitest";
import { attachmentPathPrefix, createAttachmentCore } from "./attachment-core";

const ACTOR = "99999999-9999-4999-8999-999999999999";
const ITEM = "11111111-1111-4111-8111-111111111111";
const OK_ITEM = { data: { org_id: "o1", board_id: "b1" }, error: null };

/** Structural fake of the three call shapes the core touches. */
function makeClient(opts: {
  item?: { data: unknown; error: unknown };
  column?: { data: unknown };
  insert?: { data: unknown; error: unknown };
}) {
  const inserted: unknown[] = [];
  const client = {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve(
              table === "items"
                ? (opts.item ?? OK_ITEM)
                : (opts.column ?? {
                    data: { id: "col1", kind: "files", board_id: "b1" },
                  }),
            ),
        }),
      }),
      insert: (row: unknown) => {
        inserted.push(row);
        return {
          select: () => ({
            single: () =>
              Promise.resolve(
                opts.insert ?? { data: { id: "a1" }, error: null },
              ),
          }),
        };
      },
    }),
  };
  return { client: client as never, inserted };
}

describe("attachmentPathPrefix", () => {
  it("nests the column id for a Files-column attachment", () => {
    expect(
      attachmentPathPrefix({
        orgId: "o1",
        boardId: "b1",
        itemId: "i1",
        columnId: "c1",
      }),
    ).toBe("o1/b1/i1/c1/");
  });

  it("omits the column segment for an item-level attachment", () => {
    expect(
      attachmentPathPrefix({ orgId: "o1", boardId: "b1", itemId: "i1" }),
    ).toBe("o1/b1/i1/");
  });
});

describe("createAttachmentCore", () => {
  const base = {
    itemId: ITEM,
    fileName: "report.csv",
    mimeType: "text/csv",
    sizeBytes: 120,
  };

  it("inserts the row with the injected actor as uploaded_by", async () => {
    const { client, inserted } = makeClient({});
    const res = await createAttachmentCore(
      client,
      { ...base, storagePath: `o1/b1/${ITEM}/abc-report.csv` },
      ACTOR,
    );
    expect(res).toEqual({ ok: true, data: { attachmentId: "a1" } });
    expect(inserted[0]).toEqual({
      org_id: "o1",
      board_id: "b1",
      item_id: ITEM,
      column_id: null,
      uploaded_by: ACTOR,
      storage_path: `o1/b1/${ITEM}/abc-report.csv`,
      file_name: "report.csv",
      mime_type: "text/csv",
      size_bytes: 120,
    });
  });

  it("rejects a storage path outside this item (path-spoof guard)", async () => {
    const { client, inserted } = makeClient({});
    const res = await createAttachmentCore(
      client,
      { ...base, storagePath: `other-org/b1/${ITEM}/abc-report.csv` },
      ACTOR,
    );
    expect(res).toEqual({
      ok: false,
      error: "Storage path does not match this item.",
    });
    expect(inserted).toHaveLength(0);
  });

  it("rejects a column that is not a files column on this item's board", async () => {
    const { client, inserted } = makeClient({
      column: { data: { id: "col1", kind: "text", board_id: "b1" } },
    });
    const res = await createAttachmentCore(
      client,
      {
        ...base,
        columnId: "col1",
        storagePath: `o1/b1/${ITEM}/col1/abc-report.csv`,
      },
      ACTOR,
    );
    expect(res).toEqual({ ok: false, error: "Invalid file column." });
    expect(inserted).toHaveLength(0);
  });

  it("returns a failure when the item is not visible", async () => {
    const { client } = makeClient({ item: { data: null, error: null } });
    const res = await createAttachmentCore(
      client,
      { ...base, storagePath: `o1/b1/${ITEM}/abc-report.csv` },
      ACTOR,
    );
    expect(res).toEqual({ ok: false, error: "Item not found." });
  });
});
