/**
 * Test-support fake for the MCP tool handlers' Supabase surface.
 *
 * The handlers in `src/lib/mcp/tools/` touch these call shapes:
 *   - `.rpc(fn, args)`                                            (create_item)
 *   - `.from(t).select(…).eq(…).maybeSingle()`                    (column + item reads)
 *   - `.from("items").update(…).eq(…).select(…).maybeSingle()`    (rename)
 *   - `.from("cell_values").upsert(row, opts).select("*").single()` (cell write —
 *     the core reads the written row back in the SAME request so a caller can
 *     patch a mounted board without a refetch)
 *   - `.from("attachments").insert(row).select("id").single()`    (attach_file)
 *   - `.storage.from(bucket).{createSignedUploadUrl,upload,info,remove}`
 *     (create_attachment_upload + attach_file)
 *
 * It is ARGUMENT-AWARE: every `.eq(column, value)` is recorded on the read or
 * update that issued it, and every `.update()` patch is recorded too. It did
 * not used to be — `eq` was `() => chain`, so a query that had lost a predicate
 * was indistinguishable from one that still had it, and a rename that dropped
 * `.eq("id", itemId)` (renaming every visible item) would have passed every
 * test in `update-item.test.ts`. Predicates are RECORDED rather than APPLIED
 * because the results here are spec-driven, not table-driven; the same
 * discipline, applied to a fake that does own rows, is in
 * `src/test/ai-models-fake-client.ts`.
 *
 * A structural fake of just those is safe and keeps the `as never` cast in one
 * place. Lives in `src/test/` beside `integration-auth.ts` / `integration-env.ts`
 * — outside vitest's `src/**` + `*.{test,spec}.{ts,tsx}` include glob, so it is
 * never collected as a suite.
 */

export type FakeError = { message: string } | null;
export type FakeResult<T> = { data: T; error: FakeError };

export type ColumnRow = {
  org_id: string;
  board_id: string;
  kind: string;
} | null;
export type ItemRow = { board_id: string } | null;
export type CreatedItem = {
  id: string;
  name: string;
  group_id: string;
} | null;
export type CellValueRow = { value: unknown } | null;
export type ItemScopeRow = { org_id: string; board_id: string } | null;
export type FileColumnRow = {
  id: string;
  kind: string;
  board_id: string;
} | null;
export type AttachmentInsertRow = { id: string } | null;
export type SignedUpload = {
  signedUrl: string;
  token: string;
  path: string;
} | null;
export type ObjectInfo = { size?: number; contentType?: string } | null;

/** A single response, or a queue consumed in call order (the last entry repeats). */
export type Queued<T> = T | T[];

export type FakeClientSpec = {
  /** `supabase.rpc("create_item", …)` result. */
  rpc?: FakeResult<CreatedItem>;
  /** The `columns` read inside writeCellValue, per field. */
  column?: Queued<FakeResult<ColumnRow>>;
  /** The `items` read inside writeCellValue, per field. */
  item?: Queued<FakeResult<ItemRow>>;
  /** The `items` UPDATE (rename) in updateItemHandler. */
  rename?: FakeResult<ItemRow>;
  /** The `cell_values` upsert, per field. */
  upsert?: Queued<{ error: FakeError }>;
  /** The `cell_values` prior-assignee read the core issues for `people` columns. */
  priorCell?: Queued<FakeResult<CellValueRow>>;
  /** The `notifications` insert result. */
  notify?: { error: FakeError };
  /** The `items` org/board read in resolveItemScope / the attachment tools. */
  itemScope?: Queued<FakeResult<ItemScopeRow>>;
  /** The `columns` read that validates a Files-column target. */
  fileColumn?: Queued<FakeResult<FileColumnRow>>;
  /** The `attachments` insert result. */
  attachmentInsert?: FakeResult<AttachmentInsertRow>;
  /** `storage.from(b).createSignedUploadUrl(path)` result. */
  signedUpload?: FakeResult<SignedUpload>;
  /** `storage.from(b).upload(path, body, opts)` result. */
  upload?: { error: FakeError };
  /** `storage.from(b).info(path)` result. */
  info?: FakeResult<ObjectInfo>;
  /** `storage.from(b).remove(paths)` result. */
  remove?: { error: FakeError };
};

