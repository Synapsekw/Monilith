import { describe, expect, it } from "vitest";

import { GET, OPTIONS } from "./route";

const URL_ =
  "https://www.monolith.works/.well-known/oauth-authorization-server";

/** A cross-origin request, as a browser-based MCP client (claude.ai) sends it. */
function req(method = "GET") {
  return new Request(URL_, {
    method,
    headers: { Origin: "https://claude.ai" },
  });
}

describe("GET /.well-known/oauth-authorization-server", () => {
  it("returns RFC 8414 metadata issued for the request origin", async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      issuer: "https://www.monolith.works",
      authorization_endpoint: "https://www.monolith.works/api/oauth/authorize",
      token_endpoint: "https://www.monolith.works/api/oauth/token",
      registration_endpoint: "https://www.monolith.works/api/oauth/register",
      code_challenge_methods_supported: ["S256"],
    });
  });

  // Discovery metadata is public, unauthenticated and spec-mandated to be
  // cross-origin readable. Without this header a browser-based MCP client
  // cannot complete discovery, while server-side clients are unaffected —
  // which is exactly how this shipped to production unnoticed.
  it("is cross-origin readable", async () => {
    const res = await GET(req());
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("answers the CORS preflight instead of a bare 204 allow-list", async () => {
    const res = OPTIONS();
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toContain("GET");
    expect(res.headers.get("access-control-allow-headers")).toBe("*");
  });

  // The two .well-known routes must not drift again: both take their CORS
  // headers from mcp-handler's single metadataCorsOptionsRequestHandler().
  it("sends the same CORS headers as the protected-resource sibling", async () => {
    const sibling = await import("../oauth-protected-resource/route");
    const siblingHeaders = sibling.OPTIONS().headers;
    const res = await GET(req());
    for (const key of [
      "access-control-allow-origin",
      "access-control-allow-methods",
      "access-control-allow-headers",
      "access-control-max-age",
    ]) {
      expect([key, res.headers.get(key)]).toEqual([
        key,
        siblingHeaders.get(key),
      ]);
    }
  });
});
