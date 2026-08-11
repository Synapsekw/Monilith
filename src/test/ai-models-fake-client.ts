/**
 * Test-support fake for the `ai_models` reads and writes in
 * `src/lib/ai/models/` (`catalog-db.ts`, `verify-ids.ts`).
 *
 * Lives in `src/test/` beside `adapter-fakes.ts` — outside vitest's
 * `*.{test,spec}.{ts,tsx}` include glob, so it is never collected as a suite,
 * and it imports nothing from `vitest` so it stays a plain module.
 *
 * It is deliberately ARGUMENT-AWARE, and that is the whole point of it. An
 * earlier fake in this plan discarded the arguments to `.eq()` / `.neq()`, so
 * ANY wrong predicate — a dropped `provider` filter, an inverted `status`
 * filter — still passed every test. Here every predicate is both
 *
 *   RECORDED, so a suite can assert the FULL predicate set, and
 *   APPLIED, so a missing filter changes the rows a select returns and makes
 *   an update stamp rows it had no business touching.
 *
 * `ai_models` is keyed on `(provider, model_id)`, so an update that forgets
 * `provider` would stamp a different provider's identically-named row — that
 * is exactly the failure this fake is built to catch.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

/** A row as PostgREST would hand it back: snake_case columns, loose values. */
export type FakeModelRow = Record<string, unknown>;

/**
 * A fixture row. `provider` + `model_id` are the composite key so they are
 * required; the three verification columns and `status` default to the
 * migration's defaults so a fixture only states what it cares about.
 */
export type AiModelFixture = {
  provider: string;
  model_id: string;
  native_model_id?: string | null;
  id_verified?: boolean;
  status?: string;
} & FakeModelRow;

export type Predicate = { op: "eq" | "neq"; column: string; value: unknown };

export type RecordedSelect = {
  columns: string;
  predicates: Predicate[];
  /** True when the read ended in `.maybeSingle()`. */
  single: boolean;
};

export type RecordedUpdate = {
  patch: Record<string, unknown>;
  predicates: Predicate[];
  /** How many rows the recorded predicates actually matched. */
  matched: number;
};

function satisfies(row: FakeModelRow, p: Predicate): boolean {
  return p.op === "eq" ? row[p.column] === p.value : row[p.column] !== p.value;
}

type OrderSpec = { column: string; ascending: boolean; nullsFirst: boolean };

function sortRows(rows: FakeModelRow[], order: OrderSpec): FakeModelRow[] {
  const key = (r: FakeModelRow): number | null => {
    const v = r[order.column];
    if (v === null || v === undefined) return null;
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  };
  return [...rows].sort((a, b) => {
    const av = key(a);
    const bv = key(b);
    if (av === null && bv === null) return 0;
    if (av === null) return order.nullsFirst ? -1 : 1;
    if (bv === null) return order.nullsFirst ? 1 : -1;
    return order.ascending ? av - bv : bv - av;
  });
}

type QueryResult<T> = { data: T; error: { message: string } | null };

export function fakeAiModelsClient(fixtures: AiModelFixture[]) {
  const table: FakeModelRow[] = fixtures.map((f) => ({
    native_model_id: null,
    id_verified: false,
    status: "active",
    ...f,
  }));
  const selects: RecordedSelect[] = [];
  const updates: RecordedUpdate[] = [];

  function makeSelect(columns: string) {
    const predicates: Predicate[] = [];
    let order: OrderSpec | null = null;
    let recorded = false;

    const record = (single: boolean) => {
      if (recorded) return;
      recorded = true;
      selects.push({ columns, predicates: [...predicates], single });
    };

    const rows = (): FakeModelRow[] => {
      const matched = table.filter((r) =>
        predicates.every((p) => satisfies(r, p)),
      );
      const ordered = order ? sortRows(matched, order) : matched;
      return ordered.map((r) => ({ ...r }));
    };

    const builder = {
      eq(column: string, value: unknown) {
        predicates.push({ op: "eq", column, value });
        return builder;
      },
      neq(column: string, value: unknown) {
        predicates.push({ op: "neq", column, value });
        return builder;
      },
      order(
        column: string,
        opts: { ascending?: boolean; nullsFirst?: boolean } = {},
      ) {
        order = {
          column,
          ascending: opts.ascending !== false,
          nullsFirst: opts.nullsFirst === true,
        };
        return builder;
      },
      maybeSingle(): Promise<QueryResult<FakeModelRow | null>> {
        record(true);
        return Promise.resolve({ data: rows()[0] ?? null, error: null });
      },
      // Thenable, so `await query` resolves exactly like a PostgREST builder.
      then<TResult1 = QueryResult<FakeModelRow[]>, TResult2 = never>(
        onFulfilled?:
          | ((
              v: QueryResult<FakeModelRow[]>,
            ) => TResult1 | PromiseLike<TResult1>)
          | null,
        onRejected?: ((r: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ): Promise<TResult1 | TResult2> {
        record(false);
        return Promise.resolve({ data: rows(), error: null }).then(
          onFulfilled,
          onRejected,
        );
      },
    };
    return builder;
  }

  function makeUpdate(patch: Record<string, unknown>) {
    const predicates: Predicate[] = [];
    let recorded = false;

    const settle = (): QueryResult<null> => {
      const matched = table.filter((r) =>
        predicates.every((p) => satisfies(r, p)),
      );
      for (const row of matched) Object.assign(row, patch);
      if (!recorded) {
        recorded = true;
        updates.push({
          patch: { ...patch },
          predicates: [...predicates],
          matched: matched.length,
        });
      }
      return { data: null, error: null };
    };

    const builder = {
      eq(column: string, value: unknown) {
        predicates.push({ op: "eq", column, value });
        return builder;
      },
      neq(column: string, value: unknown) {
        predicates.push({ op: "neq", column, value });
        return builder;
      },
      then<TResult1 = QueryResult<null>, TResult2 = never>(
        onFulfilled?:
          | ((v: QueryResult<null>) => TResult1 | PromiseLike<TResult1>)
          | null,
        onRejected?: ((r: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ): Promise<TResult1 | TResult2> {
        return Promise.resolve(settle()).then(onFulfilled, onRejected);
      },
    };
    return builder;
  }

  const client = {
    from(name: string) {
      if (name !== "ai_models")
        throw new Error(`fakeAiModelsClient: unexpected table "${name}"`);
      return {
        select: (columns: string) => makeSelect(columns),
        update: (patch: Record<string, unknown>) => makeUpdate(patch),
      };
    },
  };

  return {
    /** Typed for the modules under test; the shape above is all they touch. */
    client: client as unknown as SupabaseClient<Database>,
    /** The live table — assert on it to prove which rows were mutated. */
    table,
    selects,
    updates,
  };
}

/** Find a row by its composite key, for assertions. */
export function rowOf(
  table: FakeModelRow[],
  provider: string,
  modelId: string,
): FakeModelRow | undefined {
  return table.find((r) => r.provider === provider && r.model_id === modelId);
}
