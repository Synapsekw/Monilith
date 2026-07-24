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
