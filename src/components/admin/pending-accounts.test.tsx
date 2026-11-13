import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PendingAccounts } from "./pending-accounts";
import type { PlatformUser } from "@/lib/platform/queries";

const { refresh, approveUserAction, rejectUserAction, toastError } = vi.hoisted(
  () => ({
    refresh: vi.fn(),
    approveUserAction: vi.fn(),
    rejectUserAction: vi.fn(),
    toastError: vi.fn(),
  }),
);

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("sonner", () => ({ toast: { error: toastError, success: vi.fn() } }));
vi.mock("@/lib/platform/search-action", () => ({
  approveUserAction: (id: string) => approveUserAction(id),
  rejectUserAction: (id: string) => rejectUserAction(id),
}));

const ADA = "22222222-2222-4222-8222-222222222222";
const BOB = "44444444-4444-4444-8444-444444444444";
const account = (
  id: string,
  email: string,
  orgNames: string[] = [],
): PlatformUser => ({
  id,
  email,
  bannedUntil: null,
  orgNames,
  approvalStatus: "pending",
  createdAt: "2026-11-12T09:30:00Z",
});
const accounts = [
  account(ADA, "ada@eand.com", ["Acme"]),
  account(BOB, "probe-1@example.com"),
];

beforeEach(() => vi.clearAllMocks());

describe("PendingAccounts", () => {
  it("renders nothing when nobody is waiting", () => {
    const { container } = render(<PendingAccounts accounts={[]} />);
    expect(container.innerHTML).toBe("");
  });

  it("lists each waiting account with its signup date (no organisations column)", () => {
    render(<PendingAccounts accounts={accounts} />);
    expect(
      screen.getByRole("heading", { name: /waiting for approval/i }),
    ).toBeTruthy();
    expect(screen.getByText("ada@eand.com")).toBeTruthy();
    expect(screen.getByText("probe-1@example.com")).toBeTruthy();
    expect(screen.queryByText("Organizations")).toBeNull();
    expect(screen.getAllByText("Nov 12, 2026")).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: /^approve/i })).toHaveLength(
      2,
    );
  });

  it("shows the exact total and a cap note when the list is truncated", () => {
    render(<PendingAccounts accounts={accounts} total={120} />);
    expect(screen.getByText("120")).toBeTruthy();
    expect(screen.getByText("Showing the newest 2")).toBeTruthy();
  });

  it("shows no cap note when the whole list is shown", () => {
    render(<PendingAccounts accounts={accounts} total={2} />);
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.queryByText(/showing the newest/i)).toBeNull();
  });

  it("approves with the account's id and refreshes", async () => {
    approveUserAction.mockResolvedValue({ ok: true, data: undefined });
    const user = userEvent.setup();
    render(<PendingAccounts accounts={accounts} />);
    await user.click(
      screen.getByRole("button", { name: "Approve ada@eand.com" }),
    );
    await waitFor(() => expect(approveUserAction).toHaveBeenCalledWith(ADA));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(rejectUserAction).not.toHaveBeenCalled();
  });

  it("shows a refused approval as an error toast", async () => {
    approveUserAction.mockResolvedValue({
      ok: false,
      error: "Not authorized.",
    });
    const user = userEvent.setup();
    render(<PendingAccounts accounts={accounts} />);
    await user.click(
      screen.getByRole("button", { name: "Approve ada@eand.com" }),
    );
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "Couldn't approve ada@eand.com.",
        { description: "Not authorized." },
      ),
    );
    expect(refresh).not.toHaveBeenCalled();
  });

  it("asks for confirmation before rejecting", async () => {
    rejectUserAction.mockResolvedValue({ ok: true, data: undefined });
    const user = userEvent.setup();
    render(<PendingAccounts accounts={accounts} />);
    await user.click(
      screen.getByRole("button", { name: "Reject probe-1@example.com" }),
    );
    // Opening the dialog alone must not reject anyone.
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("probe-1@example.com");
    expect(rejectUserAction).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Reject account" }));
    await waitFor(() => expect(rejectUserAction).toHaveBeenCalledWith(BOB));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("cancelling the confirmation rejects nobody", async () => {
    const user = userEvent.setup();
    render(<PendingAccounts accounts={accounts} />);
    await user.click(
      screen.getByRole("button", { name: "Reject ada@eand.com" }),
    );
    await screen.findByRole("alertdialog");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(rejectUserAction).not.toHaveBeenCalled();
  });

  it("shows a failed rejection as an error toast", async () => {
    rejectUserAction.mockResolvedValue({
      ok: false,
      error: "You can't reject your own account.",
    });
    const user = userEvent.setup();
    render(<PendingAccounts accounts={accounts} />);
    await user.click(
      screen.getByRole("button", { name: "Reject ada@eand.com" }),
    );
    await screen.findByRole("alertdialog");
    await user.click(screen.getByRole("button", { name: "Reject account" }));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Couldn't reject ada@eand.com.", {
        description: "You can't reject your own account.",
      }),
    );
  });
});
