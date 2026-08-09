import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReportRowActions } from "@/components/reports/ReportRowActions";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const deleteReport = vi.fn();
vi.mock("@/lib/reports/actions", () => ({
  deleteReport: (input: unknown) => deleteReport(input),
}));

beforeEach(() => {
  vi.clearAllMocks();
  deleteReport.mockResolvedValue({ ok: true, data: undefined });
});

const open = () =>
  userEvent.click(
    screen.getByRole("button", { name: /Actions for Q3 Status/ }),
  );

describe("ReportRowActions", () => {
  it("deletes by report id alone — a report may span several boards", async () => {
    render(<ReportRowActions reportId="r1" reportName="Q3 Status" />);
    await open();
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    await userEvent.click(
      screen.getByRole("button", { name: /Delete report/ }),
    );

    await waitFor(() =>
      expect(deleteReport).toHaveBeenCalledWith({ reportId: "r1" }),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it("keeps the dialog open and shows the reason when the delete fails", async () => {
    deleteReport.mockResolvedValue({ ok: false, error: "You can't do that." });
    render(<ReportRowActions reportId="r1" reportName="Q3 Status" />);
    await open();
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    await userEvent.click(
      screen.getByRole("button", { name: /Delete report/ }),
    );

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("You can't do that."),
    );
    expect(refresh).not.toHaveBeenCalled();
  });
});
