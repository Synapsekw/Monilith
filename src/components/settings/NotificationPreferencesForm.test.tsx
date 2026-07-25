import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const setPref = vi.fn();
vi.mock("@/lib/settings/notification-prefs-actions", () => ({
  setNotificationPreference: (...args: unknown[]) => setPref(...args),
}));

import { NotificationPreferencesForm } from "./NotificationPreferencesForm";

beforeEach(() => setPref.mockReset());

describe("NotificationPreferencesForm", () => {
  it("renders a switch per controllable kind, on when not disabled", () => {
    render(<NotificationPreferencesForm disabledKinds={["mention"]} />);
    expect(screen.getByRole("switch", { name: "Mentions" })).not.toBeChecked();
    expect(screen.getByRole("switch", { name: "Assignments" })).toBeChecked();
  });

  it("shows the description alongside each toggle", () => {
    render(<NotificationPreferencesForm disabledKinds={[]} />);
    expect(
      screen.getByText(/@-mentions you in an update/i),
    ).toBeInTheDocument();
  });

  it("optimistically disables and calls the action with enabled:false", async () => {
    setPref.mockResolvedValue({ ok: true, data: null });
    render(<NotificationPreferencesForm disabledKinds={[]} />);
    const assignments = screen.getByRole("switch", { name: "Assignments" });

    fireEvent.click(assignments);
    expect(assignments).not.toBeChecked();
    await waitFor(() =>
      expect(setPref).toHaveBeenCalledWith({
        kind: "assigned",
        enabled: false,
      }),
    );
  });

  it("reverts the switch when the action fails", async () => {
    setPref.mockResolvedValue({ ok: false, error: "nope" });
    render(<NotificationPreferencesForm disabledKinds={[]} />);
    const mentions = screen.getByRole("switch", { name: "Mentions" });

    fireEvent.click(mentions);
    await waitFor(() => expect(mentions).toBeChecked()); // reverted
  });
});
