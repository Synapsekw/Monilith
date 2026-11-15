import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { GuestUnavailable } from "./guest-unavailable";

describe("GuestUnavailable", () => {
  it("names the page, explains why, offers the way back and no create control", () => {
    render(<GuestUnavailable title="Goals" />);
    expect(screen.getByRole("heading", { name: "Goals" })).toBeInTheDocument();
    expect(
      screen.getByText("Goals is not available to guests"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/You are a guest in this organization/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Go to your folders" }),
    ).toHaveAttribute("href", "/dashboards");
    expect(screen.queryByRole("button")).toBeNull();
  });
});
