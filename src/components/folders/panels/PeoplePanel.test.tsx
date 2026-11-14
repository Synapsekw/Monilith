import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

  it("retries a failed read and renders the data", async () => {
    getFolderWorkload.mockResolvedValueOnce({ ok: false, error: "nope" });
    getFolderWorkload.mockResolvedValueOnce({
      ok: true,
      data: [row("u1", 9, 4)],
    });
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Ada Lovelace")).toBeInTheDocument();
    expect(getFolderWorkload).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/Couldn't load workload/)).toBeNull();
  });

  it("says so when there is no workload at all", async () => {
    getFolderWorkload.mockResolvedValue({ ok: true, data: [] });
    renderPanel();
    expect(
      await screen.findByText("No open items are assigned in this stage."),
    ).toBeInTheDocument();
    expect(screen.queryAllByTestId("workload-bar")).toHaveLength(0);
  });

  it("shows only Unassigned when nobody is assigned", async () => {
    getFolderWorkload.mockResolvedValue({
      ok: true,
      data: [row(null, 5, 2)],
    });
    renderPanel();
    expect(await screen.findByText("Unassigned")).toBeInTheDocument();
    expect(screen.getAllByTestId("workload-bar")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /See all/ })).toBeNull();
  });

  it("draws no Unassigned bar when its open count is zero", async () => {
    getFolderWorkload.mockResolvedValue({
      ok: true,
      data: [row("u1", 9, 4), row(null, 0, 0)],
    });
    renderPanel();
    expect(await screen.findByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.queryByText("Unassigned")).toBeNull();
    expect(screen.getAllByTestId("workload-bar")).toHaveLength(1);
  });

  it("hides See all when onSeeAll is omitted", async () => {
    const many = Array.from({ length: 11 }, (_, i) => row(`x${i}`, 20 - i, 0));
    getFolderWorkload.mockResolvedValue({ ok: true, data: many });
    renderPanel();
    await waitFor(() =>
      expect(screen.getAllByTestId("workload-bar")).toHaveLength(8),
    );
    expect(screen.queryByRole("button", { name: /See all/ })).toBeNull();
  });

  it("shows eight people plus Unassigned when there are eleven people", async () => {
    const many = Array.from({ length: 11 }, (_, i) => row(`x${i}`, 20 - i, 0));
    getFolderWorkload.mockResolvedValue({
      ok: true,
      data: [...many, row(null, 4, 1)],
    });
    renderPanel({ onSeeAll: vi.fn() });
    await waitFor(() =>
      expect(screen.getAllByTestId("workload-bar")).toHaveLength(9),
    );
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "See all 11" }),
    ).toBeInTheDocument();
  });
});

describe("PeoplePanel near-viewport loading", () => {
  type Cb = (entries: { isIntersecting: boolean }[]) => void;
  const instances: FakeIO[] = [];
  class FakeIO {
    observe = vi.fn();
    disconnect = vi.fn();
    constructor(public cb: Cb) {
      instances.push(this);
    }
    fire(isIntersecting: boolean) {
      this.cb([{ isIntersecting }]);
    }
  }

  beforeEach(() => {
    getFolderWorkload.mockReset();
    instances.length = 0;
    vi.stubGlobal("IntersectionObserver", FakeIO);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("fetches nothing until the section nears the viewport, then once", async () => {
    getFolderWorkload.mockResolvedValue({
      ok: true,
      data: [row("u1", 9, 4)],
    });
    renderPanel();
    expect(instances).toHaveLength(1);
    expect(instances[0]!.observe).toHaveBeenCalledTimes(1);
    expect(getFolderWorkload).toHaveBeenCalledTimes(0);
    expect(screen.getByTestId("people-skeleton")).toBeInTheDocument();

    act(() => instances[0]!.fire(false));
    expect(getFolderWorkload).toHaveBeenCalledTimes(0);

    act(() => instances[0]!.fire(true));
    expect(await screen.findByText("Ada Lovelace")).toBeInTheDocument();
    expect(getFolderWorkload).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("people-skeleton")).toBeNull();
    // Once near, the observer is released.
    expect(instances[0]!.disconnect).toHaveBeenCalled();
  });

  it("disconnects the observer on unmount", () => {
    const { unmount } = renderPanel();
    expect(instances[0]!.disconnect).not.toHaveBeenCalled();
    unmount();
    expect(instances[0]!.disconnect).toHaveBeenCalledTimes(1);
    expect(getFolderWorkload).toHaveBeenCalledTimes(0);
  });
});
