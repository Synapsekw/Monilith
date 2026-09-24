import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const toast = vi.fn();
vi.mock("sonner", () => ({ toast: (...a: unknown[]) => toast(...a) }));
import { HeaderActions } from "./HeaderActions";

describe("HeaderActions", () => {
  beforeEach(() => {
    toast.mockClear();
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn(async () => undefined) },
    });
    window.print = vi.fn();
  });

  it("Share copies the current URL and toasts", async () => {
    render(<HeaderActions folderId="f1" canExport />);
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    await Promise.resolve();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      window.location.href,
    );
    expect(toast).toHaveBeenCalledWith("Link copied");
  });

  it("Export PDF prints on a canvas tab and is disabled elsewhere", () => {
    const { rerender } = render(<HeaderActions folderId="f1" canExport />);
    fireEvent.click(screen.getByRole("button", { name: "Export PDF" }));
    expect(window.print).toHaveBeenCalledTimes(1);
    rerender(<HeaderActions folderId="f1" canExport={false} />);
    expect(screen.getByRole("button", { name: "Export PDF" })).toBeDisabled();
  });

  it("Ask about this folder links to /ask?folder=", () => {
    render(<HeaderActions folderId="f1" canExport />);
    expect(
      screen.getByRole("link", { name: "Ask about this folder" }),
    ).toHaveAttribute("href", "/ask?folder=f1");
  });
});
