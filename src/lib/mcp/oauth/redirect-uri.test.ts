import { describe, it, expect } from "vitest";
import { isRegisteredRedirectUri } from "./redirect-uri";

describe("isRegisteredRedirectUri — exact matching (the default)", () => {
  it("accepts a byte-identical registered URI", () => {
    expect(
      isRegisteredRedirectUri(
        ["https://claude.ai/api/mcp/auth_callback"],
        "https://claude.ai/api/mcp/auth_callback",
      ),
    ).toBe(true);
  });

  it("rejects a URI the client never registered", () => {
    expect(
      isRegisteredRedirectUri(
        ["https://claude.ai/api/mcp/auth_callback"],
        "https://evil.example.com/steal",
      ),
    ).toBe(false);
  });

  it("rejects a different path on a registered remote host", () => {
    expect(
      isRegisteredRedirectUri(
        ["https://claude.ai/api/mcp/auth_callback"],
        "https://claude.ai/api/mcp/other",
      ),
    ).toBe(false);
  });

  it("rejects a different PORT on a remote (non-loopback) host", () => {
    expect(
      isRegisteredRedirectUri(
        ["https://claude.ai/api/mcp/auth_callback"],
        "https://claude.ai:8443/api/mcp/auth_callback",
      ),
    ).toBe(false);
  });

  it("returns false for an empty registration list", () => {
    expect(isRegisteredRedirectUri([], "http://127.0.0.1:1234/callback")).toBe(
      false,
    );
  });

  it("returns false rather than throwing on an unparseable candidate", () => {
    expect(
      isRegisteredRedirectUri(["http://127.0.0.1:1/cb"], "not a url"),
    ).toBe(false);
  });

  it("ignores an unparseable registered entry instead of throwing", () => {
    expect(
      isRegisteredRedirectUri(
        ["::::", "http://127.0.0.1:1/cb"],
        "http://127.0.0.1:9999/cb",
      ),
    ).toBe(true);
  });
});

describe("isRegisteredRedirectUri — RFC 8252 §7.3 loopback port flexibility", () => {
  it("accepts a different ephemeral port on 127.0.0.1", () => {
    expect(
      isRegisteredRedirectUri(
        ["http://127.0.0.1:38559/callback"],
        "http://127.0.0.1:45011/callback",
      ),
    ).toBe(true);
  });

  it("accepts a different ephemeral port on the IPv6 loopback", () => {
    expect(
      isRegisteredRedirectUri(
        ["http://[::1]:38559/callback"],
        "http://[::1]:45011/callback",
      ),
    ).toBe(true);
  });

  it("accepts a different ephemeral port on localhost", () => {
    expect(
      isRegisteredRedirectUri(
        ["http://localhost:38559/callback"],
        "http://localhost:45011/callback",
      ),
    ).toBe(true);
  });

  it("accepts an omitted port against a registered explicit port", () => {
    expect(
      isRegisteredRedirectUri(
        ["http://127.0.0.1:38559/callback"],
        "http://127.0.0.1/callback",
      ),
    ).toBe(true);
  });

  // The host is NOT normalized across spellings: 127.0.0.1, [::1] and localhost
  // are three distinct registrations. `localhost` can resolve somewhere other
  // than the loopback interface (RFC 8252 §8.3), so a client that registered the
  // IP literal must not be redirectable to a name.
  it("does not treat localhost as interchangeable with 127.0.0.1", () => {
    expect(
      isRegisteredRedirectUri(
        ["http://127.0.0.1:38559/callback"],
        "http://localhost:38559/callback",
      ),
    ).toBe(false);
  });

  it("does not treat 127.0.0.1 as interchangeable with the IPv6 loopback", () => {
    expect(
      isRegisteredRedirectUri(
        ["http://127.0.0.1:38559/callback"],
        "http://[::1]:38559/callback",
      ),
    ).toBe(false);
  });

  it("still requires the PATH to match exactly", () => {
    expect(
      isRegisteredRedirectUri(
        ["http://127.0.0.1:38559/callback"],
        "http://127.0.0.1:45011/evil",
      ),
    ).toBe(false);
  });

  it("still requires the QUERY to match exactly", () => {
    expect(
      isRegisteredRedirectUri(
        ["http://127.0.0.1:38559/callback?a=1"],
        "http://127.0.0.1:45011/callback?a=2",
      ),
    ).toBe(false);
  });

  it("still requires the SCHEME to match", () => {
    expect(
      isRegisteredRedirectUri(
        ["http://127.0.0.1:38559/callback"],
        "https://127.0.0.1:45011/callback",
      ),
    ).toBe(false);
  });

  it("does not relax the port for an https loopback registration", () => {
    expect(
      isRegisteredRedirectUri(
        ["https://127.0.0.1:38559/callback"],
        "https://127.0.0.1:45011/callback",
      ),
    ).toBe(false);
  });

  it("refuses to vary the port when embedded credentials differ", () => {
    expect(
      isRegisteredRedirectUri(
        ["http://127.0.0.1:38559/callback"],
        "http://attacker@127.0.0.1:45011/callback",
      ),
    ).toBe(false);
  });

  // A near-miss host that merely *starts* with the loopback literal must not be
  // swept in by a prefix-style check.
  it("rejects a lookalike host that is not the loopback interface", () => {
    expect(
      isRegisteredRedirectUri(
        ["http://127.0.0.1:38559/callback"],
        "http://127.0.0.1.evil.com:45011/callback",
      ),
    ).toBe(false);
  });

  it("does not open port flexibility on an arbitrary private-range host", () => {
    expect(
      isRegisteredRedirectUri(
        ["http://192.168.1.5:38559/callback"],
        "http://192.168.1.5:45011/callback",
      ),
    ).toBe(false);
  });

  it("matches against any one of several registered URIs", () => {
    expect(
      isRegisteredRedirectUri(
        ["https://claude.ai/api/mcp/auth_callback", "http://[::1]:1/cb"],
        "http://[::1]:65535/cb",
      ),
    ).toBe(true);
  });
});
