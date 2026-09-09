import { act, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderServerHtml } from "@/test/render-server-html";
import {
  DEVICE_TZ_COOKIE,
  DeviceTimeZoneProvider,
  useDeviceTimeZone,
} from "./device-timezone";

vi.mock("@/lib/datetime/timezone", () => ({
  detectDeviceTimeZone: () => "Asia/Kuwait",
}));

function Probe() {
  return <span>zone:{useDeviceTimeZone() ?? "unknown"}</span>;
}

describe("DeviceTimeZoneProvider", () => {
  beforeEach(() => {
    // jsdom cookie is a plain string jar we can read/reset.
    document.cookie = `${DEVICE_TZ_COOKIE}=; path=/; max-age=0`;
  });
  afterEach(() => vi.restoreAllMocks());

  it("serves the server-seeded initial zone, then the client-detected zone after mount", async () => {
    await act(async () => {
      render(
        <DeviceTimeZoneProvider initial="Europe/Belgrade">
          <Probe />
        </DeviceTimeZoneProvider>,
      );
    });
    // After mount the client detection wins.
    expect(screen.getByText("zone:Asia/Kuwait")).toBeInTheDocument();
  });

  it("writes the cookie when the detected zone drifts from the seed", async () => {
    await act(async () => {
      render(
        <DeviceTimeZoneProvider initial="Europe/Belgrade">
          <Probe />
        </DeviceTimeZoneProvider>,
      );
    });
    expect(document.cookie).toContain(`${DEVICE_TZ_COOKIE}=Asia%2FKuwait`);
  });

  it("leaves the cookie alone when it already holds the detected zone", async () => {
    document.cookie = `${DEVICE_TZ_COOKIE}=Asia%2FKuwait; path=/`;
    // jsdom defines `cookie` on Document.prototype, not on the instance.
    const setCookie = vi.spyOn(Document.prototype, "cookie", "set");
    await act(async () => {
      render(
        <DeviceTimeZoneProvider initial="Asia/Kuwait">
          <Probe />
        </DeviceTimeZoneProvider>,
      );
    });
    expect(setCookie).not.toHaveBeenCalled();
  });

  it("exposes null on the server when there is no seed (first-ever visit)", () => {
    // The server snapshot is the seed; with none there is nothing to show yet.
    // (Client detection cannot run during a server render.)
    expect(renderToStaticMarkup(<Probe />)).toContain("unknown");
  });

  it("falls back to the detected device zone after mount when the seed is null", async () => {
    await act(async () => {
      render(
        <DeviceTimeZoneProvider initial={null}>
          <Probe />
        </DeviceTimeZoneProvider>,
      );
    });
    expect(screen.getByText("zone:Asia/Kuwait")).toBeInTheDocument();
  });

  // --- Static shell / streamed-seed guards -------------------------------
  // This provider wraps EVERY authenticated page, so anything it awaits runs
  // above every Suspense boundary and deletes the route's prerendered static
  // shell (0-byte `.next/server/app/*.html`). The seed therefore arrives as an
  // UNAWAITED promise from `AuthenticatedShell` and is resolved by the
  // consumer, not the provider.

  it("keeps children in the static shell when the seed promise is still pending", () => {
    const pending = new Promise<string | null>(() => {});
    // renderToStaticMarkup is synchronous: it THROWS if anything suspends, so
    // a passing render is proof the provider itself never suspends.
    const html = renderToStaticMarkup(
      <DeviceTimeZoneProvider initial={pending}>
        <p>shell</p>
      </DeviceTimeZoneProvider>,
    );
    expect(html).toContain("shell");
  });

  it("resolves a promise seed to the cookie zone in the server-rendered HTML", async () => {
    const html = await renderServerHtml(
      <DeviceTimeZoneProvider initial={Promise.resolve("Europe/Belgrade")}>
        <Probe />
      </DeviceTimeZoneProvider>,
    );
    expect(html).toContain("Europe/Belgrade");
  });

  it("still serves a plain string seed in the server-rendered HTML", async () => {
    const html = await renderServerHtml(
      <DeviceTimeZoneProvider initial="Europe/Belgrade">
        <Probe />
      </DeviceTimeZoneProvider>,
    );
    expect(html).toContain("Europe/Belgrade");
  });

  it("renders no zone in the server HTML when the seed resolves to null", async () => {
    const html = await renderServerHtml(
      <DeviceTimeZoneProvider initial={Promise.resolve(null)}>
        <Probe />
      </DeviceTimeZoneProvider>,
    );
    expect(html).toContain("unknown");
  });
});
