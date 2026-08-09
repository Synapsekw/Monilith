import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { ServiceWorkerRegistrar } from "./ServiceWorkerRegistrar";

const register = vi.fn(async () => ({}) as ServiceWorkerRegistration);
const unregister = vi.fn(async () => true);
const getRegistrations = vi.fn(async () => [
  { unregister } as unknown as ServiceWorkerRegistration,
]);
const cacheDelete = vi.fn(async () => true);
const cacheKeys = vi.fn(async () => [
  "monolith-offline-v2",
  "some-other-app-cache",
]);

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { register, getRegistrations },
  });
  Object.defineProperty(window, "caches", {
    configurable: true,
    value: { keys: cacheKeys, delete: cacheDelete },
  });
  // Run the idle callback synchronously so the production path is observable.
  Object.defineProperty(window, "requestIdleCallback", {
    configurable: true,
    value: (fn: () => void) => {
      fn();
      return 1;
    },
  });
});

afterEach(() => vi.unstubAllEnvs());

describe("ServiceWorkerRegistrar in development", () => {
  // sw.js is cache-first for /_next/static/**, which is only safe when those
  // filenames are content-addressed — true for a production build, false for
  // Turbopack dev, which reuses a chunk filename across recompiles.
  it("does NOT register the caching worker", async () => {
    render(<ServiceWorkerRegistrar />);
    await waitFor(() => expect(getRegistrations).toHaveBeenCalled());
    expect(register).not.toHaveBeenCalled();
  });

  it("unregisters a worker left behind by an earlier run", async () => {
    render(<ServiceWorkerRegistrar />);
    await waitFor(() => expect(unregister).toHaveBeenCalled());
  });

  it("drops our own stale caches but leaves other origins' caches alone", async () => {
    render(<ServiceWorkerRegistrar />);
    await waitFor(() =>
      expect(cacheDelete).toHaveBeenCalledWith("monolith-offline-v2"),
    );
    expect(cacheDelete).not.toHaveBeenCalledWith("some-other-app-cache");
  });
});

describe("ServiceWorkerRegistrar in production", () => {
  beforeEach(() => vi.stubEnv("NODE_ENV", "production"));

  it("registers /sw.js and tears nothing down", async () => {
    render(<ServiceWorkerRegistrar />);
    await waitFor(() => expect(register).toHaveBeenCalledWith("/sw.js"));
    expect(unregister).not.toHaveBeenCalled();
    expect(cacheDelete).not.toHaveBeenCalled();
  });
});
