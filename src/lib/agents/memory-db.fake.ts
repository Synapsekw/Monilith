import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

/**
 * The fake Supabase client for `memory-db.test.ts`.
 *
 * NOT a `.test.ts` file on purpose — Vitest's `src/**\/*.{test,spec}.{ts,tsx}`
 * glob would otherwise try to run it as a suite with zero tests in it.
 *
 * MODELLED ON `src/test/ai-models-fake-client.ts`, NOT on
 * `documents-db.fake.ts`, and the difference is the whole point. The documents
 * fake RECORDS `.eq()` arguments and then throws them away: it resolves to one
 * fixed `{ data }` however the chain is filtered, so a dropped
 * `user_agent_id` predicate — a cross-AGENT read of one owner's memory — would
 * pass every test in the file. That is gotcha-89's failure mode (five tests
 * that could not fail shipped in one plan), and memory is the wrong table to
 * take that risk on: it is the first table in this codebase a language model
 * writes to.
 *
 * So every predicate here is both
 *   RECORDED, so a suite can assert the FULL predicate set (including that a
 *     read is bounded and ordered over the index), and
 *   APPLIED, so a missing filter changes the rows a select returns and makes a
 *     delete remove rows it had no business touching.
 *
 * `agent_memory` is keyed on `(user_agent_id, key)`, so a `forget` that forgot
 * `user_agent_id` would delete another agent's identically-keyed note — that is
 * exactly the failure this fake is built to catch.
 */

/** A row as PostgREST would hand it back: snake_case columns, loose values. */
export type FakeMemoryRow = Record<string, unknown>;

export type MemoryFixture = {
  id?: string;
  user_agent_id: string;
  key: string;
  value?: string;
  origin?: string;
  token_estimate?: number;
  last_run_id?: string | null;
  updated_at?: string;
  /** The embedded parent `listMemoryTotalsByAgent` filters through. */
  user_agents?: { owner_id: string };
} & FakeMemoryRow;

export type Predicate = { column: string; value: unknown };

export type RecordedSelect = {
  columns: string;
  options: unknown;
  predicates: Predicate[];
  order: { column: string; ascending: boolean }[];
  limit: number | null;
  /** How many rows the recorded predicates actually matched. */
  matched: number;
};

export type RecordedDelete = {
  predicates: Predicate[];
  /** How many rows were actually removed from the table. */
  removed: number;
};

export type RecordedUpsert = {
  row: Record<string, unknown>;
  options: unknown;
};

/**
 * Resolves a possibly-DOTTED column ("user_agents.owner_id") against a row, so
 * an embedded-resource filter is applied rather than silently ignored. An
 * ignored embed filter is what would let one owner's aggregate include another
 * owner's agents.
 */
function valueAt(row: FakeMemoryRow, column: string): unknown {
  return column
    .split(".")
    .reduce<unknown>(
      (acc, part) =>
        acc && typeof acc === "object"
          ? (acc as Record<string, unknown>)[part]
          : undefined,
      row,
    );
}

function matches(row: FakeMemoryRow, predicates: Predicate[]): boolean {
  return predicates.every((p) => valueAt(row, p.column) === p.value);
}

type QueryResult<T> = {
  data: T;
  error: { message: string } | null;
  count?: number | null;
};

