import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

let coarse = false;
vi.mock("@/lib/hooks/use-coarse-pointer", () => ({
  useCoarsePointer: () => coarse,
}));

import {
  NAME_PEEK_DELAY_MS,
  NameCell,
} from "@/components/boards/table/NameCell";
import { NAME_FREEZE_RULE } from "@/components/boards/SummaryRow";
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
  it("renders the name at the item-name table scale", () => {
    render(<NameCell item={item} controls={controls} />);
    expect(screen.getByLabelText(`${item.name} name`).className).toContain(
      "text-item",
    );
  });

  it("steps subitem names down to the 13px/400 cell scale when indented", () => {
    // Blocker 3: a parent and its children must not be typographically
    // identical — indented (subitem) rows drop to `text-cell` at normal
    // weight, unlike the item scale above.
    render(<NameCell item={item} controls={controls} indented />);
    const name = screen.getByLabelText(`${item.name} name`);
    expect(name.className).toContain("text-cell");
    expect(name.className).not.toContain("text-item");
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

  it("carries the permanent Name-column right-edge hairline in the non-editing wrapper", () => {
    const { container } = render(<NameCell item={item} controls={controls} />);
    const cell = container.firstElementChild as HTMLElement;
    for (const cls of NAME_FREEZE_RULE.split(" ")) {
      expect(cell.className).toContain(cls);
    }
  });

  it("carries the permanent Name-column right-edge hairline in the editing wrapper too", () => {
    const { container } = render(
      <NameCell item={item} controls={controls} autoFocusRename />,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    // autoFocusRename opens straight into the editing branch — a different
    // element than the non-editing wrapper above.
    expect(wrapper.querySelector("input")).toBeInTheDocument();
    for (const cls of NAME_FREEZE_RULE.split(" ")) {
      expect(wrapper.className).toContain(cls);
    }
  });
});

/** jsdom lays nothing out, so truncation is simulated on the text node. */
function setTruncated(el: HTMLElement, truncated: boolean) {
  Object.defineProperty(el, "scrollWidth", {
    configurable: true,
    value: truncated ? 500 : 100,
  });
  Object.defineProperty(el, "clientWidth", {
    configurable: true,
    value: 100,
  });
}

describe("NameCell — hover buttons overlay", () => {
  beforeEach(() => {
    coarse = false;
  });

  it("takes the buttons out of the layout flow on fine pointers and keeps them in flow on coarse", () => {
    render(<NameCell item={item} controls={controls} />);
    const actions = screen.getByTestId("name-actions");
    const classes = actions.className.split(/\s+/);
    expect(classes).toContain("absolute");
    expect(classes).toContain("pointer-coarse:static");
    expect(classes).toContain("pointer-coarse:opacity-100");
    expect(actions).toContainElement(
      screen.getByRole("button", { name: `Open ${item.name}` }),
    );
  });

  it("puts the trailing row controls in the same overlay", () => {
    render(
      <NameCell
        item={item}
        controls={controls}
        trailing={<button type="button">Row menu</button>}
      />,
    );
    expect(screen.getByTestId("name-actions")).toContainElement(
      screen.getByRole("button", { name: "Row menu" }),
    );
  });

  it("reveals the overlay on row hover and on keyboard focus within", () => {
    render(<NameCell item={item} controls={controls} />);
    const classes = screen.getByTestId("name-actions").className.split(/\s+/);
    expect(classes).toContain("group-hover/name:opacity-100");
    expect(classes).toContain("focus-within:opacity-100");
  });

  it("carries the full name as the name button's title", () => {
    render(<NameCell item={item} controls={controls} />);
    expect(screen.getByLabelText(`${item.name} name`)).toHaveAttribute(
      "title",
      item.name,
    );
  });
});

describe("NameCell — hover peek", () => {
  beforeEach(() => {
    coarse = false;
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("unrolls a truncated name after the pointer rests on the row for 200ms", () => {
    const { container } = render(<NameCell item={item} controls={controls} />);
    const cell = container.firstElementChild as HTMLElement;
    setTruncated(screen.getByText(item.name), true);

    fireEvent.mouseEnter(cell);
    expect(cell).not.toHaveAttribute("data-peek");
    act(() => {
      vi.advanceTimersByTime(NAME_PEEK_DELAY_MS - 1);
    });
    expect(cell).not.toHaveAttribute("data-peek");
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(cell).toHaveAttribute("data-peek", "true");

    fireEvent.mouseLeave(cell);
    expect(cell).not.toHaveAttribute("data-peek");
  });

  it("puts the buttons back in flow at the end of the unrolled name", () => {
    const { container } = render(<NameCell item={item} controls={controls} />);
    const cell = container.firstElementChild as HTMLElement;
    setTruncated(screen.getByText(item.name), true);
    fireEvent.mouseEnter(cell);
    act(() => {
      vi.advanceTimersByTime(NAME_PEEK_DELAY_MS);
    });
    const classes = screen.getByTestId("name-actions").className.split(/\s+/);
    expect(classes).toContain("static");
    expect(classes).not.toContain("absolute");
  });

  it("does not peek a name that fits", () => {
    const { container } = render(<NameCell item={item} controls={controls} />);
    const cell = container.firstElementChild as HTMLElement;
    setTruncated(screen.getByText(item.name), false);
    fireEvent.mouseEnter(cell);
    act(() => {
      vi.advanceTimersByTime(NAME_PEEK_DELAY_MS * 2);
    });
    expect(cell).not.toHaveAttribute("data-peek");
  });

  it("cancels a pending peek when the pointer leaves before 200ms", () => {
    const { container } = render(<NameCell item={item} controls={controls} />);
    const cell = container.firstElementChild as HTMLElement;
    setTruncated(screen.getByText(item.name), true);
    fireEvent.mouseEnter(cell);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    fireEvent.mouseLeave(cell);
    act(() => {
      vi.advanceTimersByTime(NAME_PEEK_DELAY_MS);
    });
    expect(cell).not.toHaveAttribute("data-peek");
  });

  it("does not peek on a coarse pointer", () => {
    coarse = true;
    const { container } = render(<NameCell item={item} controls={controls} />);
    const cell = container.firstElementChild as HTMLElement;
    setTruncated(screen.getByText(item.name), true);
    fireEvent.mouseEnter(cell);
    act(() => {
      vi.advanceTimersByTime(NAME_PEEK_DELAY_MS);
    });
    expect(cell).not.toHaveAttribute("data-peek");
  });

  it("does not peek while the row is being dragged", () => {
    const { container } = render(
      <NameCell item={item} controls={controls} peekDisabled />,
    );
    const cell = container.firstElementChild as HTMLElement;
    setTruncated(screen.getByText(item.name), true);
    fireEvent.mouseEnter(cell);
    act(() => {
      vi.advanceTimersByTime(NAME_PEEK_DELAY_MS);
    });
    expect(cell).not.toHaveAttribute("data-peek");
  });

  it("peeks at once on keyboard focus of a truncated name, and closes on blur", () => {
    const { container } = render(<NameCell item={item} controls={controls} />);
    const cell = container.firstElementChild as HTMLElement;
    setTruncated(screen.getByText(item.name), true);
    const nameButton = screen.getByLabelText(`${item.name} name`);
    fireEvent.focus(nameButton);
    expect(cell).toHaveAttribute("data-peek", "true");
    fireEvent.blur(nameButton);
    expect(cell).not.toHaveAttribute("data-peek");
  });

  it("is not there while the name is being edited", () => {
    const { container } = render(<NameCell item={item} controls={controls} />);
    setTruncated(screen.getByText(item.name), true);
    fireEvent.mouseEnter(container.firstElementChild as HTMLElement);
    act(() => {
      vi.advanceTimersByTime(NAME_PEEK_DELAY_MS);
    });
    fireEvent.click(screen.getByLabelText(`${item.name} name`));
    const editing = container.firstElementChild as HTMLElement;
    expect(editing.querySelector("input")).toBeInTheDocument();
    expect(editing).not.toHaveAttribute("data-peek");
  });
});
