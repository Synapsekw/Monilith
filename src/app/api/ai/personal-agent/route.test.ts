import { describe, it, expect, vi, beforeEach } from "vitest";
import { signBody } from "@/lib/ai/agentic/hmac";

const SECRET = "test-secret";
const getUserAgentById = vi.fn();
const findUserAgentRun = vi.fn();
const insertUserAgentRun = vi.fn();

vi.mock("@/lib/env.server", () => ({
  getServerEnv: () => ({
    AI_PGNET_HMAC_SECRET: SECRET,
    RESEND_API_KEY: null,
    DIGEST_SECRET: "d",
    APP_BASE_URL: "https://app.example.com",
    DIGEST_FROM_EMAIL: null,
  }),
}));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => ({}) }));
vi.mock("@/lib/agents/agents-db", () => ({
  getUserAgentById: (...a: unknown[]) => getUserAgentById(...a),
  findUserAgentRun: (...a: unknown[]) => findUserAgentRun(...a),
  insertUserAgentRun: (...a: unknown[]) => insertUserAgentRun(...a),
}));

const { POST } = await import("./route");

function post(body: object, sig?: string) {
  const raw = JSON.stringify(body);
  return new Request("https://x/api/ai/personal-agent", {
    method: "POST",
    body: raw,
    headers: { "x-pulse-signature": sig ?? signBody(raw, SECRET) },
  });
}

const slot = {
  agent_id: crypto.randomUUID(),
  fire_date: "2026-08-01",
  fire_hour: 7,
};

beforeEach(() => {
  getUserAgentById.mockReset();
  findUserAgentRun.mockReset();
  insertUserAgentRun.mockReset();
  findUserAgentRun.mockResolvedValue(null);
});

describe("POST /api/ai/personal-agent", () => {
  it("rejects an unsigned request", async () => {
    const res = await POST(post(slot, "deadbeef"));
    expect(res.status).toBe(401);
  });

  it("rejects a tampered body", async () => {
    const raw = JSON.stringify(slot);
    const req = new Request("https://x/api/ai/personal-agent", {
      method: "POST",
      body: JSON.stringify({ ...slot, fire_hour: 9 }),
      headers: { "x-pulse-signature": signBody(raw, SECRET) },
    });
    expect((await POST(req)).status).toBe(401);
  });

  it("400s on a malformed body", async () => {
    const res = await POST(post({ nope: true }));
    expect(res.status).toBe(400);
  });

  it("404s for an unknown agent", async () => {
    getUserAgentById.mockResolvedValue(null);
    expect((await POST(post(slot))).status).toBe(404);
  });

  it("skips a disabled agent without writing a run", async () => {
    getUserAgentById.mockResolvedValue({ id: slot.agent_id, enabled: false });
    const res = await POST(post(slot));
    expect(await res.json()).toMatchObject({ status: "skipped" });
    expect(insertUserAgentRun).not.toHaveBeenCalled();
  });

  it("is a no-op when the fire slot already ran", async () => {
    getUserAgentById.mockResolvedValue({ id: slot.agent_id, enabled: true });
    findUserAgentRun.mockResolvedValue({ id: "existing" });
    const res = await POST(post(slot));
    expect(await res.json()).toMatchObject({ status: "noop" });
    expect(insertUserAgentRun).not.toHaveBeenCalled();
  });
});