/** One recorded `.from(t).select(cols)…` read, with the rows it addressed. */
export type FakeRead = {
  table: string;
  cols: string;
  /** Every `.eq(column, value)` on this read, in call order. */
  eq: [string, unknown][];
};

/** One recorded `.from(t).update(patch).eq(…).select(cols)` write. */
export type FakeUpdate = {
  table: string;
  patch: unknown;
  /** Every `.eq(column, value)` on this update, in call order. */
  eq: [string, unknown][];
  cols: string;
};

export type FakeCalls = {
  /** Every cell_values upsert, in order, with its options argument. */
  upserts: { row: unknown; options: unknown }[];
  /** Every select, in order, with the predicates it carried. */
  reads: FakeRead[];
  /** Every update, in order, with its patch and predicates. */
  updates: FakeUpdate[];
  /** Every rpc() call, in order. */
  rpc: { fn: string; args: unknown }[];
  /** How many times the handler resolved the request client. Must be 1. */
  getClient: number;
  /** Every notifications insert, in order — the array of rows passed to `.insert()`. */
  notifications: unknown[];
  /** Every storage operation, in order. */
  storage: { op: string; bucket: string; path: string }[];
  /** Every attachments insert, in order. */
  attachments: unknown[];
};

const OK_COLUMN: FakeResult<ColumnRow> = {
  data: { org_id: "o1", board_id: "b1", kind: "text" },
  error: null,
};
const OK_ITEM: FakeResult<ItemRow> = { data: { board_id: "b1" }, error: null };
const EMPTY_CELL: FakeResult<CellValueRow> = { data: null, error: null };
const OK_RPC: FakeResult<CreatedItem> = {
  data: { id: "i1", name: "New task", group_id: "g1" },
  error: null,
};
const OK_ITEM_SCOPE: FakeResult<ItemScopeRow> = {
  data: { org_id: "o1", board_id: "b1" },
  error: null,
};
const OK_FILE_COLUMN: FakeResult<FileColumnRow> = {
  data: { id: "col1", kind: "files", board_id: "b1" },
  error: null,
};
const OK_ATTACHMENT: FakeResult<AttachmentInsertRow> = {
  data: { id: "a1" },
  error: null,
};
const OK_SIGNED: FakeResult<SignedUpload> = {
  data: {
    signedUrl: "https://example.test/upload/signed",
    token: "tok",
    path: "p",
  },
  error: null,
};
const OK_INFO: FakeResult<ObjectInfo> = {
  data: { size: 120, contentType: "text/csv" },
  error: null,
};

function dequeue<T>(queued: Queued<T> | undefined, fallback: T, n: number): T {
  if (queued === undefined) return fallback;
  if (!Array.isArray(queued)) return queued;
  return queued[Math.min(n, queued.length - 1)] ?? fallback;
}