export function makeFakeMemoryClient(opts: {
  rows?: MemoryFixture[];
  /** What `rpc("agent_remember", …)` resolves its `data` to. */
  rpcResult?: unknown;
  /** Forces the next terminal operation to fail, to exercise the throw paths. */
  error?: { message: string };
}) {
  const table: FakeMemoryRow[] = (opts.rows ?? []).map((r, i) => ({
    id: r.id ?? `row-${i}`,
    value: "",
    origin: "agent",
    token_estimate: 0,
    last_run_id: null,
    updated_at: "2026-01-01T00:00:00Z",
    ...r,
  }));

  const selects: RecordedSelect[] = [];
  const deletes: RecordedDelete[] = [];
  const upserts: RecordedUpsert[] = [];
  const rpcCalls: [string, unknown][] = [];
  const error = opts.error ?? null;

  function makeSelect(columns: string, options: unknown) {
    const predicates: Predicate[] = [];
    const order: { column: string; ascending: boolean }[] = [];
    let limit: number | null = null;
    let recorded = false;

    const rows = (): FakeMemoryRow[] => {
      let out = table.filter((r) => matches(r, predicates));
      for (const o of [...order].reverse()) {
        out = [...out].sort((a, b) => {
          const av = String(valueAt(a, o.column) ?? "");
          const bv = String(valueAt(b, o.column) ?? "");
          return o.ascending ? av.localeCompare(bv) : bv.localeCompare(av);
        });
      }
      if (limit !== null) out = out.slice(0, limit);
      return out.map((r) => ({ ...r }));
    };

    const settle = (): QueryResult<FakeMemoryRow[] | null> => {
      const matched = rows();
      if (!recorded) {
        recorded = true;
        selects.push({
          columns,
          options,
          predicates: [...predicates],
          order: [...order],
          limit,
          matched: matched.length,
        });
      }
      if (error) return { data: null, error, count: null };
      // `head: true` asks PostgREST for the count and NO rows.
      const head =
        typeof options === "object" &&
        options !== null &&
        (options as { head?: boolean }).head === true;
      return {
        data: head ? null : matched,
        error: null,
        count: matched.length,
      };
    };

    const builder = {
      eq(column: string, value: unknown) {
        predicates.push({ column, value });
        return builder;
      },
      order(column: string, o: { ascending?: boolean } = {}) {
        order.push({ column, ascending: o.ascending !== false });
        return builder;
      },
      limit(n: number) {
        limit = n;
        return builder;
      },
      single(): Promise<QueryResult<FakeMemoryRow | null>> {
        const res = settle();
        return Promise.resolve({
          data: Array.isArray(res.data) ? (res.data[0] ?? null) : null,
          error: res.error,
        });
      },
      then<TResult1 = QueryResult<FakeMemoryRow[] | null>, TResult2 = never>(
        onFulfilled?:
          | ((
              v: QueryResult<FakeMemoryRow[] | null>,
            ) => TResult1 | PromiseLike<TResult1>)
          | null,
        onRejected?: ((r: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ): Promise<TResult1 | TResult2> {
        return Promise.resolve(settle()).then(onFulfilled, onRejected);
      },
    };
    return builder;
  }

  function makeDelete() {
    const predicates: Predicate[] = [];
    let selected: string | null = null;
    let recorded = false;

    const settle = (): QueryResult<FakeMemoryRow[] | null> => {
      const doomed = table.filter((r) => matches(r, predicates));
      if (!recorded) {
        recorded = true;
        // APPLIED: the rows really leave the table, so a test can prove a
        // sibling agent's identically-keyed note survived.
        for (const row of doomed) table.splice(table.indexOf(row), 1);
        deletes.push({ predicates: [...predicates], removed: doomed.length });
      }
      if (error) return { data: null, error };
      return {
        data: selected
          ? doomed.map((r) => ({ id: r.id }) as FakeMemoryRow)
          : null,
        error: null,
      };
    };

    const builder = {
      eq(column: string, value: unknown) {
        predicates.push({ column, value });
        return builder;
      },
      select(columns: string) {
        selected = columns;
        return builder;
      },
      then<TResult1 = QueryResult<FakeMemoryRow[] | null>, TResult2 = never>(
        onFulfilled?:
          | ((
              v: QueryResult<FakeMemoryRow[] | null>,
            ) => TResult1 | PromiseLike<TResult1>)
          | null,
        onRejected?: ((r: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ): Promise<TResult1 | TResult2> {
        return Promise.resolve(settle()).then(onFulfilled, onRejected);
      },
    };
    return builder;
  }

  function makeUpsert(row: Record<string, unknown>, options: unknown) {
    upserts.push({ row: { ...row }, options });
    // APPLIED on the (user_agent_id, key) unique index, so a test can prove an
    // owner's edit replaces the agent's note rather than duplicating the key.
    const existing = table.find(
      (r) => r.user_agent_id === row.user_agent_id && r.key === row.key,
    );
    if (existing) Object.assign(existing, row);
    else table.push({ id: `row-${table.length}`, ...row });
    return Promise.resolve({ data: null, error });
  }

  const client = {
    from(name: string) {
      if (name !== "agent_memory")
        throw new Error(`makeFakeMemoryClient: unexpected table "${name}"`);
      return {
        select: (columns: string, options?: unknown) =>
          makeSelect(columns, options),
        delete: () => makeDelete(),
        upsert: (row: Record<string, unknown>, options?: unknown) =>
          makeUpsert(row, options),
      };
    },
    rpc(fn: string, args: unknown) {
      rpcCalls.push([fn, args]);
      return Promise.resolve({ data: opts.rpcResult ?? null, error });
    },
  };

  return {
    /** Typed for the modules under test; the shape above is all they touch. */
    client: client as unknown as SupabaseClient<Database>,
    /** The live table — assert on it to prove which rows were mutated. */
    table,
    selects,
    deletes,
    upserts,
    rpcCalls,
  };
}
