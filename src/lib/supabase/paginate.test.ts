import { describe, it, expect, vi } from "vitest";
import { fetchAllRows, POSTGREST_MAX_ROWS } from "@/lib/supabase/paginate";

/** A fake table of `total` rows served in PostgREST-style inclusive ranges. */
function fakeTable(total: number, failAt?: number) {
  const calls: [number, number][] = [];
  const page = vi.fn(async (from: number, to: number) => {
    calls.push([from, to]);
    if (failAt !== undefined && from >= failAt)
      return { data: null, error: { message: "boom" } };
    const end = Math.min(to, total - 1);
    const data =
      from > end
        ? []
        : Array.from({ length: end - from + 1 }, (_, i) => from + i);
    return { data, error: null };
  });
  return { page, calls };
}

describe("fetchAllRows", () => {
  it("defaults to the PostgREST 1000-row page", () => {
    expect(POSTGREST_MAX_ROWS).toBe(1000);
  });

  it("makes one request when the first page is short", async () => {
    const t = fakeTable(12);
    const res = await fetchAllRows(t.page, { cap: 5000 });
    expect(res.error).toBeNull();
    expect(res.data).toHaveLength(12);
    expect(t.calls).toEqual([[0, 999]]);
  });

  it("returns every row of a table larger than one page, in order", async () => {
    const t = fakeTable(2500);
    const res = await fetchAllRows(t.page, { cap: 60000, pageSize: 1000 });
    expect(res.data).toHaveLength(2500);
    expect(res.data?.[0]).toBe(0);
    expect(res.data?.[2499]).toBe(2499);
    expect(new Set(res.data).size).toBe(2500);
  });

  it("handles a total that is an exact multiple of the page size", async () => {
    const t = fakeTable(3000);
    const res = await fetchAllRows(t.page, {
      cap: 60000,
      pageSize: 1000,
      wave: 2,
    });
    expect(res.data).toHaveLength(3000);
  });

  it("never reads past the cap", async () => {
    const t = fakeTable(10_000);
    const res = await fetchAllRows(t.page, { cap: 2500, pageSize: 1000 });
    expect(res.data).toHaveLength(2500);
    expect(Math.max(...t.calls.map(([, to]) => to))).toBe(2499);
  });

  it("fetches later pages in parallel waves, not one round trip per page", async () => {
    const t = fakeTable(5500);
    let inFlight = 0;
    let peak = 0;
    const page = async (from: number, to: number) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      const r = await t.page(from, to);
      inFlight--;
      return r;
    };
    const res = await fetchAllRows(page, {
      cap: 60000,
      pageSize: 1000,
      wave: 4,
    });
    expect(res.data).toHaveLength(5500);
    expect(peak).toBeGreaterThan(1);
  });

  it("surfaces the first error instead of a silently partial result", async () => {
    const t = fakeTable(5000, 2000);
    const res = await fetchAllRows(t.page, { cap: 60000, pageSize: 1000 });
    expect(res.data).toBeNull();
    expect(res.error?.message).toBe("boom");
  });

  it("clamps the only page to a cap smaller than the page size", async () => {
    const t = fakeTable(5000);
    const res = await fetchAllRows(t.page, { cap: 300, pageSize: 1000 });
    expect(res.data).toHaveLength(300);
    expect(t.calls).toEqual([[0, 299]]);
  });

  it("surfaces an error on the first page", async () => {
    const t = fakeTable(5000, 0);
    const res = await fetchAllRows(t.page, { cap: 60000 });
    expect(res).toEqual({ data: null, error: { message: "boom" } });
  });
});
