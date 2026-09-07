import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({}),
}));
vi.mock("@/lib/supabase/typed-rpc", () => ({
  typedRpc: vi.fn(),
}));

import { typedRpc } from "@/lib/supabase/typed-rpc";
import {
  checkAgentMentionRateLimit,
  AGENT_MENTION_LIMIT,
  AGENT_MENTION_WINDOW_SECONDS,
} from "./agent-mention-rate-limit";

const USER = "99999999-9999-4999-8999-999999999999";

describe("checkAgentMentionRateLimit", () => {
  it("allows when the RPC reports allowed", async () => {
    vi.mocked(typedRpc).mockResolvedValueOnce({
      data: [{ allowed: true, retry_after: 0, remaining: 9 }],
      error: null,
    } as never);
    await expect(checkAgentMentionRateLimit(USER)).resolves.toEqual({
      allowed: true,
    });
  });

  it("denies with retryAfterSeconds when the RPC reports denied", async () => {
    vi.mocked(typedRpc).mockResolvedValueOnce({
      data: [{ allowed: false, retry_after: 300, remaining: 0 }],
      error: null,
    } as never);
    await expect(checkAgentMentionRateLimit(USER)).resolves.toEqual({
      allowed: false,
      retryAfterSeconds: 300,
    });
  });

  it("buckets per AUTHOR, at the stated limit and window", async () => {
    vi.mocked(typedRpc).mockResolvedValueOnce({
      data: [{ allowed: true, retry_after: 0, remaining: 9 }],
      error: null,
    } as never);
    await checkAgentMentionRateLimit(USER);
    expect(vi.mocked(typedRpc)).toHaveBeenCalledWith(
      expect.anything(),
      "check_rate_limit",
      {
        p_key: `agent-mention:user:${USER}`,
        p_limit: AGENT_MENTION_LIMIT,
        p_window_seconds: AGENT_MENTION_WINDOW_SECONDS,
      },
    );
  });

  it("fails open on an RPC error", async () => {
    vi.mocked(typedRpc).mockResolvedValueOnce({
      data: null,
      error: { message: "boom" },
    } as never);
    await expect(checkAgentMentionRateLimit(USER)).resolves.toEqual({
      allowed: true,
    });
  });

  it("fails open on an RPC rejection/throw", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(typedRpc).mockRejectedValueOnce(new Error("network timeout"));
    await expect(checkAgentMentionRateLimit(USER)).resolves.toEqual({
      allowed: true,
    });
    spy.mockRestore();
  });
});
