import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { getLatestBoardIntelligenceRun, isRunStale, rowToRun } from "./runs";
import { INTELLIGENCE_STALE_MS } from "@/lib/boards/intelligence/constants";

const row = (payload: unknown) => ({
  id: "r1",
  org_id: "o",
  board_id: "b",
  user_id: "u",
  generated_at: "2026-09-11T10:00:00.000Z",
  input_hash: "h",
  payload,
  dismissed: ["s1"],
  applied: [],
  model: "m",
  tokens_in: 1,
  tokens_out: 2,
});

describe("rowToRun", () => {
  it("maps a valid row and fails closed on a malformed payload", () => {
    const run = rowToRun(
      row({ brief: "b", suggestions: [], signals: [] }) as never,
    );
    expect(run).toMatchObject({
      id: "r1",
      boardId: "b",
      inputHash: "h",
      dismissed: ["s1"],
      tokensIn: 1,
      tokensOut: 2,
    });
    expect(rowToRun(row({ nope: true }) as never)).toBeNull();
  });
});

describe("isRunStale", () => {
  const run = rowToRun(
    row({ brief: "b", suggestions: [], signals: [] }) as never,
  )!;
  const at = Date.parse(run.generatedAt);
  it("is fresh under 30 minutes with the same hash", () => {
    expect(
      isRunStale(run, {
        nowMs: at + INTELLIGENCE_STALE_MS - 1,
        inputHash: "h",
      }),
    ).toBe(false);
  });
  it("is stale after 30 minutes or when the hash changed", () => {
    expect(
      isRunStale(run, { nowMs: at + INTELLIGENCE_STALE_MS, inputHash: "h" }),
    ).toBe(true);
    expect(isRunStale(run, { nowMs: at, inputHash: "other" })).toBe(true);
  });
  it("treats an unparseable timestamp as stale", () => {
    expect(
      isRunStale(
        { ...run, generatedAt: "nope" },
        { nowMs: at, inputHash: "h" },
      ),
    ).toBe(true);
  });
});

describe("getLatestBoardIntelligenceRun", () => {
  it("never throws — an error from the client resolves to null", async () => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order", "limit"]) q[m] = () => q;
    q.maybeSingle = async () => ({ data: null, error: { message: "boom" } });
    const supabase = {
      from: () => q,
    } as unknown as SupabaseClient<Database>;
    const result = await getLatestBoardIntelligenceRun(supabase, "b1", "u1");
    expect(result).toBeNull();
  });
});
