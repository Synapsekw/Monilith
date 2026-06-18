import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TimezoneForm } from "./timezone-form";

vi.mock("@/lib/org/actions", () => ({
  updateOrgTimezone: vi.fn(async () => ({ ok: true, data: undefined })),
}));
import { updateOrgTimezone } from "@/lib/org/actions";

describe("TimezoneForm", () => {
  it("renders the current timezone as the selected value", () => {
    render(<TimezoneForm orgId="o1" currentTimezone="Europe/Belgrade" />);
    expect(screen.getByDisplayValue("Europe/Belgrade")).toBeInTheDocument();
  });

  it("saves the chosen timezone via the action", async () => {
    render(<TimezoneForm orgId="o1" currentTimezone="UTC" />);
    const select = screen.getByLabelText(/timezone/i);
    await userEvent.selectOptions(select, "America/New_York");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(updateOrgTimezone).toHaveBeenCalledWith({
      orgId: "o1",
      timezone: "America/New_York",
    });
  });
});
