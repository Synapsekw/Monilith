import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PersonalTimezoneForm } from "./personal-timezone-form";

vi.mock("@/lib/profile/actions", () => ({
  updateProfileTimezone: vi.fn(),
}));
import { updateProfileTimezone } from "@/lib/profile/actions";

describe("PersonalTimezoneForm", () => {
  it("names the combobox 'Time zone', not the current value", () => {
    render(<PersonalTimezoneForm currentTimezone="Europe/Belgrade" />);
    expect(
      screen.getByRole("combobox", { name: "Time zone" }),
    ).toHaveAccessibleDescription(/belgrade/i);
  });

  it("ties a save error to the Save button via aria-describedby, announced as an alert", async () => {
    vi.mocked(updateProfileTimezone).mockResolvedValueOnce({
      ok: false,
      error: "Could not save your timezone.",
    });
    render(<PersonalTimezoneForm currentTimezone="UTC" />);

    await userEvent.click(screen.getByRole("combobox", { name: "Time zone" }));
    await userEvent.click(
      await screen.findByRole("option", { name: /automatic/i }),
    );

    const save = screen.getByRole("button", { name: /save/i });
    await userEvent.click(save);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/could not save your timezone/i);
    expect(save).toHaveAttribute("aria-describedby", alert.id);
  }, 15_000);

  it("announces a successful save as a status, tied to the Save button", async () => {
    vi.mocked(updateProfileTimezone).mockResolvedValueOnce({
      ok: true,
      data: undefined,
    });
    render(<PersonalTimezoneForm currentTimezone="UTC" />);

    await userEvent.click(screen.getByRole("combobox", { name: "Time zone" }));
    await userEvent.click(
      await screen.findByRole("option", { name: /automatic/i }),
    );

    const save = screen.getByRole("button", { name: /save/i });
    await userEvent.click(save);

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(/saved/i);
    expect(save).toHaveAttribute("aria-describedby", status.id);
  }, 15_000);

  /**
   * The real focus-drop mechanism (a disabled element can't stay in the tab
   * order, so a browser sends focus to `<body>`) is a genuine browser
   * behavior jsdom does not model: disabling the focused DOM node here
   * leaves `document.activeElement` unchanged, and even an explicit
   * `.blur()` on an already-disabled node is a no-op in jsdom — there's no
   * reliable way to force jsdom into the exact state a browser reaches on
   * its own. That end-to-end drop-and-restore is proven honestly in
   * use-restore-focus-after-pending.test.ts, where the test owns the click
   * handler and can blur in the same tick `disabled` is about to apply
   * (mirroring real timing) instead of fighting jsdom's DOM from outside.
   *
   * What's left to prove at THIS level is the wiring: the hook is attached
   * to the real Save button and driven by the real `pending` transition, and
   * — the one direction jsdom CAN verify honestly, since it never needs
   * `document.activeElement` to become `<body>` — that it never steals focus
   * from somewhere the user deliberately moved to while the save was in
   * flight, once that save resolves.
   */
  it("does not steal focus from elsewhere once a save resolves", async () => {
    let release: (v: { ok: true; data: undefined }) => void = () => {};
    vi.mocked(updateProfileTimezone).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    render(
      <>
        <PersonalTimezoneForm currentTimezone="UTC" />
        <input aria-label="Elsewhere on the page" />
      </>,
    );

    await userEvent.click(screen.getByRole("combobox", { name: "Time zone" }));
    await userEvent.click(
      await screen.findByRole("option", { name: /automatic/i }),
    );
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    // The user moves on while the save is still pending.
    const elsewhere = screen.getByLabelText("Elsewhere on the page");
    await userEvent.click(elsewhere);
    expect(elsewhere).toHaveFocus();

    release({ ok: true, data: undefined });
    await screen.findByRole("status");

    expect(elsewhere).toHaveFocus();
  }, 15_000);
});
