import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const setPref = vi.fn();
vi.mock("@/lib/settings/notification-prefs-actions", () => ({
  setNotificationPreference: (...args: unknown[]) => setPref(...args),
}));

import { NotificationPreferencesForm } from "./NotificationPreferencesForm";

beforeEach(() => setPref.mockReset());

describe("NotificationPreferencesForm", () => {
  it("renders a checkbox per controllable kind, checked when not disabled", () => {
    render(<NotificationPreferencesForm disabledKinds={["mention"]} />);
    const mentions = screen.getByLabelText("Mentions") as HTMLInputElement;
    const assignments = screen.getByLabelText(
      "Assignments",
    ) as HTMLInputElement;
    expect(mentions.checked).toBe(false); // disabled -> unchecked
    expect(assignments.checked).toBe(true);
  });

  it("optimistically disables and calls the action with enabled:false", async () => {
    setPref.mockResolvedValue({ ok: true, data: null });
    render(<NotificationPreferencesForm disabledKinds={[]} />);
    const assignments = screen.getByLabelText(
      "Assignments",
    ) as HTMLInputElement;

    fireEvent.click(assignments); // uncheck => disable
    expect(assignments.checked).toBe(false);
    await waitFor(() =>
      expect(setPref).toHaveBeenCalledWith({
        kind: "assigned",
        enabled: false,
      }),
    );
  });

  it("reverts the checkbox when the action fails", async () => {
    setPref.mockResolvedValue({ ok: false, error: "nope" });
    render(<NotificationPreferencesForm disabledKinds={[]} />);
    const mentions = screen.getByLabelText("Mentions") as HTMLInputElement;

    fireEvent.click(mentions);
    await waitFor(() => expect(mentions.checked).toBe(true)); // reverted
  });
});
