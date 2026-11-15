/**
 * Test-support fake for the MCP OAuth token store and its Vault bridge:
 * the `oauth_tokens` table plus the three `oauth_bridge_*` RPCs.
 *
 * Lives in `src/test/` beside `ai-models-fake-client.ts` — outside vitest's
 * `*.{test,spec}.{ts,tsx}` include glob, so it is never collected as a suite,
 * and it imports nothing from `vitest`.
 *
 * Like that fake it OWNS ROWS and APPLIES every predicate, because the code
 * under test is security logic that lives entirely in its predicates: a
 * rotation that forgot `.gt("refresh_token_expires_at", now)` must rotate an
 * expired token here exactly as it would in Postgres, and a secret swap that
 * forgot its compare-and-set must clobber the winner's secret. The inline fake
 * this replaces ignored the arguments to `.is()` on reads, so a dropped
 * `revoked_at is null` filter passed every test.
 *
 * The RPCs mirror the SQL in `supabase/migrations/20260724133321_mcp_oauth.sql`
 * and `…_oauth_token_idle_expiry_and_bridge_swap.sql`. They are a statement of
 * the contract the TypeScript relies on, not a test of the SQL itself.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

export type FakeTokenRow = Record<string, unknown>;

export type Predicate =
  | { op: "eq" | "is" | "gt" | "lt"; column: string; value: unknown }
  | { op: "or"; alternatives: Predicate[] };

type FakeError = { message: string };
type Result<T> = { data: T; error: FakeError | null };

/** Operations a test can make fail once, to exercise the error paths. */
export type FailableOp =
  "select" | "update" | "insert" | "delete" | `rpc:${string}`;

function holds(row: FakeTokenRow, p: Predicate): boolean {
  if (p.op === "or") return p.alternatives.some((a) => holds(row, a));
  const actual = row[p.column];
  switch (p.op) {
    case "eq":
      // SQL: NULL = anything is never true.
      return actual != null && actual === p.value;
    case "is":
      return p.value === null ? actual == null : actual === p.value;
    // ISO-8601 UTC strings (everything here comes from toISOString) order
    // correctly as strings; a NULL column satisfies neither comparison.
    case "gt":
      return typeof actual === "string" && actual > String(p.value);
    case "lt":
      return typeof actual === "string" && actual < String(p.value);
  }
}

/** Parses the PostgREST `or` filter forms this code uses: `col.op.value,…`. */
function parseOr(filter: string): Predicate {
  const alternatives = filter.split(",").map((part): Predicate => {
    const [column, op, ...rest] = part.split(".");
    const raw = rest.join(".");
    if (op !== "is" && op !== "lt" && op !== "gt" && op !== "eq")
      throw new Error(`fakeOauthClient: unsupported or-filter "${part}"`);
    return { op, column, value: raw === "null" ? null : raw };
  });
  return { op: "or", alternatives };
}

