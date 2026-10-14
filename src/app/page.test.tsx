import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// The root route must render the public content without auth or browser effects.
vi.mock("@/components/landing/assembly-effects", () => ({
  AssemblyEffects: () => null,
}));

import Home from "./page";

describe("Home (root route, static landing)", () => {
  it("renders the public hero", () => {
    render(Home());
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Good work.",
    );
    for (const link of screen.getAllByRole("link", { name: "Log in" })) {
      expect(link).toHaveAttribute("href", "/login");
    }
  });
});
