import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Brand } from "./brand";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/",
  useParams: () => ({}),
}));

describe("Brand", () => {
  it("shows the MONOLITH wordmark and links to /landing when expanded", () => {
    render(<Brand />);
    expect(screen.getByText("MONOLITH")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /monolith/i })).toHaveAttribute(
      "href",
      "/landing",
    );
  });

  it("does not repeat the slab mark beside the wordmark when expanded", () => {
    const { container } = render(<Brand />);
    // The wordmark's letter I is already the slab glyph, so the expanded brand
    // renders exactly that one <svg>. A standalone MonolithMark alongside it
    // would show the same shape twice, two characters apart.
    expect(container.querySelectorAll("svg")).toHaveLength(1);
    expect(screen.getByText("MONOLITH")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /monolith/i })).toHaveAttribute(
      "href",
      "/landing",
    );
  });

  it("hides the wordmark when collapsed but keeps the link and accessible name", () => {
    render(<Brand collapsed />);
    expect(screen.queryByText("MONOLITH")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /monolith/i })).toHaveAttribute(
      "href",
      "/landing",
    );
  });
});
