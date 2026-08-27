import { describe, expect, it } from "vitest";
import { makeFakeClient } from "@/test/mcp-fake-client";
import {
  attachmentPathPrefix,
  createAttachmentCore,
  MAX_ATTACHMENT_BYTES,
  uploadAndRegisterAttachment,
} from "./attachment-core";

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

const COLUMN = "22222222-2222-4222-8222-222222222222";
const bytes = (s: string) => new TextEncoder().encode(s);

/** `makeFakeClient` hands back `getClient`; this helper resolves it once, the
 *  way a tool handler does. */
async function client(spec: Parameters<typeof makeFakeClient>[0] = {}) {
  const fake = makeFakeClient(spec);
  return { supabase: await fake.getClient(), calls: fake.calls };
}

describe("uploadAndRegisterAttachment", () => {
  it("uploads then registers, and reports the server's own byte count", async () => {
    const { supabase, calls } = await client();
    const r = await uploadAndRegisterAttachment(
      supabase,
      {
        itemId: ITEM,
        fileName: "report.pdf",
        mimeType: "application/pdf",
        bytes: bytes("hello world"),
      },
      ACTOR,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.sizeBytes).toBe(11);
    expect(r.data.attachmentId).toBe("a1");
    expect(calls.storage.map((s) => s.op)).toEqual(["upload"]);
    expect(calls.attachments[0]).toMatchObject({
      mime_type: "application/pdf",
      size_bytes: 11,
      uploaded_by: ACTOR,
    });
  });

  it("removes the uploaded object when registering fails", async () => {
    const { supabase, calls } = await client({
      attachmentInsert: { data: null, error: { message: "denied" } },
    });
    const r = await uploadAndRegisterAttachment(
      supabase,
      {
        itemId: ITEM,
        fileName: "a.pdf",
        mimeType: "application/pdf",
        bytes: bytes("hi"),
      },
      ACTOR,
    );
    expect(r.ok).toBe(false);
    expect(calls.storage.map((s) => s.op)).toEqual(["upload", "remove"]);
  });

  it("nests a column-scoped object one level deeper", async () => {
    const { supabase } = await client();
    const r = await uploadAndRegisterAttachment(
      supabase,
      {
        itemId: ITEM,
        columnId: COLUMN,
        fileName: "a.pdf",
        mimeType: "application/pdf",
        bytes: bytes("hi"),
      },
      ACTOR,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.storagePath).toContain(`/${ITEM}/${COLUMN}/`);
  });

  it("refuses empty bytes before touching Storage", async () => {
    const { supabase, calls } = await client();
    const r = await uploadAndRegisterAttachment(
      supabase,
      {
        itemId: ITEM,
        fileName: "a.pdf",
        mimeType: "application/pdf",
        bytes: new Uint8Array(0),
      },
      ACTOR,
    );
    expect(r.ok).toBe(false);
    expect(calls.storage).toHaveLength(0);
  });

  it("refuses bytes over the bucket ceiling before touching Storage", async () => {
    const { supabase, calls } = await client();
    const r = await uploadAndRegisterAttachment(
      supabase,
      {
        itemId: ITEM,
        fileName: "a.pdf",
        mimeType: "application/pdf",
        bytes: new Uint8Array(MAX_ATTACHMENT_BYTES + 1),
      },
      ACTOR,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("50 MB");
    expect(calls.storage).toHaveLength(0);
  });

  it("reports Item not found when the item is not visible", async () => {
    const { supabase, calls } = await client({
      itemScope: { data: null, error: null },
    });
    const r = await uploadAndRegisterAttachment(
      supabase,
      {
        itemId: ITEM,
        fileName: "a.pdf",
        mimeType: "application/pdf",
        bytes: bytes("hi"),
      },
      ACTOR,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("Item not found.");
    expect(calls.storage).toHaveLength(0);
  });

  // The invariant `attach_file` states as "size and type are read from storage,
  // not from you", reached from the writer's side: neither number nor mime on
  // the stored row may originate in anything a caller asserted.
  it("takes size from the buffer and mime from the argument, never a claim", async () => {
    const { supabase, calls } = await client();
    const r = await uploadAndRegisterAttachment(
      supabase,
      {
        itemId: ITEM,
        fileName: "../../etc/passwd",
        mimeType: "application/pdf",
        bytes: bytes("0123456789"),
        // A caller-shaped claim that must be ignored entirely.
        sizeBytes: 1,
        mime_type: "text/html",
      } as Parameters<typeof uploadAndRegisterAttachment>[1],
      ACTOR,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.sizeBytes).toBe(10);
    expect(calls.attachments[0]).toMatchObject({
      size_bytes: 10,
      mime_type: "application/pdf",
    });
    // The name is sanitised into the object key, so it can never traverse.
    expect(r.data.storagePath).not.toContain("..");
    expect(calls.storage[0].path).toBe(r.data.storagePath);
  });
});
