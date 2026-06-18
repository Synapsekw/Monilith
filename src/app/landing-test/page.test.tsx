// src/app/landing-test/page.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/components/landing/mono/mono-scene", () => ({
  MonoScene: () => <div>mono-scene</div>,
}));

import LandingTestPage from "./page";

describe("LandingTestPage (/landing-test)", () => {
  it("renders the mono scene", () => {
    render(<LandingTestPage />);
    expect(screen.getByText("mono-scene")).toBeInTheDocument();
  });
});
