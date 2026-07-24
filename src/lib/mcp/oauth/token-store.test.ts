import { describe, expect, it, vi } from "vitest";

const rows: Record<string, unknown>[] = [];

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        rows.push(row);
        return { error: null };
      },
      select: () => ({
        eq: (col: string, val: string) => ({
          is: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: rows.find((r) => r[col] === val) ?? null,
                error: null,
              }),
          }),
          maybeSingle: () =>
            Promise.resolve({
              data: rows.find((r) => r[col] === val) ?? null,
              error: null,
            }),
        }),
      }),
      // Mirrors the atomic conditional-UPDATE shape rotateTokenPair() issues:
      // .update(patch).eq(...).eq(...).is("revoked_at", null).select(...).maybeSingle()
      // Only a row matching every accumulated filter is mutated and returned, so a
      // second call keyed on an already-rotated (stale) hash matches nothing.
      update: (patch: Record<string, unknown>) => {
        const filters: { col: string; val: unknown }[] = [];
        const builder = {
          eq(col: string, val: unknown) {
            filters.push({ col, val });
            return builder;
          },
          is(col: string, val: unknown) {
            filters.push({ col, val });
            return builder;
          },
          select: () => ({
            maybeSingle: () => {
              const idx = rows.findIndex((r) =>
                filters.every((f) =>
                  f.val === null ? r[f.col] == null : r[f.col] === f.val,
                ),
              );
              if (idx === -1) {
                return Promise.resolve({ data: null, error: null });
              }
              rows[idx] = { ...rows[idx], ...patch };
              return Promise.resolve({ data: rows[idx], error: null });
            },
          }),
        };
        return builder;
      },
    }),
  }),
}));

import { hashToken } from "./crypto";
import {
  issueTokenPair,
  lookupTokenByAccessToken,
  rotateTokenPair,
} from "./token-store";

describe("issueTokenPair / lookupTokenByAccessToken", () => {
  it("issues a token pair that can be looked up by its hash", async () => {
    const issued = await issueTokenPair({
      clientId: "client-1",
      userId: "user-1",
      bridgeSecretId: "secret-1",
    });
    expect(issued.accessToken).toBeTruthy();
    expect(issued.expiresIn).toBeGreaterThan(0);

    const found = await lookupTokenByAccessToken(issued.accessToken);
    expect(found?.user_id).toBe("user-1");
    expect(found?.access_token_hash).toBe(hashToken(issued.accessToken));
  });
});

describe("rotateTokenPair (atomic)", () => {
  it("rotates a valid refresh token for the matching client", async () => {
    const issued = await issueTokenPair({
      clientId: "client-2",
      userId: "user-2",
      bridgeSecretId: "secret-2",
    });

    const rotated = await rotateTokenPair(issued.refreshToken, "client-2");

    expect(rotated).not.toBeNull();
    expect(rotated?.accessToken).toBeTruthy();
    expect(rotated?.refreshToken).toBeTruthy();
    expect(rotated?.accessToken).not.toBe(issued.accessToken);
    expect(rotated?.refreshToken).not.toBe(issued.refreshToken);
  });

  it("returns null on a second concurrent-style call with the same now-stale refresh token", async () => {
    const issued = await issueTokenPair({
      clientId: "client-3",
      userId: "user-3",
      bridgeSecretId: "secret-3",
    });

    // Two "concurrent" callers both present the original refresh token. Only the
    // first UPDATE can match the row (its hash is still the pre-rotation hash);
    // once that succeeds the row's hash has already changed, so the second call
    // — presenting the same stale token — must fail rather than double-rotate.
    const first = await rotateTokenPair(issued.refreshToken, "client-3");
    const second = await rotateTokenPair(issued.refreshToken, "client-3");

    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });

  it("rejects a client_id mismatch", async () => {
    const issued = await issueTokenPair({
      clientId: "client-4",
      userId: "user-4",
      bridgeSecretId: "secret-4",
    });

    const rotated = await rotateTokenPair(issued.refreshToken, "wrong-client");

    expect(rotated).toBeNull();
  });

  it("returns null for an unknown refresh token", async () => {
    const rotated = await rotateTokenPair("does-not-exist", "client-1");
    expect(rotated).toBeNull();
  });
});
