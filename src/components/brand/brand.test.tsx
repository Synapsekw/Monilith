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

  it("renders the standalone brand mark alongside the wordmark when expanded", () => {
    const { container } = render(<Brand />);
    // The slab-I glyph inside the wordmark is already an <svg>; the Keystone
    // touch-up prepends a standalone MonolithMark <svg> before it, so expanded
    // brand should render at least two <svg> elements once both are present.
    expect(container.querySelectorAll("svg").length).toBeGreaterThanOrEqual(2);
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
