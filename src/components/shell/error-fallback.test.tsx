import { afterEach, describe, it, expect, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { onlineManager } from "@tanstack/react-query";
import { ErrorFallback } from "./error-fallback";

function makeError(digest?: string): Error & { digest?: string } {
  const e = new Error("boom") as Error & { digest?: string };
  if (digest) e.digest = digest;
  return e;
}

afterEach(() => onlineManager.setOnline(true));

describe("ErrorFallback", () => {
  it("renders default copy and calls retry on click", async () => {
    const retry = vi.fn();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<ErrorFallback error={makeError()} retry={retry} />);
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalled(); // logged for observability
    spy.mockRestore();
  });

  it("renders custom title/description and the digest", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
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
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<ErrorFallback error={makeError()} retry={() => {}} />);
    expect(screen.queryByText(/error code/i)).not.toBeInTheDocument();
  });

  it("replaces the generic copy with offline copy while offline", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
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

  it("still offers retry while offline, and never navigates on its own", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const assign = vi.fn();
    const reload = vi.fn();
    const original = Object.getOwnPropertyDescriptor(
      window,
      "location",
    ) as PropertyDescriptor;
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: { ...window.location, href: window.location.href, assign, reload },
    });
    try {
      onlineManager.setOnline(false);
      const retry = vi.fn();
      render(<ErrorFallback error={makeError()} retry={retry} />);
      expect(
        screen.getByRole("button", { name: /try again/i }),
      ).toBeInTheDocument();
      // A boundary that reloads itself is a reload loop when the reloaded
      // document errors too. Recovery is the user's call.
      expect(assign).not.toHaveBeenCalled();
      expect(reload).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, "location", original);
    }
  });

  it("returns to the generic copy when connectivity comes back", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    onlineManager.setOnline(false);
    render(<ErrorFallback error={makeError()} retry={() => {}} />);
    expect(screen.getByText("You’re offline")).toBeInTheDocument();

    act(() => onlineManager.setOnline(true));

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.queryByText("You’re offline")).not.toBeInTheDocument();
  });
});
