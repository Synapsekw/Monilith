import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProfileForm } from "./profile-form";

vi.mock("@/lib/profile/actions", () => ({
  updateProfileFullName: vi.fn(async () => ({ ok: true, data: undefined })),
}));
import { updateProfileFullName } from "@/lib/profile/actions";

beforeEach(() => {
  vi.mocked(updateProfileFullName).mockClear();
  vi.mocked(updateProfileFullName).mockResolvedValue({
    ok: true,
    data: undefined,
  });
});

describe("ProfileForm", () => {
  it("shows the current display name and disables save until it changes", () => {
    render(<ProfileForm currentFullName="Ada Lovelace" />);
    expect(screen.getByLabelText(/display name/i)).toHaveValue("Ada Lovelace");
    expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();
  });

  it("saves a trimmed name via the action", async () => {
    render(<ProfileForm currentFullName={null} />);
    await userEvent.type(screen.getByLabelText(/display name/i), "  Grace  ");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(updateProfileFullName).toHaveBeenCalledWith({ fullName: "Grace" });
    expect(await screen.findByText(/saved\./i)).toBeInTheDocument();
  });

  it("clears the name by submitting an empty value as null", async () => {
    render(<ProfileForm currentFullName="Ada" />);
    await userEvent.clear(screen.getByLabelText(/display name/i));
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(updateProfileFullName).toHaveBeenCalledWith({ fullName: null });
  });

  it("surfaces the action error inline", async () => {
    vi.mocked(updateProfileFullName).mockResolvedValueOnce({
      ok: false,
      error: "Could not update your name.",
    });
    render(<ProfileForm currentFullName={null} />);
    await userEvent.type(screen.getByLabelText(/display name/i), "Grace");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(
      await screen.findByText(/could not update your name/i),
    ).toBeInTheDocument();
  });
});
