import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// The static landing renders only the hero — no auth, no cookies, no redirect.
// Stub the hero to a plain anchor so this test stays a pure render check
// (the hero's own behavior is covered in monolith-hero.test.tsx).
vi.mock("@/components/landing/monolith-hero", () => ({
  MonolithHero: () => <a href="/login">MONOLITH</a>,
}));

import Home from "./page";

describe("Home (root route, static landing)", () => {
  it("renders the public hero", () => {
    render(Home());
    expect(screen.getByText("MONOLITH")).toBeInTheDocument();
  });
});