export function fakeOauthClient(
  seed: { tokens?: FakeTokenRow[]; secrets?: Record<string, string> } = {},
) {
  const tokens: FakeTokenRow[] = (seed.tokens ?? []).map((t) => ({ ...t }));
  const vault = new Map<string, string>(Object.entries(seed.secrets ?? {}));
  const vaultNames = new Set<string>();
  const pendingFailures: { op: FailableOp; message: string }[] = [];
  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
  const updates: {
    patch: Record<string, unknown>;
    predicates: Predicate[];
    matched: number;
  }[] = [];
  let nextId = 1;

  function takeFailure(op: FailableOp): FakeError | null {
    const i = pendingFailures.findIndex((f) => f.op === op);
    if (i === -1) return null;
    const [f] = pendingFailures.splice(i, 1);
    return { message: f.message };
  }

  function matching(predicates: Predicate[]): FakeTokenRow[] {
    return tokens.filter((r) => predicates.every((p) => holds(r, p)));
  }

  function filterable<B extends object>(builder: B, predicates: Predicate[]) {
    const add = (p: Predicate) => {
      predicates.push(p);
      return self;
    };
    const self = Object.assign(builder, {
      eq: (column: string, value: unknown) => add({ op: "eq", column, value }),
      is: (column: string, value: unknown) => add({ op: "is", column, value }),
      gt: (column: string, value: unknown) => add({ op: "gt", column, value }),
      lt: (column: string, value: unknown) => add({ op: "lt", column, value }),
      or: (filter: string) => add(parseOr(filter)),
    });
    return self;
  }

  function thenable<T>(settle: () => Result<T>) {
    return {
      then<R1 = Result<T>, R2 = never>(
        onFulfilled?: ((v: Result<T>) => R1 | PromiseLike<R1>) | null,
        onRejected?: ((r: unknown) => R2 | PromiseLike<R2>) | null,
      ): Promise<R1 | R2> {
        return Promise.resolve().then(settle).then(onFulfilled, onRejected);
      },
    };
  }

  function makeSelect() {
    const predicates: Predicate[] = [];
    let order: { column: string; ascending: boolean } | null = null;
    const rows = (): FakeTokenRow[] => {
      const found = matching(predicates).map((r) => ({ ...r }));
      if (!order) return found;
      const { column, ascending } = order;
      return found.sort((a, b) => {
        const cmp = String(a[column]).localeCompare(String(b[column]));
        return ascending ? cmp : -cmp;
      });
    };
    const builder = filterable(
      {
        order(column: string, opts: { ascending?: boolean } = {}) {
          order = { column, ascending: opts.ascending !== false };
          return builder;
        },
        // A compile-time-only cast in postgrest-js; a no-op at runtime.
        overrideTypes: () => builder,
        maybeSingle: (): Promise<Result<FakeTokenRow | null>> =>
          Promise.resolve().then(() => {
            const error = takeFailure("select");
            return error
              ? { data: null, error }
              : { data: rows()[0] ?? null, error: null };
          }),
        ...thenable<FakeTokenRow[] | null>(() => {
          const error = takeFailure("select");
          return error ? { data: null, error } : { data: rows(), error: null };
        }),
      },
      predicates,
    );
    return builder;
  }

  function makeUpdate(patch: Record<string, unknown>) {
    const predicates: Predicate[] = [];
    let settled: Result<FakeTokenRow[] | null> | null = null;
    // One UPDATE statement: applied once, however the result is consumed.
    const apply = (): Result<FakeTokenRow[] | null> => {
      if (settled) return settled;
      const error = takeFailure("update");
      if (error) return (settled = { data: null, error });
      const matched = matching(predicates);
      for (const row of matched) Object.assign(row, patch);
      updates.push({
        patch: { ...patch },
        predicates: [...predicates],
        matched: matched.length,
      });
      return (settled = { data: matched.map((r) => ({ ...r })), error: null });
    };
    const builder = filterable(
      {
        select: () => ({
          maybeSingle: (): Promise<Result<FakeTokenRow | null>> =>
            Promise.resolve().then(() => {
              const { data, error } = apply();
              return { data: data?.[0] ?? null, error };
            }),
          ...thenable(apply),
        }),
        ...thenable<null>(() => ({ data: null, error: apply().error })),
      },
      predicates,
    );
    return builder;
  }

  function makeDelete() {
    const predicates: Predicate[] = [];
    const builder = filterable(
      {
        ...thenable<null>(() => {
          const error = takeFailure("delete");
          if (error) return { data: null, error };
          // An unfiltered DELETE is refused by PostgREST; never let a test
          // pass on one.
          if (predicates.length === 0)
            return {
              data: null,
              error: { message: "DELETE requires a WHERE" },
            };
          for (const row of matching(predicates)) {
            tokens.splice(tokens.indexOf(row), 1);
            // oauth_tokens_before_delete trigger: free the Vault secret.
            if (typeof row.bridge_secret_id === "string")
              vault.delete(row.bridge_secret_id);
          }
          return { data: null, error: null };
        }),
      },
      predicates,
    );
    return builder;
  }

  function insert(row: FakeTokenRow): Result<null> {
    const error = takeFailure("insert");
    if (error) return { data: null, error };
    const nowIso = new Date().toISOString();
    tokens.push({
      id: `token-${nextId++}`,
      created_at: nowIso,
      last_used_at: nowIso,
      revoked_at: null,
      bridge_secret_id: null,
      prev_refresh_token_hash: null,
      prev_refresh_rotated_at: null,
      prev_refresh_expires_at: null,
      bridge_healed_at: null,
      ...row,
    });
    return { data: null, error: null };
  }

  function createSecret(secret: string, name: string): string {
    if (vaultNames.has(name))
      throw new Error(
        'duplicate key value violates unique constraint "secrets_name_idx"',
      );
    vaultNames.add(name);
    const id = `secret-${nextId++}`;
    vault.set(id, secret);
    return id;
  }

  function rpc(
    fn: string,
    args: Record<string, unknown>,
  ): Promise<Result<string | null>> {
    return Promise.resolve().then(() => {
      rpcCalls.push({ fn, args: { ...args } });
      const error = takeFailure(`rpc:${fn}`);
      if (error) return { data: null, error };
      switch (fn) {
        case "oauth_bridge_get_secret":
          return {
            data: vault.get(String(args.p_secret_id)) ?? null,
            error: null,
          };
        case "oauth_bridge_rotate_secret": {
          if (args.p_old_secret_id != null)
            vault.delete(String(args.p_old_secret_id));
          return {
            data: createSecret(String(args.p_secret), String(args.p_name)),
            error: null,
          };
        }
        case "oauth_bridge_swap_secret": {
          const row = tokens.find(
            (t) => t.id === args.p_token_id && t.revoked_at == null,
          );
          const expected = args.p_expected_secret_id ?? null;
          if (!row || (row.bridge_secret_id ?? null) !== expected)
            return { data: null, error: null };
          const created = createSecret(
            String(args.p_secret),
            String(args.p_name),
          );
          row.bridge_secret_id = created;
          if (expected !== null) vault.delete(String(expected));
          return { data: created, error: null };
        }
        default:
          throw new Error(`fakeOauthClient: unexpected rpc "${fn}"`);
      }
    });
  }

  const client = {
    from(name: string) {
      if (name !== "oauth_tokens")
        throw new Error(`fakeOauthClient: unexpected table "${name}"`);
      return {
        select: () => makeSelect(),
        update: (patch: Record<string, unknown>) => makeUpdate(patch),
        delete: () => makeDelete(),
        insert: (row: FakeTokenRow) =>
          Promise.resolve().then(() => insert(row)),
      };
    },
    rpc,
  };

  return {
    /** Typed for the modules under test; the shape above is all they touch. */
    client: client as unknown as SupabaseClient<Database>,
    /** The live table — assert on it to prove which rows were mutated. */
    tokens,
    /** secret id → stored payload. Its size is the orphan check. */
    vault,
    rpcCalls,
    updates,
    /** Makes the next call of `op` return a PostgREST-style error. */
    failNext(op: FailableOp, message = "boom") {
      pendingFailures.push({ op, message });
    },
    /** Stores a secret directly, as if minted earlier. Returns its id. */
    putSecret(payload: unknown): string {
      return createSecret(JSON.stringify(payload), `seed-${nextId}`);
    },
  };
}
