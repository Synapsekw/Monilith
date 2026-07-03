import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useUIStore } from "@/stores/ui";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

const createBoardFromTemplate = vi.fn();
vi.mock("@/lib/boards/actions", () => ({
  createBoardFromTemplate: (...args: unknown[]) =>
    createBoardFromTemplate(...args),
}));

const previewImport = vi.fn();
const commitImport = vi.fn();
vi.mock("@/lib/boards/spreadsheet-actions", () => ({
  previewImport: (...args: unknown[]) => previewImport(...args),
  commitImport: (...args: unknown[]) => commitImport(...args),
}));

import { NewBoardDialog } from "@/components/boards/NewBoardDialog";

beforeEach(() => {
  push.mockReset();
  refresh.mockReset();
  createBoardFromTemplate.mockReset();
  createBoardFromTemplate.mockResolvedValue({
    ok: true,
    data: { boardId: "b1" },
  });
  useUIStore.setState({ newBoardOpen: false });
});

describe("NewBoardDialog", () => {
  it("opens, shows a card per template, and creates from the chosen one", async () => {
    render(<NewBoardDialog workspaceId="ws1" />);
    fireEvent.click(screen.getByRole("button", { name: /new board/i }));

    expect(screen.getByText("Blank board")).toBeInTheDocument();
    expect(screen.getByText("Sprint planning")).toBeInTheDocument();
    expect(screen.getByText("Content calendar")).toBeInTheDocument();
    expect(screen.getByText("Sales CRM")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Sprint planning"));
    fireEvent.click(screen.getByRole("button", { name: /create board/i }));

    await waitFor(() =>
      expect(createBoardFromTemplate).toHaveBeenCalledWith({
        workspaceId: "ws1",
        templateId: "sprints",
        name: "Sprint planning",
      }),
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith("/boards/b1"));
  });

  it("defaults to the Blank template", async () => {
    render(<NewBoardDialog workspaceId="ws1" />);
    fireEvent.click(screen.getByRole("button", { name: /new board/i }));
    fireEvent.click(screen.getByRole("button", { name: /create board/i }));
    await waitFor(() =>
      expect(createBoardFromTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ templateId: "blank" }),
      ),
    );
  });

  it("opens when the newBoardOpen store flag is set (controlled path)", async () => {
    render(<NewBoardDialog workspaceId="ws1" />);
    expect(
      screen.queryByText(
        "Pick a template to start from, then name your board.",
      ),
    ).toBeNull();
    useUIStore.setState({ newBoardOpen: true });
    await waitFor(() =>
      expect(
        screen.getByText(
          "Pick a template to start from, then name your board.",
        ),
      ).toBeInTheDocument(),
    );
  });

  it("collapsed: hides the trigger but still opens from the store flag", async () => {
    render(<NewBoardDialog workspaceId="ws1" collapsed />);
    // no + trigger rendered in collapsed mode
    expect(screen.queryByRole("button", { name: /new board/i })).toBeNull();
    useUIStore.setState({ newBoardOpen: true });
    await waitFor(() =>
      expect(
        screen.getByText(
          "Pick a template to start from, then name your board.",
        ),
      ).toBeInTheDocument(),
    );
  });

  it("renders the three-step import wizard from 'Import from file'", async () => {
    render(<NewBoardDialog workspaceId="ws1" />);
    fireEvent.click(screen.getByRole("button", { name: /new board/i }));
    fireEvent.click(screen.getByRole("button", { name: /import from file/i }));

    // The wizard's step indicator ("Select & map" / "Confirm") is unique to
    // ImportWizard — the retired v1 single-page dialog had no step indicator.
    await waitFor(() =>
      expect(screen.getByText("Select & map")).toBeInTheDocument(),
    );
    expect(screen.getByText("Confirm")).toBeInTheDocument();
  });
});
