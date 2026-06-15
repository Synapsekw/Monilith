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
});
