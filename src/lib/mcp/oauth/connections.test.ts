import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({
  requireUser: vi.fn().mockResolvedValue({ id: "user-1" }),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          is: () => ({
            order: () =>
              Promise.resolve({
                data: [
                  {
                    id: "t1",
                    created_at: "2026-07-24T00:00:00Z",
                    oauth_clients: { client_name: "Claude Desktop" },
                  },
                ],
                error: null,
              }),
          }),
        }),
      }),
    }),
  }),
}));

import { listMyConnections } from "./connections";

describe("listMyConnections", () => {
  it("returns the caller's active connections with client name", async () => {
    const result = await listMyConnections();
    expect(result).toEqual([
      {
        id: "t1",
        clientName: "Claude Desktop",
        createdAt: "2026-07-24T00:00:00Z",
      },
    ]);
  });
});
