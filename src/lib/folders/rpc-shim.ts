import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

/**
 * TYPE SHIM — delete this file once `pnpm db:types` has been run AFTER
 * supabase/migrations/20261116112338_folder_drilldown.sql is applied, and
 * call these four through `typedRpc` (src/lib/supabase/typed-rpc.ts) instead.
 *
 * The four functions below are created by that migration, which is committed
 * but not applied yet, so the generated `Database["public"]["Functions"]`
 * does not know them and `typedRpc` cannot name them. The generated types are
 * never hand-edited; this is the one narrow, local bridge. Arguments are
 * typed here by hand from the migration's signatures; every RESULT is
 * `unknown` and is parsed with Zod by the caller (src/lib/folders/resolve.ts).
 */
type NewFolderRpcArgs = {
  folder_kpi_items: {
    p_folder_id: string;
    p_kpi: string;
    p_board_id: string | null;
    p_stage_key: string | null;
    p_limit: number;
    p_offset: number;
  };
  folder_attention_page: {
    p_folder_id: string;
    p_board_id: string | null;
    p_stage_key: string | null;
    p_reason: string | null;
    p_limit: number;
    p_offset: number;
  };
  folder_rollup_packed: { p_folder_id: string };
  folder_workload_packed: { p_folder_id: string };
};

export type NewFolderRpc = keyof NewFolderRpcArgs;

type RpcResult = {
  data: unknown;
  error: { code?: string | null; message: string } | null;
};

export function newFolderRpc<Fn extends NewFolderRpc>(
  supabase: SupabaseClient<Database>,
  fn: Fn,
  args: NewFolderRpcArgs[Fn],
): PromiseLike<RpcResult> {
  // The one cast: the generated function names do not include `fn` yet.
  const client = supabase as unknown as {
    rpc: (fn: string, args: object) => PromiseLike<RpcResult>;
  };
  return client.rpc(fn, args);
}

/**
 * True when PostgREST (PGRST202) or Postgres (42883) says the function does
 * not exist: the database has not had the migration yet, so the caller falls
 * back to the older function.
 */
export function isMissingFunction(
  error: { code?: string | null } | null,
): boolean {
  return error?.code === "PGRST202" || error?.code === "42883";
}
