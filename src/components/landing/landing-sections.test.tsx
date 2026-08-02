import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { LandingSections } from "./landing-sections";

describe("LandingSections", () => {
  it("renders the core marketing sections", () => {
    render(<LandingSections />);
    expect(
      screen.getByText("The workspace thinks with you."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Agents you can actually let in."),
    ).toBeInTheDocument();
    expect(screen.getByText("One dataset. Every angle.")).toBeInTheDocument();
    expect(
      screen.getByText("And all the connective tissue."),
    ).toBeInTheDocument();
  });

  it("renders the agents section with both feature rows", () => {
    render(<LandingSections />);
    expect(
      screen.getByText("Work alongside agents, not another tool."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Mention an agent. It answers in the thread."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("A morning brief, without asking for it."),
    ).toBeInTheDocument();
  });

  // Named per-user agents are NOT shipped. The claim must carry its rollout
  // marker, or the page is announcing something a visitor cannot get — the
  // exact trap the changelog hit when it announced semantic search early.
  it("labels the unshipped named-agent claim as rolling out", () => {
    render(<LandingSections />);
    expect(screen.getByText("Named agents · rolling out")).toBeInTheDocument();
  });

  it("logged out: the waitlist CTA is a Request access control", () => {
    render(<LandingSections />);
    expect(
      screen.getByRole("button", { name: "Request access" }),
    ).toBeInTheDocument();
  });

  it("answers the questions a visitor actually has", () => {
    render(<LandingSections />);
    expect(
      screen.getByText("The things people actually ask."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Can an agent see data I can't?"),
    ).toBeInTheDocument();
  });

  // No section may carry its own background: a per-section background draws a
  // boundary, and stacked boundaries are what made this read as grey slabs.
  // The page has one continuous wash instead.
  it("renders no section-level background slabs", () => {
    const { container } = render(<LandingSections />);
    expect(container.querySelectorAll("section.bg-surface")).toHaveLength(0);
    expect(container.querySelectorAll("section.border-y")).toHaveLength(0);
  });

  it("signed in: the CTA opens the app", () => {
    render(<LandingSections signedIn />);
    expect(
      screen.getByRole("link", { name: /open monolith/i }),
    ).toHaveAttribute("href", "/boards");
  });
});
