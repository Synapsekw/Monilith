import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const { requireUser, getOauthClient } = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getOauthClient: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/mcp/oauth/client-store", () => ({
  getOauthClient: (id: string) => getOauthClient(id),
}));
// Server Action — the form only needs a callable reference to render.
vi.mock("./actions", () => ({ approveConsent: async () => {} }));

import { ConsentGate } from "./page";

const PARAMS = {
  client_id: "cli_123",
  redirect_uri: "https://claude.ai/api/mcp/auth_callback",
  response_type: "code",
  code_challenge: "a".repeat(43),
  code_challenge_method: "S256",
};

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ id: "u1", email: "owner@example.com" });
  getOauthClient.mockResolvedValue({
    client_id: "cli_123",
    client_name: "Claude Desktop",
  });
});

/**
 * This screen is the ONE surface an external MCP client renders at the moment
 * the user grants access, so the product name on it is the highest-stakes copy
 * in the app. It said "Pulse" — a product name that no longer exists.
 */
describe("OAuth consent screen", () => {
  it("asks to access the user's Monolith account, never a Pulse one", async () => {
    render(await ConsentGate({ searchParams: Promise.resolve(PARAMS) }));

    expect(
      screen.getByRole("heading", {
        name: /Claude Desktop wants to access your Monolith account/i,
      }),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/pulse/i);
  });

  it("still shows who is signed in and the grant button", async () => {
    render(await ConsentGate({ searchParams: Promise.resolve(PARAMS) }));

    expect(screen.getByText(/owner@example\.com/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /allow access/i }),
    ).toBeInTheDocument();
  });

  it("rejects a malformed authorization request before naming the client", async () => {
    render(
      await ConsentGate({
        searchParams: Promise.resolve({ ...PARAMS, response_type: "token" }),
      }),
    );

    expect(
      screen.getByText(/invalid authorization request/i),
    ).toBeInTheDocument();
    expect(getOauthClient).not.toHaveBeenCalled();
  });
});
