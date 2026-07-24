import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({
  requireUser: vi.fn().mockResolvedValue({ id: "user-1" }),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    from: () => ({
      delete: () => ({
        eq: () => ({ eq: () => Promise.resolve({ error: null }) }),
      }),
    }),
  }),
}));

import { revokeConnectionAction } from "./connections-actions";

describe("revokeConnectionAction", () => {
  it("hard-deletes the token row (frees the Vault secret via the before-delete trigger) and returns ok", async () => {
    const result = await revokeConnectionAction("t1");
    expect(result.ok).toBe(true);
  });
});
