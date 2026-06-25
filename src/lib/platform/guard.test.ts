import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc }),
}));

// cacheTag/cacheLife throw outside a compiled `use cache` scope under Vitest.
vi.mock("next/cache", () => ({ cacheTag: vi.fn(), cacheLife: vi.fn() }));

// Service client for the cached guard: from().select().eq().maybeSingle().
const maybeSingle = vi.fn();
const eq = vi.fn(() => ({ maybeSingle }));
const select = vi.fn(() => ({ eq }));
const from = vi.fn(() => ({ select }));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({ from }),
}));

import { isPlatformAdmin, isPlatformAdminCached } from "./guard";

beforeEach(() => {
  rpc.mockReset();
  from.mockClear();
  select.mockClear();
  eq.mockClear();
  maybeSingle.mockReset();
});

describe("isPlatformAdmin", () => {
  it("returns true when the RPC says so", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    expect(await isPlatformAdmin()).toBe(true);
  });
  it("fails closed on error", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "x" } });
    expect(await isPlatformAdmin()).toBe(false);
  });
});

describe("isPlatformAdminCached", () => {
  it("is true when the scoped read returns a row for the user", async () => {
    maybeSingle.mockResolvedValue({ data: { user_id: "u1" }, error: null });
    expect(await isPlatformAdminCached("u1")).toBe(true);
    expect(from).toHaveBeenCalledWith("platform_admins");
    expect(eq).toHaveBeenCalledWith("user_id", "u1");
  });
  it("is false when no row matches the user", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    expect(await isPlatformAdminCached("u1")).toBe(false);
  });
  it("fails closed (false) on error", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { message: "x" } });
    expect(await isPlatformAdminCached("u1")).toBe(false);
  });
});
