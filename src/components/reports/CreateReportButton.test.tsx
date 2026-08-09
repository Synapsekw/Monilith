import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CreateReportButton } from "@/components/reports/CreateReportButton";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const createReport = vi.fn();
const createReportFromTemplate = vi.fn();
vi.mock("@/lib/reports/actions", () => ({
  createReport: (input: unknown) => createReport(input),
  createReportFromTemplate: (input: unknown) => createReportFromTemplate(input),
}));

const showMutationError = vi.fn();
vi.mock("@/lib/ui/mutation-toast", () => ({
  showMutationError: (...a: unknown[]) => showMutationError(...a),
}));

beforeEach(() => {
  vi.clearAllMocks();
  createReport.mockResolvedValue({ ok: true, data: { id: "r1" } });
  createReportFromTemplate.mockResolvedValue({ ok: true, data: { id: "r2" } });
});

describe("CreateReportButton", () => {
  it("stays a one-click create when the org has no templates", async () => {
    render(<CreateReportButton boardId="b1" />);
    expect(
      screen.queryByRole("button", { name: /Start from a template/ }),
    ).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /New report/ }));
    await waitFor(() =>
      expect(createReport).toHaveBeenCalledWith({
        name: "Status Report",
        scope: "board",
        boardId: "b1",
      }),
    );
    // Lands in the builder at its new home, not under the board.
    await waitFor(() => expect(push).toHaveBeenCalledWith("/reports/r1"));
  });

  it("keeps the blank one-click create alongside the template menu", async () => {
    render(
      <CreateReportButton
        boardId="b1"
        templates={[{ id: "t1", name: "Weekly status" }]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /New report/ }));
    await waitFor(() => expect(createReport).toHaveBeenCalledTimes(1));
    expect(createReportFromTemplate).not.toHaveBeenCalled();
  });

  it("starts a report from a chosen template", async () => {
    render(
      <CreateReportButton
        boardId="b1"
        templates={[
          { id: "t1", name: "Weekly status" },
          { id: "t2", name: "Exec roll-up" },
        ]}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Start from a template/ }),
    );
    await userEvent.click(
      screen.getByRole("menuitem", { name: "Exec roll-up" }),
    );

    await waitFor(() =>
      expect(createReportFromTemplate).toHaveBeenCalledWith({
        templateId: "t2",
        name: "Exec roll-up",
        scope: "board",
        boardId: "b1",
      }),
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith("/reports/r2"));
  });

  it("surfaces a failure instead of navigating", async () => {
    createReport.mockResolvedValue({ ok: false, error: "Nope." });
    render(<CreateReportButton boardId="b1" />);
    await userEvent.click(screen.getByRole("button", { name: /New report/ }));

    await waitFor(() => expect(showMutationError).toHaveBeenCalledTimes(1));
    expect(push).not.toHaveBeenCalled();
  });
});
