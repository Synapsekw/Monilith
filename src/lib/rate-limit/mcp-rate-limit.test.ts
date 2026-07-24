import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({}),
}));
vi.mock("@/lib/supabase/typed-rpc", () => ({
  typedRpc: vi.fn(),
}));

import { typedRpc } from "@/lib/supabase/typed-rpc";
import { checkMcpRateLimit } from "./mcp-rate-limit";

describe("checkMcpRateLimit", () => {
  it("allows when the RPC reports allowed", async () => {
    vi.mocked(typedRpc).mockResolvedValueOnce({
      data: [{ allowed: true, retry_after: 0, remaining: 99 }],
      error: null,
    } as never);
    const decision = await checkMcpRateLimit("some-token");
    expect(decision).toEqual({ allowed: true });
  });

  it("denies with retryAfterSeconds when the RPC reports denied", async () => {
    vi.mocked(typedRpc).mockResolvedValueOnce({
      data: [{ allowed: false, retry_after: 42, remaining: 0 }],
      error: null,
    } as never);
    const decision = await checkMcpRateLimit("some-token");
    expect(decision).toEqual({ allowed: false, retryAfterSeconds: 42 });
  });

  it("fails open on an RPC error", async () => {
    vi.mocked(typedRpc).mockResolvedValueOnce({
      data: null,
      error: { message: "boom" },
    } as never);
    const decision = await checkMcpRateLimit("some-token");
    expect(decision).toEqual({ allowed: true });
  });
});
