import { Suspense } from "react";
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TimeZoneProvider, useTimeZone } from "./timezone-context";

function Zone() {
  return <span>zone:{useTimeZone() ?? "auto"}</span>;
}

describe("TimeZoneProvider with a promise value", () => {
  it("renders siblings while pending, then resolves consumers", async () => {
    let resolve!: (v: string | null) => void;
    const pending = new Promise<string | null>((r) => (resolve = r));
    // Wrap the suspending initial render in an awaited act so React registers
    // the pending thenable (concurrent root) before we resolve it.
    await act(async () => {
      render(
        <TimeZoneProvider timeZone={pending}>
          <p>content paints now</p>
          <Suspense fallback={<span>tz-pending</span>}>
            <Zone />
          </Suspense>
        </TimeZoneProvider>,
      );
    });
    expect(screen.getByText("content paints now")).toBeInTheDocument();
    expect(screen.getByText("tz-pending")).toBeInTheDocument();
    await act(async () => {
      resolve("Asia/Kuwait");
      await pending; // flush React's suspense retry inside the act scope
    });
    expect(screen.getByText("zone:Asia/Kuwait")).toBeInTheDocument();
  });
  it("still accepts a plain resolved value", () => {
    render(
      <TimeZoneProvider timeZone="Europe/Belgrade">
        <Zone />
      </TimeZoneProvider>,
    );
    expect(screen.getByText("zone:Europe/Belgrade")).toBeInTheDocument();
  });
});
