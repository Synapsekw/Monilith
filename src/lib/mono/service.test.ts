import { describe, expect, it } from "vitest";
import { createMonoService } from "./service";
import { botConfig } from "./providers";
import { memoryStore } from "./test-store";
import type { MonoEnvironment } from "./config";
import type { MonoStore } from "./store";

const origin = "https://www.monolith.works";
const base: MonoEnvironment = {
  MONO_SITE_ORIGIN: origin,
  MONO_OPENAI_API_KEY: "test-only-model-key",
  MONO_SESSION_SECRET: "test-only-session-secret-32-characters-long",
  MONO_BOT_WEBHOOK_URL: "https://api2.cursor.sh/automations/webhook/test",
  MONO_BOT_WEBHOOK_KEY: "test-only-webhook-key",
  MONO_CALLBACKS_ENABLED: "true",
  MONO_REPORTING_ENABLED: "true",
};
const lead = {
  name: "Example Visitor",
  email: "visitor@example.test",
  phone: "",
  reason: "Discuss a Monolith demo",
};
const modelReply = {
  reply: "Explore the workspace.",
  summary: "Visitor asks about Monolith.",
  offer_contact: true,
  links: [{ label: "Workspace", href: "#product" }],
};
const modelResponse = (answer: unknown = modelReply) =>
  Response.json({
    status: "completed",
    output: [
      { type: "reasoning" },
      {
        type: "message",
        content: [{ type: "output_text", text: JSON.stringify(answer) }],
      },
    ],
  });
type Body = {
  mode?: string;
  token?: string;
  delivery?: string;
  history?: unknown[];
  last_request_id?: string;
  callbacks_enabled?: boolean;
  reporting_enabled?: boolean;
  callback_receipt?: { delivery: string; request_id: string };
  reply?: string;
  error?: string;
};
function fixture(
  options: {
    env?: MonoEnvironment;
    fetcher?: typeof fetch;
    now?: () => number;
    store?: MonoStore;
  } = {},
) {
  const calls: { url: string; init?: RequestInit }[] = [];
  let delivery: number | "timeout" = 200;
  const fetcher: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("api.openai.com")) return modelResponse();
    if (delivery === "timeout")
      throw Error("simulated ambiguous network failure");
    return new Response("", { status: delivery });
  };
  const store = options.store || memoryStore(options.now);
  const env = { ...base, ...options.env };
  const handle = createMonoService({
    env,
    store,
    fetcher: options.fetcher || fetcher,
    now: options.now,
  });
  let cookie = "",
    token = "";
  async function call(
    action: string,
    data?: unknown,
    headers: Record<string, string> = {},
  ) {
    const r = await handle(
      new Request(origin + "/api/mono?action=" + action, {
        method: action === "status" ? "GET" : "POST",
        headers: {
          Origin: origin,
          Cookie: cookie,
          "X-Mono-Token": token,
          "Content-Type": "application/json",
          ...headers,
        },
        ...(action === "status" ? {} : { body: JSON.stringify(data) }),
      }),
      { ip: "192.0.2.1" },
    );
    const setCookie = r.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    const body: Body = await r.json();
    if (body.token) token = body.token;
    return { status: r.status, body, headers: r.headers };
  }
  return {
    call,
    calls,
    env,
    handle,
    store,
    setDelivery(value: number | "timeout") {
      delivery = value;
    },
  };
}

