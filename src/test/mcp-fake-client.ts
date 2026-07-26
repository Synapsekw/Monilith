/**
 * Test-support fake for the MCP tool handlers' Supabase surface.
 *
 * The handlers in `src/lib/mcp/tools/` touch only four call shapes:
 *   - `.rpc(fn, args)`                                            (create_item)
 *   - `.from(t).select(…).eq(…).maybeSingle()`                    (column + item reads)
 *   - `.from("items").update(…).eq(…).select(…).maybeSingle()`    (rename)
 *   - `.from("cell_values").upsert(row, options)`                 (cell write)
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
};

export type FakeCalls = {
  /** Every cell_values upsert, in order, with its options argument. */
  upserts: { row: unknown; options: unknown }[];
  /** Every rpc() call, in order. */
  rpc: { fn: string; args: unknown }[];
  /** How many times the handler resolved the request client. Must be 1. */
  getClient: number;
  /** Every notifications insert, in order — the array of rows passed to `.insert()`. */
  notifications: unknown[];
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
    rpc: [],
    getClient: 0,
    notifications: [],
  };
  let columnReads = 0;
  let itemReads = 0;
  let upsertWrites = 0;
  let priorReads = 0;

  const client = {
    rpc: (fn: string, args: unknown) => {
      calls.rpc.push({ fn, args });
      return Promise.resolve(spec.rpc ?? OK_RPC);
    },
    from: (table: string) => ({
      select: () => {
        const read = () =>
          table === "columns"
            ? Promise.resolve(dequeue(spec.column, OK_COLUMN, columnReads++))
            : table === "cell_values"
              ? Promise.resolve(
                  dequeue(spec.priorCell, EMPTY_CELL, priorReads++),
                )
              : Promise.resolve(dequeue(spec.item, OK_ITEM, itemReads++));
        type Chain = {
          eq: () => Chain;
          maybeSingle: () => Promise<
            FakeResult<ColumnRow | ItemRow | CellValueRow>
          >;
        };
        const chain: Chain = { eq: () => chain, maybeSingle: () => read() };
        return chain;
      },
      update: () => ({
        eq: () => ({
          select: () => ({
            maybeSingle: () => Promise.resolve(spec.rename ?? OK_ITEM),
          }),
        }),
      }),
      upsert: (row: unknown, options: unknown) => {
        calls.upserts.push({ row, options });
        return Promise.resolve(
          dequeue(spec.upsert, { error: null }, upsertWrites++),
        );
      },
      insert: (rows: unknown) => {
        calls.notifications.push(rows);
        return Promise.resolve(spec.notify ?? { error: null });
      },
    }),
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
