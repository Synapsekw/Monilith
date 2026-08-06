import { describe, it, expect, vi, beforeEach } from "vitest";

const requireUser = vi.fn();
const getOauthClient = vi.fn();
const createAuthorizationCode = vi.fn();
const redirect = vi.fn();

vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/mcp/oauth/client-store", () => ({
  getOauthClient: (...a: unknown[]) => getOauthClient(...a),
}));
vi.mock("@/lib/mcp/oauth/code-store", () => ({
  createAuthorizationCode: (...a: unknown[]) => createAuthorizationCode(...a),
}));
vi.mock("next/navigation", () => ({
  redirect: (...a: unknown[]) => redirect(...a),
}));

import { approveConsent } from "./actions";

const VALID_REDIRECT = "https://client.example.com/callback";
const CODE_CHALLENGE = "a".repeat(43);

/**
 * Mirrors `authorizeRequestSchema` in `@/lib/validations/mcp-oauth`: every
 * field it marks required must be present or the action throws before it ever
 * reaches the client lookup. `code_challenge_method` is a literal "S256".
 */
function form(over: Record<string, string> = {}) {
  const fd = new FormData();
  fd.set("client_id", "client-1");
  fd.set("redirect_uri", VALID_REDIRECT);
  fd.set("response_type", "code");
  fd.set("code_challenge", CODE_CHALLENGE);
  fd.set("code_challenge_method", "S256");
  fd.set("state", "xyz");
  for (const [k, v] of Object.entries(over)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ id: "user-1" });
  getOauthClient.mockResolvedValue({ redirect_uris: [VALID_REDIRECT] });
  createAuthorizationCode.mockResolvedValue("the-code");
});

describe("approveConsent", () => {
  it("refuses a redirect_uri the client did not register", async () => {
    await expect(
      approveConsent(form({ redirect_uri: "https://evil.example.com/steal" })),
    ).rejects.toThrow(/Unknown client or redirect_uri/);
    expect(createAuthorizationCode).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("refuses an unknown client_id", async () => {
    getOauthClient.mockResolvedValue(null);
    await expect(approveConsent(form())).rejects.toThrow(
      /Unknown client or redirect_uri/,
    );
    expect(createAuthorizationCode).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("issues a code and redirects with code + state on the happy path", async () => {
    await approveConsent(form());
    expect(createAuthorizationCode).toHaveBeenCalledWith({
      clientId: "client-1",
      userId: "user-1",
      redirectUri: VALID_REDIRECT,
      codeChallenge: CODE_CHALLENGE,
    });
    const target = new URL(redirect.mock.calls[0][0] as string);
    expect(target.origin + target.pathname).toBe(VALID_REDIRECT);
    expect(target.searchParams.get("code")).toBe("the-code");
    expect(target.searchParams.get("state")).toBe("xyz");
  });

  it("omits state from the redirect when the request had none", async () => {
    const fd = form();
    fd.delete("state");
    await approveConsent(fd);
    const target = new URL(redirect.mock.calls[0][0] as string);
    expect(target.searchParams.get("code")).toBe("the-code");
    expect(target.searchParams.has("state")).toBe(false);
  });

  it("rejects a malformed request before looking up the client", async () => {
    await expect(approveConsent(form({ client_id: "" }))).rejects.toThrow(
      /Invalid authorization request/,
    );
    expect(getOauthClient).not.toHaveBeenCalled();
  });

  it("rejects a request whose code_challenge_method is not S256", async () => {
    await expect(
      approveConsent(form({ code_challenge_method: "plain" })),
    ).rejects.toThrow(/Invalid authorization request/);
    expect(getOauthClient).not.toHaveBeenCalled();
  });

  it("rejects a non-http(s) redirect_uri before looking up the client", async () => {
    await expect(
      approveConsent(form({ redirect_uri: "javascript:alert(1)" })),
    ).rejects.toThrow(/Invalid authorization request/);
    expect(getOauthClient).not.toHaveBeenCalled();
  });
});

/**
 * A CLI client (Hermes, and any RFC 8252 native client) registers ONE loopback
 * callback but binds a fresh ephemeral port on every login, so the port it
 * presents at consent time is almost never the one on file.
 */
describe("approveConsent — RFC 8252 §7.3 loopback clients", () => {
  const REGISTERED_LOOPBACK = "http://127.0.0.1:38559/callback";

  beforeEach(() => {
    getOauthClient.mockResolvedValue({ redirect_uris: [REGISTERED_LOOPBACK] });
  });

  it("issues a code for a different ephemeral port on the same loopback callback", async () => {
    const presented = "http://127.0.0.1:45011/callback";
    await approveConsent(form({ redirect_uri: presented }));

    // The code records the PRESENTED uri, not the registered one: the token
    // endpoint compares exactly against this, and the client will send back the
    // port it is actually listening on.
    expect(createAuthorizationCode).toHaveBeenCalledWith(
      expect.objectContaining({ redirectUri: presented }),
    );
    const target = new URL(redirect.mock.calls[0][0] as string);
    expect(target.port).toBe("45011");
    expect(target.searchParams.get("code")).toBe("the-code");
  });

  it("still refuses a different PATH on the loopback interface", async () => {
    await expect(
      approveConsent(form({ redirect_uri: "http://127.0.0.1:45011/evil" })),
    ).rejects.toThrow(/Unknown client or redirect_uri/);
    expect(createAuthorizationCode).not.toHaveBeenCalled();
  });

  it("does not extend port flexibility to a non-loopback host", async () => {
    getOauthClient.mockResolvedValue({
      redirect_uris: ["https://client.example.com:443/callback"],
    });
    await expect(
      approveConsent(
        form({ redirect_uri: "https://client.example.com:8443/callback" }),
      ),
    ).rejects.toThrow(/Unknown client or redirect_uri/);
    expect(createAuthorizationCode).not.toHaveBeenCalled();
  });
});
