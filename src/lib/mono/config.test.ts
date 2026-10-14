import { describe, expect, it } from "vitest";
import { resolveMonoOrigin, monoClientIp } from "./config";

describe("Mono deployment boundary", () => {
  it("uses an explicitly configured exact origin", () => {
    expect(
      resolveMonoOrigin({
        MONO_SITE_ORIGIN: "https://www.monolith.works",
        VERCEL_ENV: "production",
        VERCEL_URL: "other.vercel.app",
      }),
    ).toBe("https://www.monolith.works");
    for (const value of [
      "https://www.monolith.works/path",
      "https://www.monolith.works?x=1",
      "https://user:pass@www.monolith.works",
      "http://www.monolith.works",
    ])
      expect(() => resolveMonoOrigin({ MONO_SITE_ORIGIN: value })).toThrow();
  });
  it("uses trusted Vercel preview configuration but never infers production", () => {
    expect(
      resolveMonoOrigin({
        VERCEL_ENV: "preview",
        VERCEL_URL: "project-abc.vercel.app",
      }),
    ).toBe("https://project-abc.vercel.app");
    expect(
      resolveMonoOrigin({
        VERCEL_ENV: "production",
        VERCEL_URL: "project.vercel.app",
      }),
    ).toBeNull();
    for (const host of [
      "evil.example",
      "project.vercel.app/evil",
      "project.vercel.app:444",
      "user@project.vercel.app",
    ])
      expect(() =>
        resolveMonoOrigin({ VERCEL_ENV: "preview", VERCEL_URL: host }),
      ).toThrow();
  });
  it("only uses the Vercel-overwritten forwarding header for deployed limits", () => {
    const r = new Request("https://project.vercel.app/api/mono", {
      headers: {
        "x-forwarded-for": "1.1.1.1",
        "x-real-ip": "2.2.2.2",
        "x-vercel-forwarded-for": "192.0.2.10",
      },
    });
    expect(monoClientIp(r, { VERCEL: "1" })).toBe("192.0.2.10");
    expect(monoClientIp(r, {})).toBe("unknown");
    expect(
      monoClientIp(
        new Request(r, {
          headers: { "x-vercel-forwarded-for": "spoof, 192.0.2.2" },
        }),
        { VERCEL: "1" },
      ),
    ).toBe("unknown");
  });
});
