import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NotFoundFallback } from "./not-found-fallback";

describe("NotFoundFallback", () => {
  it("renders copy and a back link", () => {
    render(
      <NotFoundFallback
        title="Board not found"
        description="This board may have been deleted."
        backHref="/boards"
        backLabel="All boards"
      />,
    );
    expect(screen.getByText("Board not found")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "All boards" })).toHaveAttribute(
      "href",
      "/boards",
    );
  });
});
