import { describe, expect, it } from "vitest";
import { selectPurgeableUserIds } from "@/test/global-teardown";

const NOW = 1_700_000_000_000; // fixed epoch ms for deterministic ages
const MIN_AGE = 30 * 60 * 1000; // 30 min

function iso(msAgo: number): string {
  return new Date(NOW - msAgo).toISOString();
}

describe("selectPurgeableUserIds", () => {
  it("purges example.com users older than the threshold", () => {
    const users = [
      { id: "old", email: "a@example.com", created_at: iso(MIN_AGE + 1) },
    ];
    expect(selectPurgeableUserIds(users, NOW, MIN_AGE)).toEqual(["old"]);
  });

  it("spares example.com users newer than the threshold (a concurrent run)", () => {
    const users = [
      { id: "fresh", email: "b@example.com", created_at: iso(MIN_AGE - 1) },
    ];
    expect(selectPurgeableUserIds(users, NOW, MIN_AGE)).toEqual([]);
  });

  it("treats exactly-at-threshold as purgeable", () => {
    const users = [
      { id: "edge", email: "c@example.com", created_at: iso(MIN_AGE) },
    ];
    expect(selectPurgeableUserIds(users, NOW, MIN_AGE)).toEqual(["edge"]);
  });

  it("excludes non-example.com emails regardless of age", () => {
    const users = [
      { id: "real", email: "user@acme.com", created_at: iso(MIN_AGE * 10) },
    ];
    expect(selectPurgeableUserIds(users, NOW, MIN_AGE)).toEqual([]);
  });

  it("matches the suffix case-insensitively", () => {
    const users = [
      { id: "upper", email: "D@Example.Com", created_at: iso(MIN_AGE + 1) },
    ];
    expect(selectPurgeableUserIds(users, NOW, MIN_AGE)).toEqual(["upper"]);
  });

  it("skips users with missing or unparseable created_at", () => {
    const users = [
      { id: "noemail", email: undefined, created_at: iso(MIN_AGE + 1) },
      { id: "badts", email: "e@example.com", created_at: "not-a-date" },
    ];
    expect(selectPurgeableUserIds(users, NOW, MIN_AGE)).toEqual([]);
  });

  it("returns an empty array for empty input", () => {
    expect(selectPurgeableUserIds([], NOW, MIN_AGE)).toEqual([]);
  });
});