export function makeFakeClient(spec: FakeClientSpec = {}): {
  getClient: () => Promise<never>;
  calls: FakeCalls;
} {
  const calls: FakeCalls = {
    upserts: [],
    reads: [],
    updates: [],
    rpc: [],
    getClient: 0,
    notifications: [],
    storage: [],
    attachments: [],
  };
  let columnReads = 0;
  let itemReads = 0;
  let upsertWrites = 0;
  let priorReads = 0;
  let scopeReads = 0;
  let fileColumnReads = 0;

  const client = {
    rpc: (fn: string, args: unknown) => {
      calls.rpc.push({ fn, args });
      return Promise.resolve(spec.rpc ?? OK_RPC);
    },
    from: (table: string) => ({
      // Routes on the SELECTED COLUMN LIST, not the table alone: writeCellValue
      // and the attachment core both read `items` and `columns`, with different
      // projections. `cell-core` selects "org_id, board_id, kind" / "board_id";
      // `attachment-core` selects "id, kind, board_id" / "org_id, board_id".
      select: (cols?: string) => {
        const read = () => {
          if (table === "columns") {
            return cols?.includes("kind, board_id")
              ? Promise.resolve(
                  dequeue(spec.fileColumn, OK_FILE_COLUMN, fileColumnReads++),
                )
              : Promise.resolve(dequeue(spec.column, OK_COLUMN, columnReads++));
          }
          if (table === "cell_values") {
            return Promise.resolve(
              dequeue(spec.priorCell, EMPTY_CELL, priorReads++),
            );
          }
          return cols?.includes("org_id")
            ? Promise.resolve(
                dequeue(spec.itemScope, OK_ITEM_SCOPE, scopeReads++),
              )
            : Promise.resolve(dequeue(spec.item, OK_ITEM, itemReads++));
        };
        const recorded: FakeRead = { table, cols: cols ?? "", eq: [] };
        calls.reads.push(recorded);
        type Chain = {
          eq: (column: string, value: unknown) => Chain;
          maybeSingle: () => Promise<
            FakeResult<
              ColumnRow | ItemRow | CellValueRow | ItemScopeRow | FileColumnRow
            >
          >;
        };
        const chain: Chain = {
          eq: (column: string, value: unknown) => {
            recorded.eq.push([column, value]);
            return chain;
          },
          maybeSingle: () => read(),
        };
        return chain;
      },
      update: (patch: unknown) => {
        const recorded: FakeUpdate = { table, patch, eq: [], cols: "" };
        calls.updates.push(recorded);
        const chain = {
          eq: (column: string, value: unknown) => {
            recorded.eq.push([column, value]);
            return chain;
          },
          select: (cols?: string) => {
            recorded.cols = cols ?? "";
            return {
              maybeSingle: () => Promise.resolve(spec.rename ?? OK_ITEM),
            };
          },
        };
        return chain;
      },
      upsert: (row: unknown, options: unknown) => {
        calls.upserts.push({ row, options });
        const result = dequeue(spec.upsert, { error: null }, upsertWrites++);
        // `.select("*").single()`: the row echoes back on success, and a failed
        // write returns no row — which is what the core turns into `fail`.
        return {
          select: () => ({
            single: () =>
              Promise.resolve({
                data: result.error ? null : row,
                error: result.error,
              }),
          }),
        };
      },
      insert: (rows: unknown) => {
        if (table === "attachments") {
          calls.attachments.push(rows);
          return {
            select: () => ({
              single: () =>
                Promise.resolve(spec.attachmentInsert ?? OK_ATTACHMENT),
            }),
          };
        }
        calls.notifications.push(rows);
        return Promise.resolve(spec.notify ?? { error: null });
      },
    }),
    storage: {
      from: (bucket: string) => ({
        createSignedUploadUrl: (path: string) => {
          calls.storage.push({ op: "createSignedUploadUrl", bucket, path });
          return Promise.resolve(spec.signedUpload ?? OK_SIGNED);
        },
        upload: (path: string) => {
          calls.storage.push({ op: "upload", bucket, path });
          return Promise.resolve(spec.upload ?? { error: null });
        },
        info: (path: string) => {
          calls.storage.push({ op: "info", bucket, path });
          return Promise.resolve(spec.info ?? OK_INFO);
        },
        remove: (paths: string[]) => {
          calls.storage.push({
            op: "remove",
            bucket,
            path: paths[0] ?? "",
          });
          return Promise.resolve(spec.remove ?? { error: null });
        },
      }),
    },
  };

  return {
    getClient: () => {
      calls.getClient += 1;
      // `never` is assignable to SupabaseClient<Database>, which is what lets a
      // structural fake satisfy the handlers' `GetClient` signature.
      return Promise.resolve(client as never);
    },
    calls,
  };
}
