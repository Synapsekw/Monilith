import { beforeEach, describe, expect, it, vi } from "vitest";

// Captures what the query builder received, so we can assert the clamp + the
// escaped ilike pattern without a live database.
const captured: { limit?: number; ilikePattern?: string; fromCalls: number } = {
  fromCalls: 0,
};
let rows: { id: string; name: string }[] = [];

function makeQuery() {
  const q: Record<string, unknown> = {
    select: vi.fn(() => q),
    eq: vi.fn(() => q),
    is: vi.fn(() => q),
    order: vi.fn(() => q),
    limit: vi.fn((n: number) => {
      captured.limit = n;
      return q;
    }),
    ilike: vi.fn((_col: string, pattern: string) => {
      captured.ilikePattern = pattern;
      return q;
    }),
    // Awaitable: `await q` resolves to the PostgREST-style result.
    then: (resolve: (v: { data: unknown; error: null }) => void) =>
      resolve({ data: rows, error: null }),
  };
  return q;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => {
      captured.fromCalls += 1;
      return makeQuery();
    },
  }),
}));

import { listRelationCandidates } from "./relation-candidates";

const BOARD_ID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  captured.limit = undefined;
  captured.ilikePattern = undefined;
  captured.fromCalls = 0;
  rows = [{ id: "i1", name: "Item" }];
});

describe("listRelationCandidates", () => {
  it("returns [] and never queries on a non-uuid board id", async () => {
    const res = await listRelationCandidates("not-a-uuid");
    expect(res).toEqual([]);
    expect(captured.fromCalls).toBe(0);
  });

  it("clamps an over-large client limit to 100", async () => {
    await listRelationCandidates(BOARD_ID, "", 5000);
    expect(captured.limit).toBe(100);
  });

  it("uses the default limit of 50 when none is supplied", async () => {
    await listRelationCandidates(BOARD_ID);
    expect(captured.limit).toBe(50);
  });

  it("escapes LIKE wildcards (% and _) in the search term", async () => {
    await listRelationCandidates(BOARD_ID, "50%_x");
    // Each wildcard is backslash-escaped so it's matched literally.
    expect(captured.ilikePattern).toBe("%50\\%\\_x%");
  });

  it("does not apply an ilike filter for a blank search", async () => {
    await listRelationCandidates(BOARD_ID, "   ");
    expect(captured.ilikePattern).toBeUndefined();
  });

  it("returns the query rows for a valid board id", async () => {
    const res = await listRelationCandidates(BOARD_ID, "Item");
    expect(res).toEqual([{ id: "i1", name: "Item" }]);
  });
});
