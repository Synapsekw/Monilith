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
    // Plain `hover:`, not `group-hover/name:` — the seam's `after:` belongs to
    // this same `group/name` element, and Tailwind compiles `group-hover:` to
    // a selector requiring the styled node to be a DESCENDANT of the hovered
    // `.group/name`, which this node can never be of itself. That rule was
    // therefore dead on every row — confirmed by reading the compiled CSS
    // in Chromium and by direct-pixel screenshots (see task-5-report.md).
    expect(cell.className).toContain("hover:after:scale-y-100");
    expect(cell.className).not.toContain("group-hover/name:after:scale-y-100");
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
