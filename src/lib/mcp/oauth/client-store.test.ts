import { describe, expect, it, vi } from "vitest";
import { registerOauthClient } from "./client-store";

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    from: () => ({
      insert: () => ({
        select: () => ({
          single: () =>
            Promise.resolve({
              data: {
                id: "x",
                client_id: "generated-id",
                client_name: "Claude Desktop",
                redirect_uris: ["https://claude.ai/callback"],
                created_at: "2026-07-24T00:00:00Z",
              },
              error: null,
            }),
        }),
      }),
    }),
  }),
}));

describe("registerOauthClient", () => {
  it("inserts a new client row and returns it", async () => {
    const client = await registerOauthClient({
      client_name: "Claude Desktop",
      redirect_uris: ["https://claude.ai/callback"],
    });
    expect(client.client_name).toBe("Claude Desktop");
    expect(client.client_id).toBe("generated-id");
  });
});
