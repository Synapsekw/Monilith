import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TimezonePicker } from "./timezone-picker";

/**
 * The three a11y defects the repo's dev-memory vault attributed to this
 * component (2026-08-11 session note, "matching ui/timezone-picker.tsx"):
 *   1. Focus dropped to `<body>` after a select/clear.
 *   2. Error text not tied to its control (out of scope here — this
 *      component never renders its own error text; callers do, see
 *      personal-timezone-form.test.tsx / timezone-form.test.tsx).
 *   3. The combobox named from its live VALUE rather than a static label.
 */
describe("TimezonePicker", () => {
  it("names the combobox from the static label, not the selected value", () => {
    render(
      <TimezonePicker
        value="America/New_York"
        onChange={vi.fn()}
        label="Time zone"
      />,
    );
    expect(
      screen.getByRole("combobox", { name: "Time zone" }),
    ).toBeInTheDocument();
    // The name must NOT be (or contain) the live value.
    expect(
      screen.queryByRole("combobox", { name: /new york/i }),
    ).not.toBeInTheDocument();
  });

  it("still exposes the current value, as the accessible description", () => {
    render(
      <TimezonePicker
        value="America/New_York"
        onChange={vi.fn()}
        label="Time zone"
      />,
    );
    expect(
      screen.getByRole("combobox", { name: "Time zone" }),
    ).toHaveAccessibleDescription(/new york/i);
  });

  it("falls back to a sensible default label when the caller passes none", () => {
    render(<TimezonePicker value={null} onChange={vi.fn()} />);
    expect(
      screen.getByRole("combobox", { name: "Timezone" }),
    ).toBeInTheDocument();
  });

  it("describes the automatic-device state as the value, not the name", () => {
    render(
      <TimezonePicker
        value={null}
        onChange={vi.fn()}
        allowAutomatic
        label="Time zone"
      />,
    );
    const trigger = screen.getByRole("combobox", { name: "Time zone" });
    expect(trigger).toHaveAccessibleDescription(/automatic/i);
  });

  // Radix Popover's default `onCloseAutoFocus` returns focus to the trigger
  // when the popover closes — nothing here overrides it — so selecting an
  // option (which calls `setOpen(false)`) must land focus back on the
  // trigger, not `<body>`.
  it("returns focus to the trigger after picking a timezone closes the popover", async () => {
    const user = userEvent.setup();
    render(
      <TimezonePicker value={null} onChange={vi.fn()} label="Time zone" />,
    );
    const trigger = screen.getByRole("combobox", { name: "Time zone" });
    await user.click(trigger);
    await user.type(screen.getByPlaceholderText(/search timezone/i), "Tokyo");
    await user.click(await screen.findByRole("option", { name: /tokyo/i }));

    await waitFor(() => expect(trigger).toHaveFocus());
    expect(document.body).not.toHaveFocus();
  }, 15_000);

  it("returns focus to the trigger after clearing to Automatic", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <TimezonePicker
        value="Asia/Tokyo"
        onChange={onChange}
        allowAutomatic
        label="Time zone"
      />,
    );
    const trigger = screen.getByRole("combobox", { name: "Time zone" });
    await user.click(trigger);
    await user.click(await screen.findByRole("option", { name: /automatic/i }));

    expect(onChange).toHaveBeenCalledWith(null);
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(document.body).not.toHaveFocus();
  }, 15_000);
});
