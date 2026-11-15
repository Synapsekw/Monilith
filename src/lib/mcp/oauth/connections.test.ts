import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeOauthClient } from "@/test/oauth-tokens-fake-client";

let db: ReturnType<typeof fakeOauthClient>;

vi.mock("@/lib/auth/session", () => ({
  requireUser: vi.fn().mockResolvedValue({ id: "user-1" }),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => db.client,
}));

import { listMyConnections } from "./connections";

const row = (over: Record<string, unknown>) => ({
  id: "t1",
  user_id: "user-1",
  revoked_at: null,
  created_at: "2026-07-24T00:00:00.000Z",
  last_used_at: "2026-11-14T09:30:00.000Z",
  refresh_token_expires_at: "2027-02-12T09:30:00.000Z",
  oauth_clients: { client_name: "Claude Desktop" },
  ...over,
});

beforeEach(() => {
  db = fakeOauthClient();
});

describe("listMyConnections", () => {
  it("returns when each connection was last used and when it expires if left unused", async () => {
    db.tokens.push(row({}));

    expect(await listMyConnections()).toEqual([
      {
        id: "t1",
        clientName: "Claude Desktop",
        createdAt: "2026-07-24T00:00:00.000Z",
        lastUsedAt: "2026-11-14T09:30:00.000Z",
        expiresAt: "2027-02-12T09:30:00.000Z",
      },
    ]);
  });

  // The service-role client bypasses RLS, so these two filters ARE the
  // boundary. The fake applies them: drop either and these rows leak in.
  it("lists only the caller's live connections, newest first", async () => {
    db.tokens.push(
      row({ id: "old", created_at: "2026-01-01T00:00:00.000Z" }),
      row({ id: "new", created_at: "2026-09-01T00:00:00.000Z" }),
      row({ id: "someone-else", user_id: "user-2" }),
      row({ id: "revoked", revoked_at: "2026-10-01T00:00:00.000Z" }),
    );

    expect((await listMyConnections()).map((c) => c.id)).toEqual([
      "new",
      "old",
    ]);
  });

  it("falls back to a neutral name when the client row is gone", async () => {
    db.tokens.push(row({ oauth_clients: null }));
    expect((await listMyConnections())[0].clientName).toBe("Unknown app");
  });
});
