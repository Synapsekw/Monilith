import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database.types";

/**
 * Typed `supabase.rpc()` wrapper that fixes two systematic lies in the
 * generated RPC arg types (they used to force `as unknown as` casts at every
 * call site — worst case ~12 in one call):
 *
 * 1. Postgres function parameters are always nullable (`create_goal(p_owner_id
 *    uuid, …)` accepts NULL), but supabase codegen narrows each arg to its
 *    non-null base type (`p_owner_id: string`). Passing an intentional `null`
 *    therefore needed `null as unknown as string`. Here every arg additionally
 *    accepts `null`, which is exactly what the SQL signature allows.
 *
 * 2. `json`/`jsonb` params are generated as the recursive `Json` union, which
 *    structured app payload types don't satisfy structurally (no index
 *    signature), so call sites cast `payload as unknown as Json`. Here a
 *    Json-typed arg accepts `unknown` — the runtime JSON-serializes whatever
 *    it gets, so any serializable value is honest.
 *
 * The single `as` inside this wrapper is the one place the codegen mismatch is
 * bridged; call sites stay cast-free and fully checked against the function
 * name, remaining arg types, and return type.
 */
type PublicFunctions = Database["public"]["Functions"];

type LooseArgs<A> = {
  [K in keyof A]: [Json] extends [NonNullable<A[K]>] ? unknown : A[K] | null;
};

export function typedRpc<Fn extends keyof PublicFunctions & string>(
  supabase: SupabaseClient<Database>,
  fn: Fn,
  args: LooseArgs<PublicFunctions[Fn]["Args"]>,
) {
  return supabase.rpc(fn, args as PublicFunctions[Fn]["Args"]);
}
