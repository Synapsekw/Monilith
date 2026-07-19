import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

  it("exposes null when there is no seed and detection has not run (SSR shape)", () => {
    // A render with no provider returns the context default (null).
    render(<Probe />);
    expect(screen.getByText("zone:unknown")).toBeInTheDocument();
  });
});
