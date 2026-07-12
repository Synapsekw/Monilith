import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ActionConfirmCard } from "./ActionConfirmCard";
import type { ValidatedAction } from "@/lib/ai/write/schema";

const action: ValidatedAction = {
  kind: "create_item",
  boardId: "b1",
  groupId: "g1",
  name: "Ship v2",
  summary: 'Create task "Ship v2" in Backlog',
  warnings: ["'Dana' matched 2 members — used Dana Ruiz"],
};

describe("ActionConfirmCard", () => {
  it("shows the summary + warnings and fires callbacks", async () => {
    const onApprove = vi.fn();
    const onCancel = vi.fn();
    render(
      <ActionConfirmCard
        action={action}
        onApprove={onApprove}
        onCancel={onCancel}
        state="idle"
      />,
    );
    expect(
      screen.getByText(/Create task "Ship v2" in Backlog/),
    ).toBeInTheDocument();
    expect(screen.getByText(/matched 2 members/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /approve/i }));
    expect(onApprove).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalled();
  });

  it("hides the buttons and shows the result note once done", () => {
    render(
      <ActionConfirmCard
        action={action}
        onApprove={vi.fn()}
        onCancel={vi.fn()}
        state="done"
        resultNote="Created — open it from the board."
      />,
    );
    expect(
      screen.queryByRole("button", { name: /approve/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Created — open it/)).toBeInTheDocument();
  });
});
