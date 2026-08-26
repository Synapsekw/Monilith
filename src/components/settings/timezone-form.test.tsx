import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TimezoneForm } from "./timezone-form";

vi.mock("@/lib/org/actions", () => ({
  updateOrgTimezone: vi.fn(async () => ({ ok: true, data: undefined })),
}));
import { updateOrgTimezone } from "@/lib/org/actions";

describe("TimezoneForm", () => {
  it("names the combobox 'Time zone', not the current value", () => {
    render(<TimezoneForm orgId="o1" currentTimezone="Europe/Belgrade" />);
    expect(
      screen.getByRole("combobox", { name: "Time zone" }),
    ).toHaveAccessibleDescription(/belgrade/i);
  });

  it("ties a save error to the Save button via aria-describedby, announced as an alert", async () => {
    vi.mocked(updateOrgTimezone).mockResolvedValueOnce({
      ok: false,
      error: "Could not save the organization timezone.",
    });
    render(<TimezoneForm orgId="o1" currentTimezone="UTC" />);
    await userEvent.click(screen.getByRole("combobox", { name: "Time zone" }));
    await userEvent.type(
      screen.getByPlaceholderText(/search timezone/i),
      "New York",
    );
    await userEvent.click(
      await screen.findByRole("option", { name: /new york/i }),
    );
    const save = screen.getByRole("button", { name: /save/i });
    await userEvent.click(save);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/could not save the organization/i);
    expect(save).toHaveAttribute("aria-describedby", alert.id);
  }, 30_000);

  it("does not steal focus from elsewhere once a save resolves", async () => {
    let release: (v: { ok: true; data: undefined }) => void = () => {};
    vi.mocked(updateOrgTimezone).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    render(
      <>
        <TimezoneForm orgId="o1" currentTimezone="UTC" />
        <input aria-label="Elsewhere on the page" />
      </>,
    );
    await userEvent.click(screen.getByRole("combobox", { name: "Time zone" }));
    await userEvent.type(
      screen.getByPlaceholderText(/search timezone/i),
      "New York",
    );
    await userEvent.click(
      await screen.findByRole("option", { name: /new york/i }),
    );
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    const elsewhere = screen.getByLabelText("Elsewhere on the page");
    await userEvent.click(elsewhere);
    expect(elsewhere).toHaveFocus();

    release({ ok: true, data: undefined });
    await screen.findByRole("status");
    expect(elsewhere).toHaveFocus();
  }, 30_000);

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
