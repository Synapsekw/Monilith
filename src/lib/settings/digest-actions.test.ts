import { describe, expect, it, vi, beforeEach } from "vitest";

const getUser = vi.fn();
const update = vi.fn();
const from = vi.fn(() => ({ update }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { getUser }, from })),
}));

import { setEmailDigestOptOut, setEmailBriefingOptOut } from "./digest-actions";

beforeEach(() => {
  getUser.mockReset();
  update.mockReset();
  from.mockClear();
});

describe("setEmailDigestOptOut", () => {
  it("updates the caller's own profile flag", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    const eq = vi.fn(async () => ({ error: null }));
    update.mockReturnValue({ eq });

    const res = await setEmailDigestOptOut({ optOut: true });

    expect(res.ok).toBe(true);
    expect(from).toHaveBeenCalledWith("profiles");
    expect(update).toHaveBeenCalledWith({ email_digest_opt_out: true });
    expect(eq).toHaveBeenCalledWith("id", "user-1");
  });

  it("rejects when unauthenticated", async () => {
    getUser.mockResolvedValue({ data: { user: null } });

    const res = await setEmailDigestOptOut({ optOut: true });

    expect(res.ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it("validates input at the boundary", async () => {
    const res = await setEmailDigestOptOut({
      optOut: "yes",
    } as never);

    expect(res.ok).toBe(false);
    expect(getUser).not.toHaveBeenCalled();
  });
});

// I2: the "turn it back on in Settings" recovery path the unsubscribe email
// promises for the daily agent briefing.
describe("setEmailBriefingOptOut", () => {
  it("updates the caller's own profile flag", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    const eq = vi.fn(async () => ({ error: null }));
    update.mockReturnValue({ eq });

    const res = await setEmailBriefingOptOut({ optOut: true });

    expect(res.ok).toBe(true);
    expect(from).toHaveBeenCalledWith("profiles");
    expect(update).toHaveBeenCalledWith({ email_briefing_opt_out: true });
    expect(eq).toHaveBeenCalledWith("id", "user-1");
  });

  it("rejects when unauthenticated", async () => {
    getUser.mockResolvedValue({ data: { user: null } });

    const res = await setEmailBriefingOptOut({ optOut: true });

    expect(res.ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it("validates input at the boundary", async () => {
    const res = await setEmailBriefingOptOut({
      optOut: "yes",
    } as never);

    expect(res.ok).toBe(false);
    expect(getUser).not.toHaveBeenCalled();
  });
});
