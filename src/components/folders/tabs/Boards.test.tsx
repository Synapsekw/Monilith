import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { buildStages } from "@/lib/folders/stages";
import { FIXTURE_TODAY, folderFixture } from "@/lib/folders/fixture";

vi.mock("@/lib/boards/actions/group", () => ({
  renameGroup: vi.fn(async () => ({ ok: true, data: undefined })),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
import { renameGroup } from "@/lib/boards/actions/group";
import { BoardsTab } from "./Boards";

describe("BoardsTab", () => {
  const fx = folderFixture();
  const stages = buildStages(fx.rollup!, FIXTURE_TODAY);
  it("lists every board with a health pill and sorts client-side", () => {
    render(<BoardsTab rows={fx.rollup!} boards={fx.boards} stages={stages} />);
    expect(screen.getAllByRole("row")).toHaveLength(4); // header + 3
    fireEvent.click(screen.getByRole("button", { name: "Sort by health" }));
    const names = screen.getAllByTestId("board-name").map((n) => n.textContent);
    expect(names[0]).toBe("Backend"); // at_risk (overdue) sorts before Mobile (on_track); ties A–Z
  });
  it("offers to merge a single-board stage into an existing stage via renameGroup", async () => {
    render(<BoardsTab rows={fx.rollup!} boards={fx.boards} stages={stages} />);
    expect(screen.getByText("Stages on only one board")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Merge Launch into a stage" }),
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "QA" }));
    expect(renameGroup).toHaveBeenCalledWith({
      groupId: "b3:launch",
      name: "QA",
    });
  });
});
