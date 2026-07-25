import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TimezoneForm } from "./timezone-form";

vi.mock("@/lib/org/actions", () => ({
  updateOrgTimezone: vi.fn(async () => ({ ok: true, data: undefined })),
}));
import { updateOrgTimezone } from "@/lib/org/actions";

describe("TimezoneForm", () => {
  it("shows the current timezone on the trigger", () => {
    render(<TimezoneForm orgId="o1" currentTimezone="Europe/Belgrade" />);
    expect(
      screen.getByRole("combobox", { name: /belgrade/i }),
    ).toBeInTheDocument();
  });

  // Explicit budget: opening the combobox and typing re-filters the full IANA
  // timezone list on every keystroke, so this test costs seconds of real work
  // even when it passes. At vitest's 5s default it fails on wall-clock alone
  // whenever the suite runs under CPU pressure (parallel agents, CI), which has
  // aborted finish-task runs. Slow test, not a broken one — so give it room.
  it("saves the chosen timezone via the action", async () => {
    render(<TimezoneForm orgId="o1" currentTimezone="UTC" />);
    await userEvent.click(screen.getByRole("combobox"));
    await userEvent.type(
      screen.getByPlaceholderText(/search timezone/i),
      "New York",
    );
    await userEvent.click(
      await screen.findByRole("option", { name: /new york/i }),
    );
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(updateOrgTimezone).toHaveBeenCalledWith({
      orgId: "o1",
      timezone: "America/New_York",
    });
  }, 30_000);
});
