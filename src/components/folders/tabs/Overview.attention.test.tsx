import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildStages } from "@/lib/folders/stages";
import { TooltipProvider } from "@/components/ui/tooltip";
import { canvasSections } from "@/lib/folders/layout";
import { FIXTURE_TODAY, folderFixture } from "@/lib/folders/fixture";
import { burnRowsOf } from "@/lib/folders/packed";
import type { AttentionRow } from "@/lib/folders/types";

vi.mock("@/components/folders/charts/BurnChart", () => ({
  BurnChart: () => <div data-testid="burn-chart" />,
}));
vi.mock("@/components/folders/panels/PeoplePanel", () => ({
  PeoplePanel: () => <div data-testid="people-panel" />,
}));
const getFolderAttention = vi.fn();
vi.mock("@/lib/folders/actions", () => ({
  getFolderAttention: (input: unknown) => getFolderAttention(input),
  getFolderKpiItems: vi.fn(),
}));
import { OverviewTab } from "./Overview";

// The bug this pins: the page used to take the folder's top 100 attention
// rows and THEN keep the ones in the selected board / stage, so on a folder
// with more than 100, matching rows past the cut were silently lost.

/** 100 rows, all on Backend / Build: the whole first-paint sample. */
const sample: AttentionRow[] = Array.from({ length: 100 }, (_, i) => ({
  itemId: `s${i}`,
  itemName: `Sample ${i}`,
  boardId: "b1",
  boardName: "Backend",
  groupId: "b1:build",
  groupName: "Build",
  reason: "overdue",
  ageDays: 400 - i,
  severity: 4,
}));

function renderOverview(
  patch: Partial<ReturnType<typeof folderFixture>>,
  stage: string | null = null,
) {
  const payload = { ...folderFixture(), ...patch };
  const rows = payload.rollup ?? [];
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <OverviewTab
          payload={payload}
          burn={burnRowsOf(payload.burnPacked)}
          rows={rows}
          stages={buildStages(rows, FIXTURE_TODAY)}
          stage={stage}
          board={null}
          sections={canvasSections(payload.layout.config, "overview")}
          onRetry={vi.fn()}
        />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return payload;
}

const group = (name: string) =>
  screen
    .getAllByTestId("attention-group")
    .find((g) => g.querySelector("button")!.textContent?.includes(name))!;

describe("Overview attention: filter in the query, not after the cut", () => {
  // Braces on purpose: a function RETURNED from beforeEach is run by vitest
  // as that test's cleanup, which would call the mock with no arguments.
  beforeEach(() => {
    getFolderAttention.mockReset();
  });

  it("a board with NO rows in the first 100 still gets its rows: they are read for that board, not looked up in the sample", async () => {
    getFolderAttention.mockResolvedValue({
      ok: true,
      data: {
        rows: [
          {
            itemId: "m1",
            itemName: "Beyond the cut",
            boardId: "b2",
            boardName: "Mobile app",
            groupId: "g",
            groupName: "Build",
            reason: "overdue",
            ageDays: 3,
            severity: 4,
          },
        ],
        total: 11,
      },
    });
    const payload = renderOverview({ attention: sample, attentionTotal: 240 });
    const other = payload.boards.find((b) => b.id !== "b1")!;
    const g = group(other.name);
    fireEvent.click(g.querySelector("button")!);
    await waitFor(() =>
      expect(
        screen.getByRole("link", { name: "Beyond the cut" }),
      ).toBeInTheDocument(),
    );
    expect(getFolderAttention).toHaveBeenCalledWith(
      expect.objectContaining({ boardId: other.id, stageKey: null }),
    );
    expect(screen.getByTestId("attention-count")).toHaveTextContent(
      "Showing 1 of 11.",
    );
    // The old path's give-up line is gone.
    expect(
      screen.queryByText(/None of this board's items are in the top/),
    ).toBeNull();
  });

  it("passes the selected stage into the query", async () => {
    getFolderAttention.mockResolvedValue({
      ok: true,
      data: { rows: [], total: 0 },
    });
    renderOverview({ attention: sample, attentionTotal: 240 }, "build");
    fireEvent.click(group("Backend").querySelector("button")!);
    await waitFor(() => expect(getFolderAttention).toHaveBeenCalled());
    expect(getFolderAttention).toHaveBeenCalledWith(
      expect.objectContaining({ boardId: "b1", stageKey: "build" }),
    );
  });

  it("an UNKNOWN total (old database, read cut at 100) is treated as incomplete too", async () => {
    getFolderAttention.mockResolvedValue({
      ok: true,
      data: { rows: [], total: null },
    });
    renderOverview({ attention: sample, attentionTotal: null });
    fireEvent.click(group("Backend").querySelector("button")!);
    await waitFor(() => expect(getFolderAttention).toHaveBeenCalledTimes(1));
  });

  it("when the sample IS the whole list, expanding and filtering cost no server call", () => {
    const fx = folderFixture();
    renderOverview({ attentionTotal: fx.attention!.length });
    fireEvent.click(group("Backend").querySelector("button")!);
    expect(
      screen.getByRole("link", { name: /Auth refactor/ }),
    ).toBeInTheDocument();
    expect(getFolderAttention).not.toHaveBeenCalled();
  });
});
