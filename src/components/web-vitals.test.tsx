import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import type { NextWebVitalsMetric } from "next/app";

// Capture the callback registered with useReportWebVitals so the test can
// drive it directly with synthetic metrics.
let registeredCallback: ((metric: NextWebVitalsMetric) => void) | undefined;

vi.mock("next/web-vitals", () => ({
  useReportWebVitals: (cb: (metric: NextWebVitalsMetric) => void) => {
    registeredCallback = cb;
  },
}));

// Import AFTER the mock is registered.
import { WebVitals } from "./web-vitals";

const metric: NextWebVitalsMetric = {
  id: "v3-1",
  name: "LCP",
  label: "web-vital",
  value: 1234.5,
  startTime: 0,
};

const ORIGINAL_ENV = process.env.NODE_ENV;
const ORIGINAL_ENDPOINT = process.env.NEXT_PUBLIC_WEB_VITALS_ENDPOINT;

beforeEach(() => {
  registeredCallback = undefined;
  vi.restoreAllMocks();
});

afterEach(() => {
  // vitest types NODE_ENV as readonly; assign through the record.
  (process.env as Record<string, string | undefined>).NODE_ENV = ORIGINAL_ENV;
  (
    process.env as Record<string, string | undefined>
  ).NEXT_PUBLIC_WEB_VITALS_ENDPOINT = ORIGINAL_ENDPOINT;
});

describe("WebVitals (RUM)", () => {
  it("renders nothing and registers a reporting callback", () => {
    const { container } = render(<WebVitals />);
    expect(container).toBeEmptyDOMElement();
    expect(registeredCallback).toBeTypeOf("function");
  });

  it("registers a stable callback reference across re-renders", () => {
    const { rerender } = render(<WebVitals />);
    const first = registeredCallback;
    rerender(<WebVitals />);
    expect(registeredCallback).toBe(first);
  });

  it("logs the metric to console.debug in development", () => {
    (process.env as Record<string, string | undefined>).NODE_ENV =
      "development";
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});

    render(<WebVitals />);
    registeredCallback?.(metric);

    expect(debug).toHaveBeenCalledTimes(1);
    const [, payload] = debug.mock.calls[0];
    expect(payload).toMatchObject({ name: "LCP", value: 1234.5 });
  });

  it("beacons the metric to the endpoint in production when configured", () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    (
      process.env as Record<string, string | undefined>
    ).NEXT_PUBLIC_WEB_VITALS_ENDPOINT = "https://sink.example.com/vitals";
    const sendBeacon = vi.fn().mockReturnValue(true);
    vi.stubGlobal("navigator", { sendBeacon });

    render(<WebVitals />);
    registeredCallback?.(metric);

    expect(sendBeacon).toHaveBeenCalledTimes(1);
    const [url, body] = sendBeacon.mock.calls[0];
    expect(url).toBe("https://sink.example.com/vitals");
    expect(JSON.parse(body as string)).toMatchObject({
      name: "LCP",
      value: 1234.5,
    });

    vi.unstubAllGlobals();
  });

  it("is a no-op sink in production when no endpoint is configured", () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    (
      process.env as Record<string, string | undefined>
    ).NEXT_PUBLIC_WEB_VITALS_ENDPOINT = "";
    const sendBeacon = vi.fn();
    vi.stubGlobal("navigator", { sendBeacon });

    render(<WebVitals />);
    expect(() => registeredCallback?.(metric)).not.toThrow();
    expect(sendBeacon).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});
