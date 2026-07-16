import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BoardToolbar } from "@/components/boards/BoardToolbar";
import type { CacheColumn } from "@/lib/boards/cache";
import type { HeaderMember } from "@/components/boards/BoardHeader";

// Mutable search-param string the mocked useSearchParams reads from.
let searchParamsString = "";
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(searchParamsString),
}));

const col = (over: Partial<CacheColumn>): CacheColumn =>
  ({
    id: "c1",
    board_id: "b1",
    org_id: "o1",
    name: "Column",
    kind: "text",
    position: 0,
    width: null,
    settings: {},
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
    ...over,
  }) as CacheColumn;

const statusColumn = col({
  id: "c-status",
  name: "Status",
  kind: "status",
  settings: {
    options: [
      { id: "opt-todo", label: "Todo", color: "#888" },
      { id: "opt-done", label: "Done", color: "#0a0" },
    ],
  },
});
const peopleColumn = col({ id: "c-people", name: "Owner", kind: "people" });

const members: HeaderMember[] = [
  { userId: "me", fullName: "Ada Lovelace", email: "ada@x.com" },
  { userId: "u2", fullName: "Alan Turing", email: "alan@x.com" },
];

function lastHistoryUrl(spy: ReturnType<typeof vi.spyOn>): URLSearchParams {
  const call = spy.mock.calls.at(-1);
  const url = new URL(String(call?.[2]));
  return url.searchParams;
}

beforeEach(() => {
  searchParamsString = "";
  window.history.replaceState(null, "", "/boards/b1?view=v1");
});
afterEach(() => vi.restoreAllMocks());

describe("BoardToolbar", () => {
  it("mirrors the quick search into the URL via a debounced replaceState (0 round-trips)", async () => {
    const replaceState = vi.spyOn(window.history, "replaceState");
    render(
      <BoardToolbar
        columns={[statusColumn]}
        members={members}
        currentUserId="me"
      />,
    );
    const field = screen.getByLabelText("Search items") as HTMLInputElement;
    await userEvent.type(field, "x");
    // The field reflects the keystroke immediately (local draft — never lags)…
    expect(field.value).toBe("x");
    // …while the URL write is debounced ~200ms (still History API, 0 round-trips).
    await waitFor(() =>
      expect(lastHistoryUrl(replaceState).get("q")).toBe("x"),
    );
  });

  it("preserves the existing view param when writing filter state", async () => {
    const pushState = vi.spyOn(window.history, "pushState");
    render(
      <BoardToolbar
        columns={[statusColumn]}
        members={members}
        currentUserId="me"
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /^Filter$/ }));
    await userEvent.click(screen.getByRole("option", { name: /Done/ }));
    const params = lastHistoryUrl(pushState);
    expect(params.get("status")).toBe("opt-done");
    expect(params.get("view")).toBe("v1"); // untouched
  });

  it('offers a "My items" toggle that filters by the current user', async () => {
    const pushState = vi.spyOn(window.history, "pushState");
    render(
      <BoardToolbar
        columns={[peopleColumn]}
        members={members}
        currentUserId="me"
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /^Filter$/ }));
    await userEvent.click(screen.getByRole("option", { name: /My items/ }));
    expect(lastHistoryUrl(pushState).get("people")).toBe("me");
  });

  it("sets a sort via the History API", async () => {
    const pushState = vi.spyOn(window.history, "pushState");
    render(
      <BoardToolbar
        columns={[statusColumn]}
        members={members}
        currentUserId="me"
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /^Sort$/ }));
    await userEvent.click(screen.getByRole("option", { name: "Name" }));
    expect(lastHistoryUrl(pushState).get("sort")).toBe("name:asc");
  });

  it("shows the active-facet count on the Filter button", () => {
    searchParamsString = "status=opt-done,opt-todo";
    render(
      <BoardToolbar
        columns={[statusColumn]}
        members={members}
        currentUserId="me"
      />,
    );
    expect(
      screen.getByRole("button", { name: "Filter (2 active)" }),
    ).toBeInTheDocument();
  });

  it('shows "Clear all" only when a filter is active, and clears every param', async () => {
    searchParamsString = "q=hello";
    const pushState = vi.spyOn(window.history, "pushState");
    render(
      <BoardToolbar
        columns={[statusColumn]}
        members={members}
        currentUserId="me"
      />,
    );
    const clear = screen.getByRole("button", { name: /Clear all/ });
    await userEvent.click(clear);
    const params = lastHistoryUrl(pushState);
    expect(params.get("q")).toBeNull();
    expect(params.get("view")).toBe("v1");
  });

  it("hides Clear all when no filter is active", () => {
    searchParamsString = "";
    render(
      <BoardToolbar
        columns={[statusColumn]}
        members={members}
        currentUserId="me"
      />,
    );
    expect(
      screen.queryByRole("button", { name: /Clear all/ }),
    ).not.toBeInTheDocument();
  });
});
