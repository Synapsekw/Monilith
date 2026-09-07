import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const env = {
  AI_PGNET_HMAC_SECRET: "a-test-secret-that-is-at-least-32-chars",
  APP_BASE_URL: "https://app.example.com",
} as { AI_PGNET_HMAC_SECRET: string | null; APP_BASE_URL: string | null };

vi.mock("@/lib/env.server", () => ({ getServerEnv: () => env }));

const afterCalls: (() => unknown)[] = [];
let afterThrows = false;
vi.mock("next/server", () => ({
  after: (cb: () => unknown) => {
    if (afterThrows) throw new Error("no request scope");
    afterCalls.push(cb);
  },
}));

import { signBody } from "@/lib/ai/agentic/hmac";
import { dispatchAgentRun } from "./mention-dispatch";

const RUN = "00000000-0000-4000-8000-0000000000b1";
const ITEM = "00000000-0000-4000-8000-0000000000c1";
const UPD = "00000000-0000-4000-8000-0000000000d1";

const fetchMock = vi.fn();

beforeEach(() => {
  afterCalls.length = 0;
  afterThrows = false;
  env.AI_PGNET_HMAC_SECRET = "a-test-secret-that-is-at-least-32-chars";
  env.APP_BASE_URL = "https://app.example.com";
  fetchMock.mockReset().mockResolvedValue(new Response("{}"));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("dispatchAgentRun", () => {
  it("does not fire during the action — only after the response", async () => {
    await dispatchAgentRun(RUN, ITEM, UPD);
    // The commenter's update is already saved and returned; nothing has been
    // POSTed yet.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(afterCalls).toHaveLength(1);
  });

  it("POSTs a SIGNED body carrying the run, the item and the summoning update", async () => {
    await dispatchAgentRun(RUN, ITEM, UPD);
    await afterCalls[0]!();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]! as [
      string,
      { body: string; headers: Record<string, string>; method: string },
    ];
    expect(url).toBe("https://app.example.com/api/ai/personal-agent");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      run_id: RUN,
      item_id: ITEM,
      update_id: UPD,
    });
    // The signature covers the EXACT bytes sent, so neither the item nor the
    // update can be swapped in transit.
    expect(init.headers["X-Pulse-Signature"]).toBe(
      signBody(init.body, env.AI_PGNET_HMAC_SECRET!),
    );
  });

  it("swallows a transport failure — the claim is the durable part", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockRejectedValueOnce(new Error("ECONNRESET"));
    await dispatchAgentRun(RUN, ITEM, UPD);
    await expect(afterCalls[0]!()).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledWith(
      "[agents] mention dispatch failed:",
      expect.objectContaining({ runId: RUN }),
    );
    spy.mockRestore();
  });

  it("runs detached when there is no request scope", async () => {
    afterThrows = true;
    await dispatchAgentRun(RUN, ITEM, UPD);
    // Nothing queued, but the POST still happened.
    expect(afterCalls).toHaveLength(0);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it("does nothing (and says so) when the secret or base URL is unset", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    env.AI_PGNET_HMAC_SECRET = null;
    await dispatchAgentRun(RUN, ITEM, UPD);
    expect(afterCalls).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();

    env.AI_PGNET_HMAC_SECRET = "a-test-secret-that-is-at-least-32-chars";
    env.APP_BASE_URL = null;
    await dispatchAgentRun(RUN, ITEM, UPD);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });
});
