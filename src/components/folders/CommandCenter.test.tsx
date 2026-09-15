import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { folderFixture } from "@/lib/folders/fixture";

const params = { current: new URLSearchParams("") };
const routerPush = vi.fn();
const routerRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useSearchParams: () => params.current,
  useRouter: () => ({
    push: routerPush,
    refresh: routerRefresh,
    replace: vi.fn(),
  }),
}));
vi.mock("@/lib/folders/actions", () => ({
  getFolderWorkload: vi.fn(async () => ({ ok: true, data: [] })),
}));
// The lazy burn chart never resolves in jsdom; the shell must not depend on it.
vi.mock("@/components/folders/charts/BurnChart", () => ({
  BurnChart: () => <div data-testid="burn-chart" />,
}));

import { getFolderWorkload } from "@/lib/folders/actions";
import { CommandCenter, type CommandCenterProps } from "./CommandCenter";

function wrap(props: CommandCenterProps) {
  const qc = new QueryClient();
  return (
    <QueryClientProvider client={qc}>
      <CommandCenter {...props} />
    </QueryClientProvider>
  );
}

describe("CommandCenter", () => {
  beforeEach(() => {
    params.current = new URLSearchParams("");
    window.history.replaceState({}, "", "/folders/f1");
    vi.mocked(getFolderWorkload).mockClear();
    routerPush.mockClear();
    routerRefresh.mockClear();
  });

  it("renders the header, snapshot chip, tab strip and filter bar from the payload", () => {
    render(wrap({ payload: folderFixture() }));
    expect(
      screen.getByRole("heading", { name: "Q4 Launch" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Snapshot/)).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Stages 4/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Boards 3/ })).toBeInTheDocument();
    expect(screen.getByText("26 items · 3 boards")).toBeInTheDocument();
  });

  it("switching tab and stage costs zero server calls and only touches history.replaceState", () => {
    const replace = vi.spyOn(window.history, "replaceState");
    render(wrap({ payload: folderFixture() }));
    fireEvent.click(screen.getByRole("tab", { name: /Stages/ }));
    fireEvent.click(screen.getByRole("button", { name: "Build" }));
    fireEvent.click(screen.getByRole("tab", { name: /Boards/ }));
    expect(replace).toHaveBeenCalledTimes(3);
    expect(getFolderWorkload).not.toHaveBeenCalled();
    expect(routerPush).not.toHaveBeenCalled();
    expect(routerRefresh).not.toHaveBeenCalled();
  });

  it("filtering to one stage recomputes the KPI values from the payload", () => {
    params.current = new URLSearchParams("stage=qa");
    render(wrap({ payload: folderFixture() }));
    // QA: 2 done of 3 total across b1/b2 → 67%
    expect(screen.getByText("67%")).toBeInTheDocument();
    expect(screen.getByText("3 items · 3 boards · QA")).toBeInTheDocument();
  });

  it("disables the tabs and shows the add-boards empty state for a folder with no boards", () => {
    const empty = {
      ...folderFixture(),
      boards: [],
      rollup: [],
      burn: [],
      attention: [],
    };
    render(wrap({ payload: empty }));
    expect(screen.getByText("Add boards to this folder")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Stages/ })).toBeDisabled();
  });

  it("renders the widgets slot under #widgets", () => {
    render(wrap({ payload: folderFixture(), widgets: <div>WIDGETS</div> }));
    expect(document.getElementById("widgets")).toHaveTextContent("WIDGETS");
  });
});
