import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DateTime } from "./date-time";
import { DeviceTimeZoneProvider } from "@/lib/datetime/device-timezone";
import { TimeZoneProvider } from "@/lib/datetime/timezone-context";
import { renderServerHtml } from "@/test/render-server-html";

// Pin the client-detected device zone so the assertions are deterministic
// regardless of the test runner's machine timezone. Matches the seed passed to
// DeviceTimeZoneProvider below (no drift → the device zone stays New York).
vi.mock("@/lib/datetime/timezone", () => ({
  detectDeviceTimeZone: () => "America/New_York",
}));

const ISO = "2026-06-21T02:00:00Z"; // 2am UTC → still Jun 20 in the Americas

describe("DateTime", () => {
  it("renders the timestamp immediately in the seeded device zone (no blank)", () => {
    render(
      <DeviceTimeZoneProvider initial="America/New_York">
        <TimeZoneProvider timeZone={null}>
          <DateTime value={ISO} />
        </TimeZoneProvider>
      </DeviceTimeZoneProvider>,
    );
    const el = screen.getByRole("time");
    // New York is UTC-4 in June → 2am UTC is 10pm on Jun 20.
    expect(el).toHaveTextContent(/Jun 20, 2026/);
    expect(el).toHaveAttribute("dateTime", new Date(ISO).toISOString());
  });

  it("prefers an explicit personal zone over the device zone", () => {
    render(
      <DeviceTimeZoneProvider initial="America/New_York">
        <TimeZoneProvider timeZone="Asia/Tokyo">
          <DateTime value={ISO} />
        </TimeZoneProvider>
      </DeviceTimeZoneProvider>,
    );
    // Tokyo is UTC+9 → 2am UTC is 11am on Jun 21.
    expect(screen.getByRole("time")).toHaveTextContent(/Jun 21, 2026/);
  });

  it("renders the seeded zone in the server-streamed HTML when the seed is still a promise", async () => {
    // The shell hands the device zone down as an UNAWAITED cookie promise so
    // the route keeps its static shell; the visitor must still get a real
    // timestamp in the first streamed HTML, not a blank <time>.
    const html = await renderServerHtml(
      <DeviceTimeZoneProvider initial={Promise.resolve("America/New_York")}>
        <TimeZoneProvider timeZone={null}>
          <DateTime value={ISO} />
        </TimeZoneProvider>
      </DeviceTimeZoneProvider>,
    );
    expect(html).toMatch(/Jun 20, 2026/);
  });

  it("renders machine-readable-only in the server HTML when no zone is known (first-ever visit)", () => {
    // A visitor with no `pulse_tz` cookie: the server has no zone to format in,
    // so the first bytes carry the stable ISO attribute and no human text.
    const html = renderToStaticMarkup(
      <DeviceTimeZoneProvider initial={null}>
        <TimeZoneProvider timeZone={null}>
          <DateTime value={ISO} />
        </TimeZoneProvider>
      </DeviceTimeZoneProvider>,
    );
    expect(html).toContain(new Date(ISO).toISOString());
    expect(html).not.toMatch(/Jun \d\d, 2026/);
  });

  it("fills in the detected device zone after mount when there was no seed", () => {
    render(
      <DeviceTimeZoneProvider initial={null}>
        <TimeZoneProvider timeZone={null}>
          <DateTime value={ISO} />
        </TimeZoneProvider>
      </DeviceTimeZoneProvider>,
    );
    expect(screen.getByRole("time")).toHaveTextContent(/Jun 20, 2026/);
  });
});
