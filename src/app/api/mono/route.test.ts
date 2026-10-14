import { afterEach, expect, it, vi } from "vitest";

// A guide-only deployment must not construct a privileged database client.
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient() {
    throw new Error("Unexpected privileged client");
  },
}));
import { GET, POST } from "./route";

afterEach(() => vi.unstubAllEnvs());
it("serves public guide status as non-cacheable JSON without credentials", async () => {
  vi.stubEnv("MONO_OPENAI_API_KEY", "");
  const response = await GET(
    new Request("https://preview.vercel.app/api/mono?action=status"),
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("application/json");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("set-cookie")).toBeNull();
  expect(await response.json()).toEqual({
    mode: "preview",
    callbacks_enabled: false,
    reporting_enabled: false,
  });
});
it("returns protocol errors instead of auth redirects for disconnected POSTs", async () => {
  vi.stubEnv("MONO_OPENAI_API_KEY", "");
  const response = await POST(
    new Request("https://preview.vercel.app/api/mono?action=chat", {
      method: "POST",
      body: "{}",
    }),
  );
  expect(response.status).toBe(503);
  expect(response.headers.get("location")).toBeNull();
  expect(await response.json()).toEqual({
    error: "Mono is not connected yet.",
  });
});
