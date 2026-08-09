import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TemplateActions } from "@/components/reports/TemplateActions";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const saveReportAsTemplate = vi.fn();
vi.mock("@/lib/reports/actions", () => ({
  saveReportAsTemplate: (input: unknown) => saveReportAsTemplate(input),
}));

vi.mock("@/lib/ui/mutation-toast", () => ({ showMutationError: vi.fn() }));

const REPORT_ID = "00000000-0000-4000-8000-000000000001";

function renderActions(disabled = false) {
  return render(
    <TemplateActions
      reportId={REPORT_ID}
      reportName="Q3 Status"
      disabled={disabled}
    />,
  );
}

const open = () =>
  userEvent.click(screen.getByRole("button", { name: /Save as template/ }));

beforeEach(() => {
  vi.clearAllMocks();
  saveReportAsTemplate.mockResolvedValue({ ok: true, data: { id: "t1" } });
});

describe("TemplateActions", () => {
  it("prompts for a name, prefilled with the report's own", async () => {
    renderActions();
    await open();
    expect(screen.getByLabelText("Template name")).toHaveValue("Q3 Status");
  });

  it("saves the template under the name the user chose", async () => {
    renderActions();
    await open();
    const input = screen.getByLabelText("Template name");
    await userEvent.clear(input);
    await userEvent.type(input, "Weekly status layout");
    await userEvent.click(
      screen.getByRole("button", { name: /Save template/ }),
    );

    await waitFor(() =>
      expect(saveReportAsTemplate).toHaveBeenCalledWith({
        reportId: REPORT_ID,
        name: "Weekly status layout",
      }),
    );
    // A new row exists in the org gallery, so the refresh is warranted.
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it("will not submit an empty name", async () => {
    renderActions();
    await open();
    await userEvent.clear(screen.getByLabelText("Template name"));
    expect(
      screen.getByRole("button", { name: /Save template/ }),
    ).toBeDisabled();
    expect(saveReportAsTemplate).not.toHaveBeenCalled();
  });

  it("keeps the dialog open and shows the reason when the save fails", async () => {
    saveReportAsTemplate.mockResolvedValue({
      ok: false,
      error: "You can't turn this report into a template.",
    });
    renderActions();
    await open();
    await userEvent.click(
      screen.getByRole("button", { name: /Save template/ }),
    );

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "You can't turn this report into a template.",
      ),
    );
    expect(screen.getByLabelText("Template name")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("is disabled for a viewer", () => {
    renderActions(true);
    expect(
      screen.getByRole("button", { name: /Save as template/ }),
    ).toBeDisabled();
  });
});
