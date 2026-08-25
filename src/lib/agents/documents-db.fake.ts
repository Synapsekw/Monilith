import { vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

/**
 * One small fake Supabase client for `documents-db.test.ts`, following the
 * per-query-shape pattern in `src/lib/agents/agents-db.test.ts`. Unlike that
 * file, `documents-db.ts`'s functions all build straight-line chains (no
 * branching `.eq()` counts), so a single generic chainable builder covers
 * every shape used here (`select().eq().order().limit()`,
 * `insert().select().single()`, `update().eq()`, `delete().eq()`,
 * `select().eq().order().order()`) instead of one hand-built chain per
 * function.
 *
 * The builder is thenable at every link — real `PostgrestFilterBuilder`
 * resolves to `{ data, error }` however the chain ends (`.limit()`, `.eq()`,
 * `.single()`, `.maybeSingle()`), and callers here rely on that (e.g.
 * `updateDocumentRow` awaits `.update().eq()` directly, with no
 * `.select()`).
 *
 * NOT a `.test.ts` file on purpose — Vitest's `src/**\/*.{test,spec}.{ts,tsx}`
 * glob would otherwise try to run it as a suite with zero tests in it.
 */

export type Calls = {
  select: string[];
  selectOptions: (unknown | undefined)[];
  rpc: [string, unknown][];
  eq: [string, unknown][];
  order: [string, unknown | undefined][];
  limit: number[];
  insert: unknown[];
  update: unknown[];
  delete: true[];
};

export function makeFakeClient(result: {
  data: unknown;
  error?: unknown;
  count?: number;
}): {
  client: SupabaseClient<Database>;
  calls: Calls;
} {
  const calls: Calls = {
    select: [],
    selectOptions: [],
    rpc: [],
    eq: [],
    order: [],
    limit: [],
    insert: [],
    update: [],
    delete: [],
  };
  const resolved = {
    data: result.data,
    error: result.error ?? null,
    // PostgREST only returns a count when the query asked for one; `undefined`
    // is the honest default so `?? rows.length` is exercised by every test
    // that does not opt in.
    count: result.count,
  };

  function makeChain(): Record<string, unknown> {
    const chain: Record<string, unknown> = {
      select: vi.fn((cols?: string, opts?: unknown) => {
        calls.select.push(cols ?? "");
        calls.selectOptions.push(opts);
        return chain;
      }),
      eq: vi.fn((col: string, val: unknown) => {
        calls.eq.push([col, val]);
        return chain;
      }),
      order: vi.fn((col: string, opts?: unknown) => {
        calls.order.push([col, opts]);
        return chain;
      }),
      limit: vi.fn((n: number) => {
        calls.limit.push(n);
        return chain;
      }),
      insert: vi.fn((row: unknown) => {
        calls.insert.push(row);
        return chain;
      }),
      update: vi.fn((row: unknown) => {
        calls.update.push(row);
        return chain;
      }),
      delete: vi.fn(() => {
        calls.delete.push(true);
        return chain;
      }),
      single: vi.fn(() => Promise.resolve(resolved)),
      maybeSingle: vi.fn(() => Promise.resolve(resolved)),
      // Makes the chain awaitable at any point, matching the real builder.
      then: (
        onFulfilled: (value: typeof resolved) => unknown,
        onRejected?: (reason: unknown) => unknown,
      ) => Promise.resolve(resolved).then(onFulfilled, onRejected),
    };
    return chain;
  }

  const from = vi.fn(() => makeChain());
  // `typedRpc` goes through `supabase.rpc(fn, args)` and awaits it directly.
  const rpc = vi.fn((fn: string, args: unknown) => {
    calls.rpc.push([fn, args]);
    return Promise.resolve(resolved);
  });
  return {
    client: { from, rpc } as unknown as SupabaseClient<Database>,
    calls,
  };
}
