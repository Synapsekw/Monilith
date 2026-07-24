import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({
  requireUser: vi.fn().mockResolvedValue({ id: "user-1" }),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    from: () => ({
      update: () => ({
        eq: () => ({ eq: () => Promise.resolve({ error: null }) }),
      }),
    }),
  }),
}));

import { revokeConnectionAction } from "./connections-actions";

describe("revokeConnectionAction", () => {
  it("marks a token revoked and returns ok", async () => {
    const result = await revokeConnectionAction("t1");
    expect(result.ok).toBe(true);
  });
});
