import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { OnboardingForm } from "./onboarding-form";

describe("OnboardingForm", () => {
  it("renders the organization name and workspace name fields", () => {
    render(<OnboardingForm />);

    expect(screen.getByLabelText(/organization name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/workspace name/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /create organization/i }),
    ).toBeInTheDocument();
  });

  it("renders the Keystone entry-card treatment", () => {
    render(<OnboardingForm />);

    const kicker = screen.getByText("GET STARTED");
    expect(kicker).toBeInTheDocument();

    const card = kicker.closest(".shadow-panel");
    expect(card).not.toBeNull();

    const submit = screen.getByRole("button", {
      name: /create organization/i,
    });
    expect(submit).toHaveClass("shadow-glow-primary");
  });
});
