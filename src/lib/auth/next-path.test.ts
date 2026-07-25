import { describe, expect, it } from "vitest";
import { loginPath, NEXT_PATH_HEADER, safeNextPath } from "./next-path";

// Control characters are built from codepoints so the intent is visible and no
// literal control byte ends up in this source file.
const LF = "\n";
const CR = "\r";
const TAB = "\t";

describe("safeNextPath — accepts legitimate same-origin targets", () => {
  it("passes rooted paths through unchanged", () => {
    expect(safeNextPath("/")).toBe("/");
    expect(safeNextPath("/boards/123")).toBe("/boards/123");
    expect(safeNextPath("/boards/123?tab=x#c")).toBe("/boards/123?tab=x#c");
    expect(safeNextPath("/api/oauth/authorize?client_id=abc&state=xyz")).toBe(
      "/api/oauth/authorize?client_id=abc&state=xyz",
    );
    expect(safeNextPath("/change-password?recovery=1")).toBe(
      "/change-password?recovery=1",
    );
  });

  it("does NOT over-block percent-encoded slashes (they stay same-origin)", () => {
    // Verified with `new URL`: "/%2f%2fevil.com" resolves inside our origin.
    expect(safeNextPath("/%2f%2fevil.com")).toBe("/%2f%2fevil.com");
  });

  it("does NOT over-block a space in the path", () => {
    expect(safeNextPath("/a b/c")).toBe("/a%20b/c");
  });
});

describe("safeNextPath — refuses off-origin targets (open redirect)", () => {
  it("refuses absolute URLs", () => {
    expect(safeNextPath("https://evil.com")).toBe("/");
    expect(safeNextPath("http://evil.com/x")).toBe("/");
    expect(safeNextPath("HTTPS://evil.com")).toBe("/");
  });

  it("refuses protocol-relative targets", () => {
    expect(safeNextPath("//evil.com")).toBe("/");
    expect(safeNextPath("//evil.com/path")).toBe("/");
  });

  it("refuses backslash-tricked targets (browsers normalize \\ to /)", () => {
    expect(safeNextPath("/\\evil.com")).toBe("/");
    expect(safeNextPath("/\\\\evil.com")).toBe("/");
  });

  it("refuses control characters — stripping them yields '//evil.com'", () => {
    // THE live bypass on develop: GET /auth/callback?next=%2F%0A%2Fevil.com
    // 307s to https://evil.com/ today.
    expect(safeNextPath("/" + LF + "/evil.com")).toBe("/");
    expect(safeNextPath("/" + CR + "/evil.com")).toBe("/");
    expect(safeNextPath("/" + TAB + "/evil.com")).toBe("/");
    expect(safeNextPath("/" + LF + LF + "//evil.com")).toBe("/");
    expect(safeNextPath("/boards" + LF + "X-Injected: 1")).toBe("/");
  });

  it("refuses non-rooted and scheme-bearing values", () => {
    expect(safeNextPath("evil.com")).toBe("/");
    expect(safeNextPath("../evil.com")).toBe("/");
    expect(safeNextPath("javascript:alert(1)")).toBe("/");
    expect(safeNextPath("data:text/html,<script>alert(1)</script>")).toBe("/");
  });

  it("refuses a canonical form that BECOMES protocol-relative", () => {
    // new URL("/..//evil.com", origin).pathname === "//evil.com" (verified),
    // so the guard has to run on the canonicalized output too.
    expect(safeNextPath("/..//evil.com")).toBe("/");
    expect(safeNextPath("/a/..//evil.com")).toBe("/");
  });
});

describe("safeNextPath — refuses loops, arrays, junk and oversized values", () => {
  it("refuses auth-flow targets (redirect loop / sign-in-twice phishing)", () => {
    expect(safeNextPath("/login")).toBe("/");
    expect(safeNextPath("/login?next=%2Flogin")).toBe("/");
    expect(safeNextPath("/signup")).toBe("/");
    expect(safeNextPath("/auth/callback")).toBe("/");
    expect(safeNextPath("/forgot-password")).toBe("/");
  });

  it("refuses repeated params (searchParams yields string[])", () => {
    expect(safeNextPath(["/a", "/b"])).toBe("/");
  });

  it("refuses oversized values", () => {
    expect(safeNextPath("/" + "a".repeat(4000))).toBe("/");
  });

  it("defaults to / for missing values", () => {
    expect(safeNextPath(null)).toBe("/");
    expect(safeNextPath(undefined)).toBe("/");
    expect(safeNextPath("")).toBe("/");
  });
});

describe("loginPath", () => {
  it("returns a bare /login when there is nothing worth resuming", () => {
    expect(loginPath(null)).toBe("/login");
    expect(loginPath("/")).toBe("/login");
    expect(loginPath("//evil.com")).toBe("/login");
  });

  it("encodes the sanitized target as ?next=", () => {
    expect(loginPath("/boards/b1")).toBe("/login?next=%2Fboards%2Fb1");
    expect(loginPath("/api/oauth/authorize?client_id=a&state=b")).toBe(
      "/login?next=%2Fapi%2Foauth%2Fauthorize%3Fclient_id%3Da%26state%3Db",
    );
  });
});

describe("NEXT_PATH_HEADER", () => {
  it("uses the repo's x-pulse-* custom-header convention", () => {
    expect(NEXT_PATH_HEADER).toBe("x-pulse-path");
  });
});
