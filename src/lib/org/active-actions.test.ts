import { describe, it, expect, vi, beforeEach } from "vitest";

const set = vi.fn();
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ set })) }));
vi.mock("@/lib/auth/session", () => ({ getUserOrgs: vi.fn() }));

import { getUserOrgs } from "@/lib/auth/session";
import { setActiveOrg } from "./active-actions";
import { ACTIVE_ORG_COOKIE } from "./active";

beforeEach(() => set.mockClear());

describe("setActiveOrg", () => {
  it("sets the cookie for an org the user belongs to", async () => {
    (getUserOrgs as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "a" },
      { id: "b" },
    ]);
    await setActiveOrg("b");
    expect(set).toHaveBeenCalledWith(
      ACTIVE_ORG_COOKIE,
      "b",
      expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/" }),
    );
  });
  it("ignores a foreign org id (does not set the cookie)", async () => {
    (getUserOrgs as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: "a" }]);
    await setActiveOrg("zzz");
    expect(set).not.toHaveBeenCalled();
  });
});
