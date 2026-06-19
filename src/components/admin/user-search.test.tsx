import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { UserSearch } from "./user-search";

const searchUsersAction = vi.fn();
const deactivateUserAction = vi.fn();
const reactivateUserAction = vi.fn();

vi.mock("@/lib/platform/search-action", () => ({
  searchUsersAction: (...args: unknown[]) => searchUsersAction(...args),
  deactivateUserAction: (...args: unknown[]) => deactivateUserAction(...args),
  reactivateUserAction: (...args: unknown[]) => reactivateUserAction(...args),
}));

beforeEach(() => {
  searchUsersAction.mockReset().mockResolvedValue([]);
  deactivateUserAction.mockReset().mockResolvedValue({ ok: true, data: null });
  reactivateUserAction.mockReset().mockResolvedValue({ ok: true, data: null });
});

describe("UserSearch", () => {
  it("calls the search action and renders matching users", async () => {
    searchUsersAction.mockResolvedValue([
      { id: "u-1", email: "ada@x.com" },
      { id: "u-2", email: "bob@x.com" },
    ]);

    render(<UserSearch />);
    fireEvent.change(screen.getByLabelText("Search users by email"), {
      target: { value: "x.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() =>
      expect(searchUsersAction).toHaveBeenCalledWith("x.com"),
    );
    expect(await screen.findByText("ada@x.com")).toBeInTheDocument();
    expect(screen.getByText("bob@x.com")).toBeInTheDocument();
  });

  it("shows an empty-state after a search with no matches", async () => {
    render(<UserSearch />);
    fireEvent.change(screen.getByLabelText("Search users by email"), {
      target: { value: "nope" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    expect(await screen.findByText("No matching users.")).toBeInTheDocument();
  });

  it("invokes deactivate/reactivate actions for the chosen user", async () => {
    searchUsersAction.mockResolvedValue([{ id: "u-1", email: "ada@x.com" }]);

    render(<UserSearch />);
    fireEvent.change(screen.getByLabelText("Search users by email"), {
      target: { value: "ada" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    const row = (await screen.findByText("ada@x.com")).closest("li")!;
    fireEvent.click(within(row).getByRole("button", { name: "Ban" }));
    await waitFor(() =>
      expect(deactivateUserAction).toHaveBeenCalledWith("u-1"),
    );

    fireEvent.click(within(row).getByRole("button", { name: "Unban" }));
    await waitFor(() =>
      expect(reactivateUserAction).toHaveBeenCalledWith("u-1"),
    );
  });

  it("surfaces an inline error when a ban action fails", async () => {
    searchUsersAction.mockResolvedValue([{ id: "u-1", email: "ada@x.com" }]);
    deactivateUserAction.mockResolvedValue({
      ok: false,
      error: "Could not deactivate user.",
    });

    render(<UserSearch />);
    fireEvent.change(screen.getByLabelText("Search users by email"), {
      target: { value: "ada" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    const row = (await screen.findByText("ada@x.com")).closest("li")!;
    fireEvent.click(within(row).getByRole("button", { name: "Ban" }));

    expect(
      await screen.findByText("Could not deactivate user."),
    ).toBeInTheDocument();
  });
});
