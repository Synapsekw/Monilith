import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ItemBacklinks } from "@/lib/boards/item-backlinks";
import type { ActionResult } from "@/lib/actions/result";

const listItemBacklinks = vi.hoisted(() =>
  vi.fn<(itemId: string) => Promise<ActionResult<ItemBacklinks>>>(),
);
vi.mock("@/lib/boards/item-backlinks", () => ({ listItemBacklinks }));

import { LinkedFromSection } from "./LinkedFromSection";

const ITEM = "11111111-1111-4111-8111-111111111111";
const BOARD = "b0b0b0b0-0000-4000-8000-000000000000";
const OTHER = "b9b9b9b9-0000-4000-8000-000000000000";

const foreign = {
  linkId: "l1",
  itemId: "i-foreign",
  itemName: "Launch plan",
  boardId: OTHER,
  boardName: "Marketing",
  columnName: "Milestone",
};
const local = {
  linkId: "l2",
  itemId: "i-local",
  itemName: "Write brief",
  boardId: BOARD,
  boardName: "Platform",
  columnName: "Parent task",
};

function renderSection() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <LinkedFromSection itemId={ITEM} boardId={BOARD} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  listItemBacklinks.mockReset();
  window.history.replaceState({}, "", "/boards/x");
});

describe("LinkedFromSection", () => {
  it("asks once, for the open item, when it mounts", async () => {
    listItemBacklinks.mockResolvedValue({
      ok: true,
      data: { links: [], hasMore: false },
    });
    renderSection();
    expect(
      await screen.findByText("No items link to this one yet."),
    ).toBeInTheDocument();
    expect(listItemBacklinks).toHaveBeenCalledTimes(1);
    expect(listItemBacklinks).toHaveBeenCalledWith(ITEM);
  });

  it("names each linking item, its board and the relation column", async () => {
    listItemBacklinks.mockResolvedValue({
      ok: true,
      data: { links: [foreign], hasMore: false },
    });
    renderSection();
    const row = await screen.findByRole("link", {
      name: "Open Launch plan on Marketing",
    });
    expect(within(row).getByText("Launch plan")).toBeInTheDocument();
    expect(within(row).getByText("Marketing")).toBeInTheDocument();
    expect(within(row).getByText("Milestone")).toBeInTheDocument();
  });

  it("links an item on another board to that board with the item open", async () => {
    listItemBacklinks.mockResolvedValue({
      ok: true,
      data: { links: [foreign], hasMore: false },
    });
    renderSection();
    const row = await screen.findByRole("link", { name: /Launch plan/ });
    expect(row).toHaveAttribute("href", `/boards/${OTHER}?item=i-foreign`);
  });

  it("opens an item on this board in place through the History API", async () => {
    listItemBacklinks.mockResolvedValue({
      ok: true,
      data: { links: [local], hasMore: false },
    });
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByRole("link", { name: /Write brief/ }));
    expect(new URL(window.location.href).searchParams.get("item")).toBe(
      "i-local",
    );
    expect(window.location.pathname).toBe("/boards/x");
  });

  it("says when only the first page is shown", async () => {
    listItemBacklinks.mockResolvedValue({
      ok: true,
      data: { links: [foreign, local], hasMore: true },
    });
    renderSection();
    expect(
      await screen.findByText("Showing the 2 most recent links."),
    ).toBeInTheDocument();
  });

  it("explains a failed load and retries on request", async () => {
    listItemBacklinks.mockResolvedValueOnce({ ok: false, error: "nope" });
    listItemBacklinks.mockResolvedValueOnce({
      ok: true,
      data: { links: [foreign], hasMore: false },
    });
    const user = userEvent.setup();
    renderSection();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not load linked items.",
    );
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(
      await screen.findByRole("link", { name: /Launch plan/ }),
    ).toBeInTheDocument();
  });
});
