import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FolderGallery } from "./FolderGallery";

describe("FolderGallery", () => {
  it("renders one card per folder with counts and a link to the command center", () => {
    render(
      <FolderGallery
        workspaceId="w1"
        rows={[
          {
            folderId: "f1",
            name: "Q4 Launch",
            position: 0,
            boards: 3,
            items: 26,
            done: 13,
            overdue: 1,
            attention: 4,
          },
          {
            folderId: "f2",
            name: "Empty",
            position: 1,
            boards: 0,
            items: 0,
            done: 0,
            overdue: 0,
            attention: 0,
          },
        ]}
      />,
    );
    expect(screen.getByRole("link", { name: /Q4 Launch/ })).toHaveAttribute(
      "href",
      "/folders/f1",
    );
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.getByText("1 overdue")).toBeInTheDocument();
    expect(screen.getByText("4 need attention")).toBeInTheDocument();
    expect(screen.getByText("No boards yet")).toBeInTheDocument();
  });
  it("shows the empty state when the workspace has no folders", () => {
    render(<FolderGallery workspaceId="w1" rows={[]} />);
    expect(screen.getByText(/No folders yet/)).toBeInTheDocument();
  });
});
