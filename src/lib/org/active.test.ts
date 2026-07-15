import { describe, it, expect, vi } from "vitest";
import { pickActiveOrg } from "./active";
import type { UserOrg } from "@/lib/auth/session";

vi.mock("@/lib/auth/session", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth/session")>()),
  getUserOrgs: vi.fn(),
}));
vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

const orgs: UserOrg[] = [
  { id: "a", name: "Alpha", timezone: "UTC" },
  { id: "b", name: "Beta", timezone: "UTC" },
];

describe("pickActiveOrg", () => {
  it("returns the cookie-matched org", () => {
    expect(pickActiveOrg(orgs, "b")?.id).toBe("b");
  });
  it("falls back to orgs[0] when cookie is absent", () => {
    expect(pickActiveOrg(orgs, undefined)?.id).toBe("a");
  });
  it("falls back to orgs[0] when cookie is foreign/stale", () => {
    expect(pickActiveOrg(orgs, "zzz")?.id).toBe("a");
  });
  it("returns null for an empty org list", () => {
    expect(pickActiveOrg([], "a")).toBeNull();
  });
});

import { getUserOrgs } from "@/lib/auth/session";
import { cookies } from "next/headers";
import { resolveActiveOrg, getActiveOrgId } from "./active";

function withCookie(value: string | undefined) {
  (cookies as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    get: () => (value ? { value } : undefined),
  });
}

describe("resolveActiveOrg", () => {
  it("returns the cookie-matched org", async () => {
    (getUserOrgs as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      orgs,
    );
    withCookie("b");
    expect((await resolveActiveOrg())?.id).toBe("b");
    expect(await getActiveOrgId()).toBe("b");
  });
});
