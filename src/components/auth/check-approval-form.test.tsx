import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { checkApproval } = vi.hoisted(() => ({ checkApproval: vi.fn() }));
vi.mock("@/app/pending-approval/actions", () => ({
  checkApproval: () => checkApproval(),
}));

import { CheckApprovalForm } from "./check-approval-form";

beforeEach(() => {
  checkApproval.mockReset().mockResolvedValue({ ok: true, data: undefined });
});

describe("CheckApprovalForm", () => {
  it("shows nothing extra before the first check", () => {
    render(<CheckApprovalForm />);
    expect(screen.queryByText("Still waiting for approval.")).toBeNull();
  });

  it("says the account is still waiting after a check that did not redirect", async () => {
    render(<CheckApprovalForm />);
    await userEvent.click(screen.getByRole("button", { name: /check again/i }));
    expect(await screen.findByText("Still waiting for approval.")).toBeTruthy();
  });

  it("does not say 'waiting' for a rejected account", async () => {
    render(<CheckApprovalForm rejected />);
    await userEvent.click(screen.getByRole("button", { name: /check again/i }));
    expect(checkApproval).toHaveBeenCalled();
    expect(screen.queryByText("Still waiting for approval.")).toBeNull();
  });

  it("shows the error, not the waiting line, when the check fails", async () => {
    checkApproval.mockResolvedValue({ ok: false, error: "nope" });
    render(<CheckApprovalForm />);
    await userEvent.click(screen.getByRole("button", { name: /check again/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("nope");
    expect(screen.queryByText("Still waiting for approval.")).toBeNull();
  });
});
