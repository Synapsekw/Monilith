import { describe, expect, it } from "vitest";
import {
  labelInitials,
  memberLabel,
  memberLabelInitials,
} from "./member-label";

describe("memberLabel", () => {
  it("prefers the name and does not print the email beside it", () => {
    expect(memberLabel({ fullName: "Ada Lovelace", email: "ada@x.com" })).toBe(
      "Ada Lovelace",
    );
  });
  it("falls back to the email when the name is missing or blank", () => {
    expect(memberLabel({ fullName: null, email: "ada@x.com" })).toBe(
      "ada@x.com",
    );
    expect(memberLabel({ fullName: "  ", email: "ada@x.com" })).toBe(
      "ada@x.com",
    );
  });
  it("says Unknown member only with neither", () => {
    expect(memberLabel({ fullName: null, email: null })).toBe("Unknown member");
    expect(memberLabel({ fullName: null })).toBe("Unknown member");
  });
});

describe("initials", () => {
  it("uses the email local part for nameless members", () => {
    expect(
      memberLabelInitials({ fullName: null, email: "ada.lovelace@x.com" }),
    ).toBe("AL");
    expect(memberLabelInitials({ fullName: null, email: "bob@x.com" })).toBe(
      "B",
    );
  });
  it("uses the name when there is one", () => {
    expect(
      memberLabelInitials({ fullName: "Grace Hopper", email: "z@x.com" }),
    ).toBe("GH");
  });
  it("is empty when nobody is known", () => {
    expect(memberLabelInitials({ fullName: null, email: null })).toBe("");
    expect(labelInitials("Unknown member")).toBe("");
  });
});
