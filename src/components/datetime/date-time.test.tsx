import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DateTime } from "./date-time";
import { DeviceTimeZoneProvider } from "@/lib/datetime/device-timezone";
import { TimeZoneProvider } from "@/lib/datetime/timezone-context";

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

  it("renders machine-readable-only when no zone is known (first-ever visit)", () => {
    render(
      <TimeZoneProvider timeZone={null}>
        <DateTime value={ISO} />
      </TimeZoneProvider>,
    );
    const el = screen.getByRole("time");
    expect(el).toHaveAttribute("dateTime", new Date(ISO).toISOString());
    expect(el).toHaveTextContent(""); // no human text, but not absent
  });
});
