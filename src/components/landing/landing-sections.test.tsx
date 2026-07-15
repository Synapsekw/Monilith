import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { LandingSections } from "./landing-sections";

describe("LandingSections", () => {
  it("renders the core marketing sections", () => {
    render(<LandingSections />);
    expect(screen.getByText("This is your workspace.")).toBeInTheDocument();
    expect(screen.getByText("Everything, on one surface.")).toBeInTheDocument();
    expect(screen.getByText("Switch how you see it.")).toBeInTheDocument();
    expect(
      screen.getByText("And all the connective tissue."),
    ).toBeInTheDocument();
  });

  it("logged out: the waitlist CTA is a Request access control", () => {
    render(<LandingSections />);
    expect(
      screen.getByRole("button", { name: "Request access" }),
    ).toBeInTheDocument();
  });

  it("signed in: the CTA opens the app", () => {
    render(<LandingSections signedIn />);
    expect(
      screen.getByRole("link", { name: /open monolith/i }),
    ).toHaveAttribute("href", "/boards");
  });
});
