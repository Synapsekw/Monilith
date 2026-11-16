import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FIXTURE_TODAY, folderFixture } from "@/lib/folders/fixture";
import { attentionGroups } from "@/lib/folders/tower";
import type { AttentionRow } from "@/lib/folders/types";

const getFolderAttention = vi.fn();
vi.mock("@/lib/folders/actions", () => ({
  getFolderAttention: (input: unknown) => getFolderAttention(input),
}));
import { ATTENTION_PAGE, AttentionPanel } from "./AttentionPanel";

// The first-paint sample is NOT the whole list here (a folder with more than
// 100 attention rows): the groups carry counts only, and a board's rows are
// read when it is expanded, with the filter in the query.
const fx = folderFixture();
const groups = attentionGroups(fx.rollup!, [], FIXTURE_TODAY);

const row = (i: number): AttentionRow => ({
  itemId: `r${i}`,
  itemName: `Remote ${i}`,
  boardId: "b1",
  boardName: "Backend",
  groupId: "g",
  groupName: "Build",
  reason: "overdue",
  ageDays: 300 - i,
  severity: 4,
});

function renderPanel(stage: string | null = null) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <AttentionPanel
        kicker="06"
        attention={[]}
        caption={null}
        groups={groups}
        remote={{ folderId: "f1", stage }}
        onRetry={vi.fn()}
      />
    </QueryClientProvider>,
  );
  const backend = screen
    .getAllByTestId("attention-group")
    .find((g) =>
      within(g).getAllByRole("button")[0]!.textContent?.includes("Backend"),
    )!;
  return { backend, toggle: within(backend).getAllByRole("button")[0]! };
}

describe("AttentionPanel, rows read on demand", () => {
  // Braces on purpose: a function RETURNED from beforeEach is run by vitest
  // as that test's cleanup, which would call the mock with no arguments.
  beforeEach(() => {
    getFolderAttention.mockReset();
  });

  it("still lists every board with its counts, and reads nothing until one is expanded", () => {
    renderPanel();
    expect(screen.getAllByTestId("attention-group").length).toBe(groups.length);
    expect(groups.length).toBeGreaterThan(0);
    expect(getFolderAttention).not.toHaveBeenCalled();
  });

  it("expanding a board asks for THAT board and the page's stage, limit applied to matching rows", async () => {
    getFolderAttention.mockResolvedValue({
      ok: true,
      data: {
        rows: Array.from({ length: ATTENTION_PAGE }, (_, i) => row(i)),
        total: 143,
      },
    });
    const { backend, toggle } = renderPanel("build");
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(within(backend).getByTestId("attention-count")).toHaveTextContent(
        "Showing 20 of 143.",
      ),
    );
    expect(getFolderAttention).toHaveBeenCalledTimes(1);
    expect(getFolderAttention).toHaveBeenCalledWith({
      folderId: "f1",
      boardId: groups.find((g) => g.boardName === "Backend")!.boardId,
      stageKey: "build",
      limit: ATTENTION_PAGE,
      offset: 0,
    });
    expect(
      within(backend).getByRole("link", { name: "Remote 0" }),
    ).toHaveAttribute("href", "/boards/b1?item=r0");
  });

  it("Show more reads the next page from where the list ends", async () => {
    getFolderAttention.mockImplementation(async (q: { offset: number }) => ({
      ok: true,
      data: {
        rows: Array.from({ length: q.offset === 0 ? 20 : 5 }, (_, i) =>
          row(q.offset + i),
        ),
        total: 25,
      },
    }));
    const { backend, toggle } = renderPanel();
    fireEvent.click(toggle);
    await waitFor(() => within(backend).getByTestId("attention-count"));
    fireEvent.click(
      within(backend).getByRole("button", { name: "Show 5 more" }),
    );
    await waitFor(() =>
      expect(within(backend).getByTestId("attention-count")).toHaveTextContent(
        "Showing 25 of 25.",
      ),
    );
    expect(getFolderAttention.mock.calls[1]![0]).toMatchObject({ offset: 20 });
    expect(within(backend).queryByRole("button", { name: /more$/ })).toBeNull();
  });

  it("with an unknown total (a database that cannot filter in the query yet) it says the list is from the top 100, not complete", async () => {
    getFolderAttention.mockResolvedValue({
      ok: true,
      data: { rows: [row(1), row(2)], total: null },
    });
    const { backend, toggle } = renderPanel();
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(within(backend).getByTestId("attention-count")).toHaveTextContent(
        "Showing 2 from the folder's 100 most urgent items; this board may have more.",
      ),
    );
    expect(
      within(backend).getByRole("link", { name: "Open the board for all." }),
    ).toBeInTheDocument();
  });

  it("shows the reason and a Retry when the read fails", async () => {
    getFolderAttention.mockResolvedValueOnce({ ok: false, error: "nope" });
    getFolderAttention.mockResolvedValueOnce({
      ok: true,
      data: { rows: [row(1)], total: 1 },
    });
    const { backend, toggle } = renderPanel();
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(
        within(backend).getByText(/Couldn't load this board's items. nope/),
      ).toBeInTheDocument(),
    );
    fireEvent.click(within(backend).getByRole("button", { name: "Retry" }));
    await waitFor(() =>
      expect(
        within(backend).getByRole("link", { name: "Remote 1" }),
      ).toBeInTheDocument(),
    );
  });
});
