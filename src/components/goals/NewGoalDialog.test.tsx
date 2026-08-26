import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const createGoal = vi.fn<
  (
    a: unknown,
  ) => Promise<{ ok: false; error: string } | { ok: true; data: unknown }>
>(async () => ({ ok: true, data: {} }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/goals/actions", () => ({
  createGoal: (a: unknown) => createGoal(a),
}));

import { NewGoalDialog } from "@/components/goals/NewGoalDialog";

beforeEach(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.scrollIntoView ??= () => {};
  createGoal.mockClear();
});

async function openAndFailSubmit(error: string) {
  createGoal.mockResolvedValueOnce({ ok: false, error });
  render(<NewGoalDialog members={[]} />);
  await userEvent.click(screen.getByRole("button", { name: /new goal/i }));
  await userEvent.type(screen.getByLabelText("Goal name"), "Grow ARR");
  await userEvent.click(screen.getByRole("button", { name: /create goal/i }));
}

/**
 * The a11y contract for a failed create: the server error must reach a screen
 * reader user as part of the field they have to fix, not as orphaned text.
 * The id wiring itself is proven once in `ui/field-status.test.tsx`; this
 * suite proves this dialog is actually wired to it.
 */
describe("NewGoalDialog a11y", () => {
  it("describes the name input with the submit error and marks it invalid", async () => {
    await openAndFailSubmit("A goal with that name already exists.");

    const input = await screen.findByLabelText("Goal name");
    expect(input).toHaveAccessibleDescription(
      "A goal with that name already exists.",
    );
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  it("announces the error as an alert", async () => {
    await openAndFailSubmit("Something went wrong.");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Something went wrong.",
    );
  });

  it("leaves the name input valid and undescribed before any error", async () => {
    render(<NewGoalDialog members={[]} />);
    await userEvent.click(screen.getByRole("button", { name: /new goal/i }));

    const input = screen.getByLabelText("Goal name");
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(input).not.toHaveAttribute("aria-describedby");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

// Focus restoration after the pending transition is NOT asserted here: jsdom
// never reproduces the browser's focus-to-<body> drop that
// `useRestoreFocusAfterPending` exists to undo, so the assertion passes with or
// without the hook. That behavior is covered by the hook's own suite,
// `src/lib/hooks/use-restore-focus-after-pending.test.ts`.
