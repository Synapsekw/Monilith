import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NameCell } from "@/components/boards/table/NameCell";
import type { Item } from "@/lib/boards/queries";
import type { CellControls } from "@/components/boards/table/shared";

const item = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Draft the Q4 positioning brief",
  group_id: "g1",
  created_by: "u1",
  created_at: "2026-09-01T00:00:00Z",
} as Item;

const controls = {
  renameItemInCache: vi.fn(),
  members: [],
} as unknown as CellControls;

describe("NameCell — Quiet Grid", () => {
  it("renders the name at the 13.5px table scale", () => {
    render(<NameCell item={item} controls={controls} />);
    expect(screen.getByLabelText(`${item.name} name`).className).toContain(
      "text-item",
    );
  });

  it("wipes in a hover seam when not selected", () => {
    const { container } = render(<NameCell item={item} controls={controls} />);
    const cell = container.firstElementChild as HTMLElement;
    expect(cell.className).toContain("after:bg-primary");
    expect(cell.className).toContain("group-hover/name:after:scale-y-100");
  });

  it("suppresses the hover seam while the row is selected", () => {
    const { container } = render(
      <NameCell item={item} controls={controls} selected />,
    );
    const cell = container.firstElementChild as HTMLElement;
    expect(cell.className).toContain("before:bg-primary"); // the 3px selected bar
    expect(cell.className).toContain("after:hidden"); // seam yields to it
  });
});
