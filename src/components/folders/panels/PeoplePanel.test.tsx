import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkloadRow } from "@/lib/folders/types";

const getFolderWorkload = vi.fn();
vi.mock("@/lib/folders/actions", () => ({
  getFolderWorkload: (input: { folderId: string }) => getFolderWorkload(input),
}));
import { PeoplePanel } from "./PeoplePanel";

const members = [
  { userId: "u1", fullName: "Ada Lovelace", avatarUrl: null },
  { userId: "u2", fullName: "Grace Hopper", avatarUrl: null },
];
const row = (
  userId: string | null,
  open: number,
  overdue: number,
  stageKey = "build",
): WorkloadRow => ({
  userId,
  boardId: "b1",
  boardName: "Backend",
  stageKey,
  stageName: stageKey,
  open,
  overdue,
});

function renderPanel(props: Partial<Parameters<typeof PeoplePanel>[0]> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PeoplePanel
        kicker="05"
        folderId="f1"
        stage={null}
        members={members}
        {...props}
      />
    </QueryClientProvider>,
  );
}

describe("PeoplePanel", () => {
  beforeEach(() => getFolderWorkload.mockReset());

  it("loads workload once and lists people with open and late counts, unassigned last", async () => {
    getFolderWorkload.mockResolvedValue({
      ok: true,
      data: [row("u1", 9, 4), row("u2", 3, 0), row(null, 5, 2)],
    });
    renderPanel();
    await waitFor(() =>
      expect(screen.getByText("Ada Lovelace")).toBeInTheDocument(),
    );
    expect(getFolderWorkload).toHaveBeenCalledTimes(1);
    expect(getFolderWorkload).toHaveBeenCalledWith({ folderId: "f1" });
    expect(screen.getByText("4 late")).toBeInTheDocument();
    const names = screen
      .getAllByRole("listitem")
      .map((li) => li.textContent ?? "");
    expect(names[names.length - 1]).toContain("Unassigned");
  });

  it("narrows to the selected stage without another request", async () => {
    getFolderWorkload.mockResolvedValue({
      ok: true,
      data: [row("u1", 9, 4, "build"), row("u2", 3, 0, "qa")],
    });
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const ui = (stage: string | null) => (
      <QueryClientProvider client={qc}>
        <PeoplePanel
          kicker="05"
          folderId="f1"
          stage={stage}
          members={members}
        />
      </QueryClientProvider>
    );
    const { rerender } = render(ui(null));
    await waitFor(() =>
      expect(screen.getByText("Grace Hopper")).toBeInTheDocument(),
    );
    rerender(ui("build"));
    expect(screen.queryByText("Grace Hopper")).toBeNull();
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(getFolderWorkload).toHaveBeenCalledTimes(1);
  });

  it("shows at most eight people and offers the full list", async () => {
    const many = Array.from({ length: 11 }, (_, i) => row(`x${i}`, 20 - i, 0));
    getFolderWorkload.mockResolvedValue({ ok: true, data: many });
    const onSeeAll = vi.fn();
    renderPanel({ onSeeAll });
    await waitFor(() =>
      expect(screen.getAllByTestId("workload-bar")).toHaveLength(8),
    );
    fireEvent.click(screen.getByRole("button", { name: "See all 11" }));
    expect(onSeeAll).toHaveBeenCalledTimes(1);
  });

  it("reports a failed read in place", async () => {
    getFolderWorkload.mockResolvedValue({ ok: false, error: "nope" });
    renderPanel();
    await waitFor(() =>
      expect(screen.getByText(/Couldn't load workload/)).toBeInTheDocument(),
    );
  });
});