describe("Mono public protocol", () => {
  it("stays in guide mode without storage or network when unconfigured", async () => {
    const handle = createMonoService({
      env: {},
      store: null,
      fetcher: async () => {
        throw Error("network forbidden");
      },
    });
    const r = await handle(new Request(origin + "/api/mono?action=status"));
    expect(await r.json()).toEqual({
      mode: "preview",
      callbacks_enabled: false,
      reporting_enabled: false,
    });
  });
  it("secures the session cookie and requires exact origin and CSRF token", async () => {
    const f = fixture(),
      status = await f.call("status");
    expect(status.body.mode).toBe("live");
    expect(status.headers.get("set-cookie")).toMatch(
      /__Host-mono_session=.*HttpOnly; SameSite=Strict; Path=\/; Max-Age=7200; Secure/,
    );
    const input = { message: "hello", request_id: "request-chat-0001" };
    const badHeaders: Record<string, string>[] = [
      { "X-Mono-Token": "wrong" },
      { Origin: "https://evil.test" },
      { Origin: "" },
      { "Sec-Fetch-Site": "cross-site" },
    ];
    for (const headers of badHeaders)
      expect((await f.call("chat", input, headers)).status).toBe(403);
    expect(f.calls).toHaveLength(0);
  });
  it("defaults bot contact and reports off even when bot credentials exist", async () => {
    const f = fixture({
      env: {
        MONO_CALLBACKS_ENABLED: undefined,
        MONO_REPORTING_ENABLED: undefined,
      },
    });
    const status = await f.call("status");
    expect(status.body).toMatchObject({
      callbacks_enabled: false,
      reporting_enabled: false,
    });
    expect(
      (
        await f.call("callback", {
          request_id: "request-contact-001",
          lead,
          confirmed: true,
        })
      ).status,
    ).toBe(503);
    const chat = await f.call("chat", {
      request_id: "request-chat-0001",
      message: "Hello",
    });
    expect(chat.body).not.toHaveProperty("contact_request");
    expect(f.calls).toHaveLength(1);
  });
  it("replays one saved chat reply and report, and restores history", async () => {
    const f = fixture();
    await f.call("status");
    const input = {
      message: "Show me Monolith",
      request_id: "request-chat-0001",
    };
    const first = await f.call("chat", input),
      second = await f.call("chat", input);
    expect(first.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(f.calls).toHaveLength(2);
    expect(JSON.parse(String(f.calls[0].init?.body))).toMatchObject({
      model: "gpt-6-luna",
      store: false,
      reasoning: { effort: "none" },
    });
    expect(JSON.parse(String(f.calls[1].init?.body))).toMatchObject({
      type: "conversation_summary",
      messages: [
        { role: "user", content: "Show me Monolith" },
        { role: "assistant", content: "Explore the workspace." },
      ],
    });
    expect((await f.call("status")).body).toMatchObject({
      last_request_id: input.request_id,
      history: [
        { role: "user", content: "Show me Monolith" },
        { role: "assistant", content: "Explore the workspace." },
      ],
    });
    expect(
      (await f.call("chat", { ...input, message: "Different message" })).status,
    ).toBe(409);
  });
  it("requires consent and valid contact fields before delivering once", async () => {
    const f = fixture();
    await f.call("status");
    const data = { request_id: "request-contact-001", lead };
    expect((await f.call("callback", data)).status).toBe(400);
    expect(
      (
        await f.call("callback", {
          ...data,
          confirmed: true,
          lead: { name: "Example", reason: "Demo" },
        })
      ).status,
    ).toBe(400);
    expect(f.calls).toHaveLength(0);
    const result = await f.call("callback", { ...data, confirmed: true });
    expect(result.body.delivery).toBe("accepted");
    expect(result.body.reply).toMatch(/not yet confirmed/);
    expect(JSON.parse(String(f.calls[0].init?.body))).toMatchObject({
      type: "contact_request",
      confirmed: true,
      lead: { ...lead, company: "", preferred_time: "", timezone: "" },
    });
    await f.call("callback", { ...data, confirmed: true });
    expect(f.calls).toHaveLength(1);
    expect((await f.call("status")).body.callback_receipt?.request_id).toBe(
      data.request_id,
    );
  });
  it("never resends ambiguous delivery and restores it after reset", async () => {
    const f = fixture();
    await f.call("status");
    f.setDelivery("timeout");
    const data = { request_id: "request-contact-001", lead, confirmed: true };
    expect((await f.call("callback", data)).body.delivery).toBe("unknown");
    f.setDelivery(200);
    expect((await f.call("callback", data)).body.delivery).toBe("unknown");
    expect(f.calls).toHaveLength(1);
    await f.call("reset", {});
    expect((await f.call("status")).body.callback_receipt?.delivery).toBe(
      "unknown",
    );
  });
  it("keeps an ambiguous callback from being resubmitted under a fresh ID", async () => {
    const f = fixture();
    await f.call("status");
    f.setDelivery("timeout");
    await f.call("callback", {
      request_id: "request-contact-001",
      lead,
      confirmed: true,
    });
    const another = await f.call("callback", {
      request_id: "request-contact-002",
      lead,
      confirmed: true,
    });
    expect(another.status).toBe(409);
    expect(f.calls).toHaveLength(1);
  });
  it("recovers a pending receipt after the provider accepted but saving failed", async () => {
    const underlying = memoryStore();
    const store: MonoStore = {
      ...underlying,
      async write(key, value, version) {
        if (value.kind === "operation" && value.state === "done") return null;
        return underlying.write(key, value, version);
      },
    };
    const f = fixture({ store });
    await f.call("status");
    const data = { request_id: "request-contact-001", lead, confirmed: true };
    expect((await f.call("callback", data)).status).toBe(503);
    expect((await f.call("status")).body.callback_receipt).toMatchObject({
      delivery: "unknown",
      request_id: data.request_id,
    });
    expect((await f.call("callback", data)).body.delivery).toBe("unknown");
    await f.call("reset", {});
    expect((await f.call("status")).body.callback_receipt?.delivery).toBe(
      "unknown",
    );
    expect(f.calls).toHaveLength(1);
  });
  it("shares durable rate limits across separate server instances", async () => {
    const store = memoryStore(),
      a = fixture({ store }),
      b = fixture({ store });
    await a.call("status");
    await b.call("status");
    for (let i = 0; i < 6; i++) {
      const request = {
        request_id: `request-chat-${String(i).padStart(4, "0")}`,
        message: "Hello",
      };
      expect((await a.call("chat", request)).status).toBe(200);
      expect((await b.call("chat", request)).status).toBe(200);
    }
    expect(
      (
        await b.call("chat", {
          request_id: "request-chat-9999",
          message: "Hello",
        })
      ).status,
    ).toBe(429);
  });
  it("permits retry of a definite rejection under the same ID", async () => {
    const f = fixture();
    await f.call("status");
    f.setDelivery(401);
    const data = { request_id: "request-contact-001", lead, confirmed: true };
    expect((await f.call("callback", data)).body.delivery).toBe("failed");
    f.setDelivery(200);
    expect((await f.call("callback", data)).body.delivery).toBe("accepted");
    await f.call("callback", data);
    expect(f.calls).toHaveLength(2);
  });
  it("does not duplicate concurrent callbacks and blocks another active action", async () => {
    let release: (() => void) | undefined;
    let calls = 0;
    const f = fixture({
      fetcher: async () => {
        calls++;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return new Response("", { status: 200 });
      },
    });
    await f.call("status");
    const data = { request_id: "request-contact-001", lead, confirmed: true };
    const first = f.call("callback", data);
    while (!release) await new Promise((resolve) => setTimeout(resolve, 0));
    expect((await f.call("callback", data)).body.delivery).toBe("unknown");
    expect((await f.call("reset", {})).status).toBe(409);
    release();
    expect((await first).body.delivery).toBe("accepted");
    expect(calls).toBe(1);
  });
  it("redacts provider failures and permits the same chat retry", async () => {
    let calls = 0;
    const f = fixture({
      fetcher: async () => {
        calls++;
        return new Response("secret error body", { status: 500 });
      },
    });
    await f.call("status");
    const data = { request_id: "request-chat-0001", message: "Hi" };
    const result = await f.call("chat", data);
    expect(result.status).toBe(502);
    expect(JSON.stringify(result.body)).not.toMatch(/secret error/);
    await f.call("chat", data);
    expect(calls).toBe(2);
  });
  it("rejects unsafe model output before saving history or reporting", async () => {
    const f = fixture({
      fetcher: async () =>
        modelResponse({
          ...modelReply,
          links: [{ label: "Bad", href: "javascript:alert(1)" }],
        }),
    });
    await f.call("status");
    expect(
      (
        await f.call("chat", {
          request_id: "request-chat-0001",
          message: "Hello",
        })
      ).status,
    ).toBe(502);
    expect((await f.call("status")).body.history).toEqual([]);
  });
  it("enforces durable rate limits and session expiry", async () => {
    let current = Date.now();
    const f = fixture({
      now: () => current,
      env: { MONO_REPORTING_ENABLED: "false" },
    });
    await f.call("status");
    for (let i = 0; i < 12; i++)
      expect(
        (
          await f.call("chat", {
            request_id: `request-chat-${String(i).padStart(4, "0")}`,
            message: "Hi",
          })
        ).status,
      ).toBe(200);
    expect(
      (await f.call("chat", { request_id: "request-chat-0099", message: "Hi" }))
        .status,
    ).toBe(429);
    current += 7200001;
    expect(
      (await f.call("chat", { request_id: "request-chat-9999", message: "Hi" }))
        .status,
    ).toBe(403);
    expect((await f.call("status")).body.history).toEqual([]);
  });
  it("rejects oversized and malformed input without provider calls", async () => {
    const f = fixture();
    await f.call("status");
    expect(
      (
        await f.call("chat", {
          request_id: "request-chat-0001",
          message: "x".repeat(17000),
        })
      ).status,
    ).toBe(413);
    for (const data of [
      [],
      null,
      { request_id: "tiny", message: "Hello" },
      { request_id: "request-chat-0001", message: 42 },
    ])
      expect((await f.call("chat", data)).status).toBe(400);
    expect(f.calls).toHaveLength(0);
  });
});

describe("bot configuration", () => {
  it("validates destination and authorization without allowing redirects", async () => {
    expect(
      botConfig({
        ...base,
        MONO_BOT_WEBHOOK_KEY: "",
        MONO_BOT_AUTHORIZATION: "Authorization: Bearer demo-key",
      })?.authorization,
    ).toBe("Bearer demo-key");
    expect(() =>
      botConfig({ ...base, MONO_BOT_AUTHORIZATION: "Bearer other" }),
    ).toThrow();
    for (const url of [
      "http://api2.cursor.sh/path",
      "https://evil.test/path",
      "https://api2.cursor.sh/path?token=x",
      "https://api2.cursor.sh:444/path",
    ])
      expect(() => botConfig({ ...base, MONO_BOT_WEBHOOK_URL: url })).toThrow();
    const f = fixture();
    await f.call("status");
    await f.call("callback", {
      request_id: "request-contact-001",
      lead,
      confirmed: true,
    });
    expect(f.calls[0].init?.redirect).toBe("error");
  });
});
