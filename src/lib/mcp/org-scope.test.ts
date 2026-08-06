import { describe, expect, it } from "vitest";
import { resolveToolOrg } from "./org-scope";
import type { UserOrg } from "@/lib/auth/session";

const ORGS: UserOrg[] = [
  { id: "o1", name: "Acme", timezone: "UTC" },
  { id: "o2", name: "Globex", timezone: "Europe/Berlin" },
];

describe("resolveToolOrg", () => {
  it("returns the first org when nothing is requested", () => {
    expect(resolveToolOrg(ORGS)?.id).toBe("o1");
  });

  it("honours a requested id the user is a member of", () => {
    expect(resolveToolOrg(ORGS, "o2")?.id).toBe("o2");
  });

  it("returns null for a foreign id rather than falling back", () => {
    expect(resolveToolOrg(ORGS, "o-foreign")).toBeNull();
  });

  it("returns null when the user has no orgs", () => {
    expect(resolveToolOrg([], undefined)).toBeNull();
  });
});
