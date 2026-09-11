import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { getBoardLastSeenAt } from "./visits";

type Result = { data: unknown; error: { message: string } | null };

/** Chainable stand-in for a PostgREST builder ending in maybeSingle(). */
function clientWith(
  result: Result,
  calls: { table?: string; eqs: [string, string][] },
) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: (col: string, val: string) => {
      calls.eqs.push([col, val]);
      return chain;
    },
    maybeSingle: async () => result,
  };
  return {
    from: (table: string) => {
      calls.table = table;
      return chain;
    },
  } as unknown as SupabaseClient<Database>;
}

describe("getBoardLastSeenAt", () => {
  it("returns last_seen_at from the caller's own (user_id, board_id) row", async () => {
    const calls = { eqs: [] as [string, string][] } as {
      table?: string;
      eqs: [string, string][];
    };
    const supabase = clientWith(
      { data: { last_seen_at: "2026-09-08T10:00:00Z" }, error: null },
      calls,
    );
    await expect(getBoardLastSeenAt(supabase, "b1", "u1")).resolves.toBe(
      "2026-09-08T10:00:00Z",
    );
    expect(calls.table).toBe("board_visits");
    expect(calls.eqs).toEqual([
      ["user_id", "u1"],
      ["board_id", "b1"],
    ]);
  });

  it("returns null when there is no row (first visit)", async () => {
    const supabase = clientWith({ data: null, error: null }, { eqs: [] });
    await expect(getBoardLastSeenAt(supabase, "b1", "u1")).resolves.toBeNull();
  });

  it("returns null instead of throwing on a read error", async () => {
    const supabase = clientWith(
      { data: null, error: { message: "boom" } },
      { eqs: [] },
    );
    await expect(getBoardLastSeenAt(supabase, "b1", "u1")).resolves.toBeNull();
    vi.restoreAllMocks();
  });
});
