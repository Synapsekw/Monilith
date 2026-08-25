import { StrictMode } from "react";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { onlineManager } from "@tanstack/react-query";
import { offlineRecoveryKey } from "@/lib/offline/constants";
import { ErrorFallback } from "./error-fallback";

function makeError(digest?: string): Error & { digest?: string } {
  const e = new Error("boom") as Error & { digest?: string };
  if (digest) e.digest = digest;
  return e;
}

/**
 * `window.location` is configurable in jsdom (its own properties are not), so
 * the whole object is swapped for a stub: that gives a spyable `reload` and lets
 * a test claim a pathname without navigating.
 */
const ORIGINAL_LOCATION = Object.getOwnPropertyDescriptor(
  window,
  "location",
) as PropertyDescriptor;
const ORIGIN = new URL(document.baseURI).origin;

let reload: ReturnType<typeof vi.fn>;

function stubLocation(path: string): void {
  const url = new URL(path, ORIGIN);
  reload = vi.fn();
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: {
      href: url.href,
      origin: url.origin,
      pathname: url.pathname,
      search: url.search,
      hash: url.hash,
      assign: vi.fn(),
      replace: vi.fn(),
      reload,
      toString: () => url.href,
    },
  });
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  window.sessionStorage.clear();
  stubLocation("/boards/aaaa");
});

afterEach(() => {
  onlineManager.setOnline(true);
  Object.defineProperty(window, "location", ORIGINAL_LOCATION);
  window.sessionStorage.clear();
});

describe("ErrorFallback", () => {
  it("renders default copy and calls retry on click", async () => {
    const retry = vi.fn();
    render(<ErrorFallback error={makeError()} retry={retry} />);
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalled(); // logged for observability
  });

  it("renders custom title/description and the digest", () => {
    render(
      <ErrorFallback
        error={makeError("abc123")}
        retry={() => {}}
        title="Couldn't load boards"
        description="Custom description."
      />,
    );
    expect(screen.getByText("Couldn't load boards")).toBeInTheDocument();
    expect(screen.getByText("Custom description.")).toBeInTheDocument();
    expect(screen.getByText(/abc123/)).toBeInTheDocument();
  });

  it("omits the digest line when absent", () => {
    render(<ErrorFallback error={makeError()} retry={() => {}} />);
    expect(screen.queryByText(/error code/i)).not.toBeInTheDocument();
  });

  it("replaces the generic copy with offline copy while offline", () => {
    onlineManager.setOnline(false);
    render(
      <ErrorFallback
        error={makeError()}
        retry={() => {}}
        title="Couldn't load boards"
        description="Something failed while loading this board data."
      />,
    );
    expect(screen.getByText("You’re offline")).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load boards")).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Something failed while loading/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/unexpected error/i)).not.toBeInTheDocument();
  });

  it("offline + first error: sets the recovery key and reloads exactly once", () => {
    onlineManager.setOnline(false);

    render(<ErrorFallback error={makeError()} retry={() => {}} />);

    expect(
      window.sessionStorage.getItem("monolith.offline.recovered:/boards/aaaa"),
    ).toBe("1");
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("offline: reloads once even when effects are double-invoked (StrictMode)", () => {
    onlineManager.setOnline(false);

    render(
      <StrictMode>
        <ErrorFallback error={makeError()} retry={() => {}} />
      </StrictMode>,
    );

    // The key is written synchronously before the reload, so the second
    // invocation reads it back and stands down.
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("offline + recovery key already set: does not reload, shows the offline copy and retry", () => {
    onlineManager.setOnline(false);
    window.sessionStorage.setItem(offlineRecoveryKey("/boards/aaaa"), "1");

    const retry = vi.fn();
    render(<ErrorFallback error={makeError()} retry={retry} />);

    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByText("You’re offline")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /try again/i }),
    ).toBeInTheDocument();
  });

  it("online + error: no reload, generic copy, recovery key untouched", () => {
    window.sessionStorage.setItem(offlineRecoveryKey("/boards/aaaa"), "1");

    render(<ErrorFallback error={makeError()} retry={() => {}} />);

    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(
      window.sessionStorage.getItem(offlineRecoveryKey("/boards/aaaa")),
    ).toBe("1");
  });

  it("scopes the recovery key per pathname", () => {
    onlineManager.setOnline(false);
    // /boards/aaaa already burned its one-shot; /boards/bbbb must still recover.
    window.sessionStorage.setItem(offlineRecoveryKey("/boards/aaaa"), "1");
    stubLocation("/boards/bbbb");

    render(<ErrorFallback error={makeError()} retry={() => {}} />);

    expect(reload).toHaveBeenCalledTimes(1);
    expect(
      window.sessionStorage.getItem(offlineRecoveryKey("/boards/bbbb")),
    ).toBe("1");
    expect(
      window.sessionStorage.getItem(offlineRecoveryKey("/boards/aaaa")),
    ).toBe("1");
  });

  it("does not reload when sessionStorage is unavailable", () => {
    onlineManager.setOnline(false);
    const getItem = vi
      .spyOn(window.sessionStorage, "getItem")
      .mockImplementation(() => {
        throw new Error("storage disabled");
      });
    try {
      render(<ErrorFallback error={makeError()} retry={() => {}} />);
      // No guard means no bound on the loop, so it must not reload at all.
      expect(reload).not.toHaveBeenCalled();
      expect(screen.getByText("You’re offline")).toBeInTheDocument();
    } finally {
      getItem.mockRestore();
    }
  });

  it("returns to the generic copy when connectivity comes back", () => {
    onlineManager.setOnline(false);
    window.sessionStorage.setItem(offlineRecoveryKey("/boards/aaaa"), "1");
    render(<ErrorFallback error={makeError()} retry={() => {}} />);
    expect(screen.getByText("You’re offline")).toBeInTheDocument();

    act(() => onlineManager.setOnline(true));

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.queryByText("You’re offline")).not.toBeInTheDocument();
    expect(reload).not.toHaveBeenCalled();
  });
});
