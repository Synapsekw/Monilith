import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AppearanceForm } from "./appearance-form";

const setTheme = vi.fn();
vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: "dark", setTheme }),
}));

beforeEach(() => vi.clearAllMocks());

describe("AppearanceForm", () => {
  it("offers light, dark and system", () => {
    render(<AppearanceForm />);
    expect(screen.getByRole("radio", { name: "Light" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Dark" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "System" })).toBeInTheDocument();
  });

  it("marks the active theme as checked", () => {
    render(<AppearanceForm />);
    expect(screen.getByRole("radio", { name: "Dark" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Light" })).not.toBeChecked();
  });

  it("sets the theme on selection", async () => {
    const user = userEvent.setup();
    render(<AppearanceForm />);
    await user.click(screen.getByRole("radio", { name: "Light" }));
    expect(setTheme).toHaveBeenCalledWith("light");
  });
});
