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

  // Signup is open — there is no waitlist. The closing CTA must be a real link
  // to /signup, never the inert email-input-plus-`type="button"` it used to be:
  // a closing CTA that goes nowhere is the one failure this band cannot have.
  it("logged out: the closing CTA links to signup, with no dead controls", () => {
    render(<LandingSections />);
    const cta = screen.getByRole("link", { name: /create your workspace/i });
    expect(cta).toHaveAttribute("href", "/signup");
    expect(
      screen.queryByRole("button", { name: /request access/i }),
    ).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("logged in: the closing CTA goes to the boards instead", () => {
    render(<LandingSections signedIn />);
    expect(
      screen.getByRole("link", { name: /open monolith/i }),
    ).toHaveAttribute("href", "/boards");
  });

  // Said in both places a visitor looks: the closing CTA and the "How do I get
  // in?" FAQ answer. The old copy promised invite waves in both.
  it("tells visitors there is no waitlist, in the CTA and the FAQ", () => {
    render(<LandingSections />);
    expect(screen.getAllByText(/no waitlist/i)).toHaveLength(2);
    expect(
      screen.queryByText(
        /invite-only|onboard(ing)? in (small )?(batches|waves)/i,
      ),
    ).toBeNull();
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
