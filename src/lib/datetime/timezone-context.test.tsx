import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TimeZoneProvider, useResolvedTimeZone } from "./timezone-context";

function Resolved({ device }: { device: string | null }) {
  return <span>tz:{useResolvedTimeZone(device) ?? "none"}</span>;
}

describe("useResolvedTimeZone (non-suspending)", () => {
  it("returns the device zone when the context is null (Automatic)", () => {
    render(
      <TimeZoneProvider timeZone={null}>
        <Resolved device="Asia/Kuwait" />
      </TimeZoneProvider>,
    );
    expect(screen.getByText("tz:Asia/Kuwait")).toBeInTheDocument();
  });

  it("returns an explicit resolved string over the device zone", () => {
    render(
      <TimeZoneProvider timeZone="Europe/Belgrade">
        <Resolved device="Asia/Kuwait" />
      </TimeZoneProvider>,
    );
    expect(screen.getByText("tz:Europe/Belgrade")).toBeInTheDocument();
  });

  it("returns the device zone while a promise is pending, then the explicit zone", async () => {
    let resolve!: (v: string | null) => void;
    const pending = new Promise<string | null>((r) => (resolve = r));
    await act(async () => {
      render(
        <TimeZoneProvider timeZone={pending}>
          <Resolved device="Asia/Kuwait" />
        </TimeZoneProvider>,
      );
    });
    // No suspense, no blank: the device zone shows immediately.
    expect(screen.getByText("tz:Asia/Kuwait")).toBeInTheDocument();
    await act(async () => {
      resolve("America/New_York");
      await pending;
    });
    expect(screen.getByText("tz:America/New_York")).toBeInTheDocument();
  });

  it("keeps the device zone when a promise resolves to null (Automatic)", async () => {
    let resolve!: (v: string | null) => void;
    const pending = new Promise<string | null>((r) => (resolve = r));
    await act(async () => {
      render(
        <TimeZoneProvider timeZone={pending}>
          <Resolved device="Asia/Kuwait" />
        </TimeZoneProvider>,
      );
    });
    await act(async () => {
      resolve(null);
      await pending;
    });
    expect(screen.getByText("tz:Asia/Kuwait")).toBeInTheDocument();
  });
});
