import { describe, expect, it } from "vitest";
import {
  assignableMembers,
  monoAssignErrorMessage,
  withMonoMembers,
} from "./members";
import type { MyMono, OrgMono } from "./types";

const people = [
  { userId: "u1", fullName: "Ada Owner", email: "a@x.io", avatarUrl: null },
  { userId: "u2", fullName: "Ben Mate", email: "b@x.io", avatarUrl: null },
];
const monos: OrgMono[] = [
  { userId: "m1", ownerId: "u1", name: "Nova", color: "#7395ff" },
  { userId: "m2", ownerId: "u2", name: "Pip", color: "#3fe0a5" },
];
const mine = (brain: MyMono["brain"]): MyMono => ({
  userId: "m1",
  orgId: "o1",
  ownerId: "u1",
  name: "Nova",
  color: "#7395ff",
  brain,
  keyProvider: brain === "key" ? "anthropic" : null,
  lastSeenAt: null,
  createdAt: "t",
});

describe("withMonoMembers", () => {
  it("appends Monos after the people, named and owned", () => {
    const rows = withMonoMembers(people, monos, mine("key"));
    expect(rows.map((r) => r.userId)).toEqual(["u1", "u2", "m1", "m2"]);
    expect(rows[2]).toEqual({
      userId: "m1",
      fullName: "Nova",
      email: null,
      avatarUrl: null,
      mono: {
        color: "#7395ff",
        ownerId: "u1",
        ownerName: "Ada Owner",
        directable: true,
      },
    });
    expect(rows[3]!.mono!.directable).toBe(false);
  });

  it("makes no Mono directable when the viewer's own Mono is asleep", () => {
    const rows = withMonoMembers(people, monos, mine("none"));
    expect(rows.filter((r) => r.mono?.directable)).toEqual([]);
  });
});

describe("assignableMembers", () => {
  it("keeps people and the viewer's own awake Mono only", () => {
    const rows = withMonoMembers(people, monos, mine("key"));
    expect(assignableMembers(rows).map((r) => r.userId)).toEqual([
      "u1",
      "u2",
      "m1",
    ]);
  });
});

describe("monoAssignErrorMessage", () => {
  it("turns the owner-only guard into plain copy", () => {
    expect(
      monoAssignErrorMessage({
        code: "42501",
        message: "only its owner can assign a Mono",
      }),
    ).toBe("Only its owner can assign a Mono.");
  });

  it("turns the asleep guard into plain copy", () => {
    expect(
      monoAssignErrorMessage({
        code: "P0001",
        message: "this Mono is asleep. Give it a brain before assigning it",
      }),
    ).toBe("This Mono is asleep. Its owner can wake it in Settings.");
  });

  it("leaves every other error alone", () => {
    expect(
      monoAssignErrorMessage({
        code: "42501",
        message: "new row violates row-level security policy",
      }),
    ).toBeNull();
    expect(monoAssignErrorMessage({ message: "boom" })).toBeNull();
  });
});
