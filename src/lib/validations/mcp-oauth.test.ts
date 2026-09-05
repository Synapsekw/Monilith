import { describe, expect, it } from "vitest";
import {
  authorizeRequestSchema,
  registerClientSchema,
  tokenExchangeSchema,
} from "./mcp-oauth";

describe("registerClientSchema", () => {
  it("accepts a valid dynamic registration request", () => {
    const result = registerClientSchema.safeParse({
      client_name: "Claude Desktop",
      redirect_uris: ["https://claude.ai/api/mcp/oauth/callback"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty redirect_uris array", () => {
    const result = registerClientSchema.safeParse({
      client_name: "x",
      redirect_uris: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a redirect_uri with javascript: scheme", () => {
    const result = registerClientSchema.safeParse({
      client_name: "Claude Desktop",
      redirect_uris: ["javascript:alert('xss')"],
    });
    expect(result.success).toBe(false);
  });

  it("rejects redirect_uris array containing a javascript: URL", () => {
    const result = registerClientSchema.safeParse({
      client_name: "Claude Desktop",
      redirect_uris: [
        "https://claude.ai/api/mcp/oauth/callback",
        "javascript:alert('xss')",
      ],
    });
    expect(result.success).toBe(false);
  });

  it("accepts http:// URLs in addition to https://", () => {
    const result = registerClientSchema.safeParse({
      client_name: "Local Dev",
      redirect_uris: ["http://localhost:3000/callback"],
    });
    expect(result.success).toBe(true);
  });
});

describe("authorizeRequestSchema", () => {
  it("requires S256 PKCE", () => {
    const base = {
      client_id: "abc",
      redirect_uri: "https://claude.ai/callback",
      response_type: "code",
      code_challenge: "x".repeat(43),
      code_challenge_method: "plain",
    };
    expect(authorizeRequestSchema.safeParse(base).success).toBe(false);
    expect(
      authorizeRequestSchema.safeParse({
        ...base,
        code_challenge_method: "S256",
      }).success,
    ).toBe(true);
  });

  it("rejects redirect_uri with javascript: scheme", () => {
    const result = authorizeRequestSchema.safeParse({
      client_id: "abc",
      redirect_uri: "javascript:alert('xss')",
      response_type: "code",
      code_challenge: "x".repeat(43),
      code_challenge_method: "S256",
    });
    expect(result.success).toBe(false);
  });

  it("accepts http:// redirect_uri", () => {
    const result = authorizeRequestSchema.safeParse({
      client_id: "abc",
      redirect_uri: "http://localhost:3000/callback",
      response_type: "code",
      code_challenge: "x".repeat(43),
      code_challenge_method: "S256",
    });
    expect(result.success).toBe(true);
  });
});

describe("tokenExchangeSchema", () => {
  it("accepts an authorization_code grant", () => {
    const result = tokenExchangeSchema.safeParse({
      grant_type: "authorization_code",
      code: "abc",
      client_id: "def",
      code_verifier: "x".repeat(43),
      redirect_uri: "https://claude.ai/callback",
    });
    expect(result.success).toBe(true);
  });

  it("rejects redirect_uri with javascript: scheme in authorization_code grant", () => {
    const result = tokenExchangeSchema.safeParse({
      grant_type: "authorization_code",
      code: "abc",
      client_id: "def",
      code_verifier: "x".repeat(43),
      redirect_uri: "javascript:alert('xss')",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a refresh_token grant", () => {
    const result = tokenExchangeSchema.safeParse({
      grant_type: "refresh_token",
      refresh_token: "abc",
      client_id: "def",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown grant_type", () => {
    const result = tokenExchangeSchema.safeParse({
      grant_type: "client_credentials",
      client_id: "def",
    });
    expect(result.success).toBe(false);
  });
});

// A native/desktop MCP client (Cursor, VS Code) registers a private-use scheme
// callback — RFC 8252 §7.1. Rejecting those was what made `cursor://` connects
// fail at registration with "URL must be http or https".
const CURSOR_URI = "cursor://anysphere.cursor-retrieval/callback";

describe("private-use scheme redirect URIs (RFC 8252 §7.1)", () => {
  it("registerClientSchema accepts a private-use scheme callback", () => {
    const result = registerClientSchema.safeParse({
      client_name: "Cursor",
      redirect_uris: [CURSOR_URI],
    });
    expect(result.success).toBe(true);
  });

  it("registerClientSchema still rejects data: and file: alongside a valid URI", () => {
    for (const bad of [
      "data:text/html,<script>1</script>",
      "file:///etc/passwd",
    ]) {
      const result = registerClientSchema.safeParse({
        client_name: "Cursor",
        redirect_uris: [CURSOR_URI, bad],
      });
      expect(result.success).toBe(false);
    }
  });

  it("authorizeRequestSchema accepts the same private-use scheme callback", () => {
    const result = authorizeRequestSchema.safeParse({
      client_id: "abc",
      redirect_uri: CURSOR_URI,
      response_type: "code",
      code_challenge: "x".repeat(43),
      code_challenge_method: "S256",
    });
    expect(result.success).toBe(true);
  });

  it("tokenExchangeSchema accepts the same private-use scheme callback", () => {
    const result = tokenExchangeSchema.safeParse({
      grant_type: "authorization_code",
      code: "abc",
      client_id: "def",
      code_verifier: "x".repeat(43),
      redirect_uri: CURSOR_URI,
    });
    expect(result.success).toBe(true);
  });
});
