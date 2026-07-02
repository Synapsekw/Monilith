import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ErrorFallback } from "./error-fallback";

function makeError(digest?: string): Error & { digest?: string } {
  const e = new Error("boom") as Error & { digest?: string };
  if (digest) e.digest = digest;
  return e;
}

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
});
