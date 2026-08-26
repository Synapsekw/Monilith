import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkloadDefaultsDialog } from "@/components/workload/WorkloadDefaultsDialog";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const setWorkloadDefaults = vi.fn();
vi.mock("@/lib/workload/actions", () => ({
  setWorkloadDefaults: (input: unknown) => setWorkloadDefaults(input),
}));

function renderDialog() {
  return render(
    <WorkloadDefaultsDialog
      defaultHoursPerDay={8}
      defaultPerItemHours={2}
      defaultWorkingDays={[1, 2, 3, 4, 5]}
    />,
  );
}

const open = () =>
  userEvent.click(screen.getByRole("button", { name: /Defaults/ }));

const save = () =>
  userEvent.click(screen.getByRole("button", { name: /Save defaults/ }));

const hoursField = () => screen.getByLabelText("Hours per working day");
const perItemField = () =>
  screen.getByLabelText("Effort per dated item without an estimate (h)");

beforeEach(() => {
  vi.clearAllMocks();
  setWorkloadDefaults.mockResolvedValue({ ok: true, data: null });
});

/**
 * The defect this guards: the dialog rendered its failure as loose
 * `text-destructive` text below the working-day toggles, with a hand-written
 * `aria-invalid` on the hours input and NO link between the two. A screen
 * reader user tabbing back to the field after a rejected save heard "Hours per
 * working day, invalid" and never the reason. `useFieldStatus` makes the
 * message the field's accessible DESCRIPTION, and `role="alert"` announces it
 * the moment it appears.
 */
describe("WorkloadDefaultsDialog field errors", () => {
  it("ties a rejected save to the field the message belongs to", async () => {
    setWorkloadDefaults.mockResolvedValue({
      ok: false,
      error: "Only an organization admin can change these defaults.",
    });
    renderDialog();
    await open();
    await save();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Only an organization admin can change these defaults.",
    );
    expect(hoursField()).toHaveAccessibleDescription(
      "Only an organization admin can change these defaults.",
    );
    expect(hoursField()).toHaveAttribute("aria-invalid", "true");
  });

  it("puts a per-item message on the per-item field, leaving hours valid", async () => {
    renderDialog();
    await open();

    // Submitted directly: `min={0}` means the browser's own constraint
    // validation refuses a negative value before React's `onSubmit` ever runs,
    // so a native click can't reach this guard. The guard still has to name
    // the right field for the day the attribute or the value source changes.
    fireEvent.change(perItemField(), { target: { value: "-1" } });
    fireEvent.submit(hoursField().closest("form")!);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Per-item hours must be 0 or more.");
    expect(perItemField()).toHaveAccessibleDescription(
      "Per-item hours must be 0 or more.",
    );
    expect(perItemField()).toHaveAttribute("aria-invalid", "true");
    expect(hoursField()).not.toHaveAttribute("aria-invalid");
    expect(setWorkloadDefaults).not.toHaveBeenCalled();
  });

  it("marks neither field before anything has failed", async () => {
    renderDialog();
    await open();

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(hoursField()).not.toHaveAttribute("aria-invalid");
    expect(hoursField()).toHaveAccessibleDescription("");
    expect(perItemField()).not.toHaveAttribute("aria-invalid");

    await save();
    await waitFor(() =>
      expect(setWorkloadDefaults).toHaveBeenCalledWith({
        defaultHoursPerDay: 8,
        defaultPerItemHours: 2,
        defaultWorkingDays: [1, 2, 3, 4, 5],
      }),
    );
  });
});
