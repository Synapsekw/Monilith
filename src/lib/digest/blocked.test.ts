import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Insert = { table: string; values: unknown };
const inserts: Insert[] = [];
let insertError: { code?: string; message: string } | null = null;

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    from: (table: string) => ({
      insert: (values: unknown) => {
        inserts.push({ table, values });
        return Promise.resolve({ data: null, error: insertError });
      },
    }),
  }),
}));

import { recordDigestBlocked } from "@/lib/digest/blocked";

beforeEach(() => {
  inserts.length = 0;
  insertError = null;
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("recordDigestBlocked", () => {
  it("files a blocked digest_runs row for the current period with no org", async () => {
    await recordDigestBlocked(
      "DIGEST_SECRET is not configured",
      new Date("2026-07-27T07:00:00Z"),
    );

    expect(inserts).toHaveLength(1);
    expect(inserts[0].table).toBe("digest_runs");
    expect(inserts[0].values).toMatchObject({
      org_id: null,
      period_start: "2026-07-27",
      period_end: "2026-08-02",
      status: "blocked",
      error: "DIGEST_SECRET is not configured",
    });
  });

  it("warns loudly — a skipped run must never be silent", async () => {
    await recordDigestBlocked("DIGEST_SECRET is not configured");

    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("DIGEST_SECRET is not configured"),
    );
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("[digest]"),
    );
  });

  it("swallows the duplicate-key conflict — one blocked row per period", async () => {
    insertError = { code: "23505", message: "duplicate key" };

    await expect(recordDigestBlocked("blocked")).resolves.toBeUndefined();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("never throws when the ledger write itself fails", async () => {
    insertError = { code: "42501", message: "permission denied" };

    await expect(recordDigestBlocked("blocked")).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("permission denied"),
    );
  });
});
