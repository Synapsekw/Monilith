import { beforeEach, describe, expect, it, vi } from "vitest";

const mint = vi.fn();
const fromToken = vi.fn((token: string) => ({ token }));
vi.mock("@/lib/mcp/oauth/session-bridge", () => ({
  mintSessionForUser: (id: string) => mint(id),
  clientFromAccessToken: (t: string) => fromToken(t),
}));

import {
  __resetMonoSessionCache,
  forgetMonoSession,
  getMonoClient,
} from "./session";

const session = (token: string, expiresInSec: number) => ({
  access_token: token,
  expires_at: Math.floor(Date.now() / 1000) + expiresInSec,
});

describe("getMonoClient", () => {
  beforeEach(() => {
    __resetMonoSessionCache();
    mint.mockReset();
    fromToken.mockClear();
  });

  it("mints once and reuses the access token while it is fresh", async () => {
    mint.mockResolvedValue(session("t1", 3600));
    await getMonoClient("mono-1");
    await getMonoClient("mono-1");
    expect(mint).toHaveBeenCalledTimes(1);
    expect(fromToken).toHaveBeenLastCalledWith("t1");
  });

  it("mints a new session instead of refreshing when near expiry", async () => {
    mint
      .mockResolvedValueOnce(session("old", 60))
      .mockResolvedValueOnce(session("new", 3600));
    await getMonoClient("mono-1");
    await getMonoClient("mono-1");
    expect(mint).toHaveBeenCalledTimes(2);
    expect(fromToken).toHaveBeenLastCalledWith("new");
  });

  it("shares one in-flight mint between concurrent callers", async () => {
    mint.mockResolvedValue(session("t", 3600));
    await Promise.all([getMonoClient("mono-1"), getMonoClient("mono-1")]);
    expect(mint).toHaveBeenCalledTimes(1);
  });

  it("does not cache a failed mint", async () => {
    mint
      .mockRejectedValueOnce(new Error("rate limited"))
      .mockResolvedValueOnce(session("t", 3600));
    await expect(getMonoClient("mono-1")).rejects.toThrow("rate limited");
    await getMonoClient("mono-1");
    expect(mint).toHaveBeenCalledTimes(2);
  });

  it("forgets a Mono so the next call mints again", async () => {
    mint.mockResolvedValue(session("t", 3600));
    await getMonoClient("mono-1");
    forgetMonoSession("mono-1");
    await getMonoClient("mono-1");
    expect(mint).toHaveBeenCalledTimes(2);
  });
});
