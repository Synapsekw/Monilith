import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc }),
}));
import { isPlatformAdmin } from "./guard";

beforeEach(() => rpc.mockReset());

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
