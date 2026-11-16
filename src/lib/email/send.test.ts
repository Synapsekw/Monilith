import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const serverEnv = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("@/lib/env.server", () => ({ getServerEnv: () => serverEnv.value }));

import { sendEmail } from "./send";

const fetchMock = vi.fn();
const MESSAGE = {
  to: "ann@x.com",
  subject: "Hello",
  html: "<p>Hello</p>",
  text: "Hello",
};

beforeEach(() => {
  serverEnv.value = {
    RESEND_API_KEY: "re_test",
    APP_BASE_URL: "https://app.example.com",
  };
  fetchMock.mockReset().mockResolvedValue({ ok: true, status: 200 });
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("sendEmail", () => {
  it("sends nothing and reports disabled without an API key", async () => {
    serverEnv.value = { APP_BASE_URL: "https://app.example.com" };
    expect(await sendEmail(MESSAGE)).toBe("disabled");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends nothing and reports disabled without a base URL", async () => {
    serverEnv.value = { RESEND_API_KEY: "re_test" };
    expect(await sendEmail(MESSAGE)).toBe("disabled");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts the message to Resend with the key and the default sender", async () => {
    expect(await sendEmail(MESSAGE)).toBe("sent");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers.Authorization).toBe("Bearer re_test");
    expect(JSON.parse(init.body)).toEqual({
      from: "digest@app.example.com",
      to: ["ann@x.com"],
      subject: "Hello",
      html: "<p>Hello</p>",
      text: "Hello",
    });
  });

  it("uses the configured sender when there is one", async () => {
    serverEnv.value.DIGEST_FROM_EMAIL = "hello@mail.example.com";
    await sendEmail(MESSAGE);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).from).toBe(
      "hello@mail.example.com",
    );
  });

  it("reports failed when the provider refuses", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 422 });
    expect(await sendEmail(MESSAGE)).toBe("failed");
  });

  it("reports failed, without throwing, when the request throws", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    expect(await sendEmail(MESSAGE)).toBe("failed");
  });
});
