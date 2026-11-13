import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Column, Item } from "@/lib/boards/queries";
import type { CacheColumn } from "@/lib/boards/cache";
import { EditableCell } from "./EditableCell";
import { useEditingCell } from "./editing-store";
import type { CellControls } from "./shared";

/**
 * Spec 4.7 wiring. The celebration is triggered ONLY from the status cell's
 * commit handler — the current user's own edit — and "done" is the Command
 * Center's rule (@/lib/boards/overdue): the board's FIRST status column
 * holding an option labelled done/complete.
 */
const celebrateStatusEdit = vi.fn();
vi.mock("@/components/ui/done-burst", () => ({
  celebrateStatusEdit: (...args: unknown[]) => celebrateStatusEdit(...args),
}));

const ITEM_ID = "22222222-2222-4222-8222-222222222222";
const OPTIONS = [
  { id: "todo", label: "To do", color: "#c4c4c4" },
  { id: "wip", label: "Working on it", color: "#fdab3d" },
  { id: "done", label: "Done", color: "#00c875" },
  { id: "complete", label: "Completed", color: "#00a35c" },
];

const item: Item = {
  id: ITEM_ID,
  org_id: "o1",
  board_id: "b1",
  group_id: "g1",
  parent_id: null,
  name: "Ship it",
  position: 1,
  created_by: "",
  created_at: "2026-09-09T00:00:00Z",
  updated_at: "2026-09-09T00:00:00Z",
  archived_at: null,
  archived_by: null,
};

function statusColumn(id: string, position: number): Column {
  return {
    id,
    board_id: "b1",
    name: "Status",
    kind: "status",
    position,
    settings: { options: OPTIONS },
    width: null,
  } as unknown as Column;
}

const FIRST = statusColumn("c1", 1);
const SECOND = statusColumn("c2", 2);

function controls(over: Partial<CellControls> = {}): CellControls {
  return {
    setEditing: useEditingCell.getState().setEditing,
    setCell: vi.fn(),
    clearCellValue: vi.fn(),
    members: [],
    statusColumn: FIRST as unknown as CacheColumn,
    ...over,
  } as unknown as CellControls;
}

function mount(
  column: Column,
  value: { optionId: string } | null,
  over: Partial<CellControls> = {},
) {
  const c = controls(over);
  const view = render(
    <EditableCell item={item} column={column} value={value} controls={c} />,
  );
  return { ...view, controls: c };
}

function open(columnId: string) {
  act(() =>
    useEditingCell.getState().setEditing({ itemId: ITEM_ID, columnId }),
  );
}

async function pick(label: RegExp) {
  await userEvent.click(screen.getByRole("option", { name: label }));
}

/** What the commit handler reported: did this edit complete the item? */
function becameDone(): boolean {
  expect(celebrateStatusEdit).toHaveBeenCalledTimes(1);
  return celebrateStatusEdit.mock.calls[0][1] as boolean;
}

beforeEach(() => {
  celebrateStatusEdit.mockClear();
  act(() => useEditingCell.getState().setEditing(null));
});

describe("status cell celebration", () => {
  it("bursts when the user's edit moves the item from not-done to done", async () => {
    mount(FIRST, { optionId: "wip" });
    open("c1");
    await pick(/^done$/i);
    expect(becameDone()).toBe(true);
  });

  it("bursts from an empty status straight to done", async () => {
    mount(FIRST, null);
    open("c1");
    await pick(/^done$/i);
    expect(becameDone()).toBe(true);
  });

  it("only pops for a change between two not-done options", async () => {
    mount(FIRST, { optionId: "todo" });
    open("c1");
    await pick(/working on it/i);
    expect(becameDone()).toBe(false);
  });

  it("only pops when a done item moves to another done option", async () => {
    mount(FIRST, { optionId: "done" });
    open("c1");
    await pick(/completed/i);
    expect(becameDone()).toBe(false);
  });

  it("only pops when a done item is reopened", async () => {
    mount(FIRST, { optionId: "done" });
    open("c1");
    await pick(/to do/i);
    expect(becameDone()).toBe(false);
  });

  it("only pops in a second status column — it does not complete the item", async () => {
    mount(SECOND, { optionId: "wip" });
    open("c2");
    await pick(/^done$/i);
    expect(becameDone()).toBe(false);
  });

  it("only pops when the board's status column is unknown", async () => {
    mount(FIRST, { optionId: "wip" }, { statusColumn: null });
    open("c1");
    await pick(/^done$/i);
    expect(becameDone()).toBe(false);
  });

  it("does nothing when the option the cell already holds is re-picked", async () => {
    mount(FIRST, { optionId: "done" });
    open("c1");
    await pick(/^done$/i);
    expect(celebrateStatusEdit).not.toHaveBeenCalled();
  });

  it("hands over the cell's own element, resolved lazily", async () => {
    const { container } = mount(FIRST, { optionId: "wip" });
    open("c1");
    await pick(/^done$/i);
    const getCell = celebrateStatusEdit.mock.calls[0][0] as () => HTMLElement;
    expect(getCell()).toBe(container.firstElementChild);
  });

  it("does not celebrate a value that arrives from outside (realtime, re-mount)", () => {
    // Another user's edit reaches the cell as a new `value` prop; a row
    // scrolling back into the virtualized window is a fresh mount.
    const {
      rerender,
      unmount,
      controls: c,
    } = mount(FIRST, {
      optionId: "wip",
    });
    rerender(
      <EditableCell
        item={item}
        column={FIRST}
        value={{ optionId: "done" }}
        controls={c}
      />,
    );
    unmount();
    mount(FIRST, { optionId: "done" });
    expect(celebrateStatusEdit).not.toHaveBeenCalled();
  });

  it("does not celebrate a non-status column", async () => {
    const dropdown = {
      ...FIRST,
      kind: "dropdown",
      settings: { options: OPTIONS, allow_multiple: false },
    } as unknown as Column;
    mount(dropdown, null);
    open("c1");
    await pick(/^done$/i);
    expect(celebrateStatusEdit).not.toHaveBeenCalled();
  });

  it("marks the resting pill so the pop can find it", () => {
    const { container } = mount(FIRST, { optionId: "done" });
    const pill = container.querySelector("[data-status-pill]");
    expect(pill).toHaveTextContent("Done");
  });
});
