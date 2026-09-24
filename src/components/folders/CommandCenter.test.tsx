import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { folderFixture, folderFixtureWithPreset } from "@/lib/folders/fixture";
import type { FolderLayoutConfig } from "@/lib/validations/folder-layout";
import { TooltipProvider } from "@/components/ui/tooltip";

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
vi.mock("@/lib/folders/layout-actions", () => ({
  saveFolderLayout: vi.fn(),
}));
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    error: (...a: unknown[]) => toastError(...a),
  }),
}));

import { getFolderWorkload } from "@/lib/folders/actions";
import { saveFolderLayout } from "@/lib/folders/layout-actions";
import { CommandCenter, type CommandCenterProps } from "./CommandCenter";

function wrap(props: CommandCenterProps) {
  const qc = new QueryClient();
  return (
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <CommandCenter {...props} />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

describe("CommandCenter", () => {
  beforeEach(() => {
    params.current = new URLSearchParams("");
    window.history.replaceState({}, "", "/folders/f1");
    vi.mocked(getFolderWorkload).mockClear();
    vi.mocked(saveFolderLayout).mockReset();
    routerPush.mockClear();
    routerRefresh.mockClear();
    toastError.mockClear();
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

  it("gives the tab strip and the stage chips a 44px hit target on a coarse pointer", () => {
    // Both are hand-rolled buttons, not app primitives, so they have to carry
    // the coarse-pointer rule themselves. Class arithmetic — jsdom has no
    // layout, and the real geometry is pinned by the CSS harness suite.
    render(wrap({ payload: folderFixture() }));
    expect(screen.getByRole("tab", { name: /Overview/ }).className).toContain(
      "pointer-coarse:min-h-11",
    );
    const chips = screen.getByRole("group", { name: "Stage" });
    for (const chip of Array.from(chips.querySelectorAll("button"))) {
      expect(chip.className).toContain("pointer-coarse:min-h-11");
    }
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

  it("renders a CRM folder without the burn chart or milestones, with a Pipeline tab", () => {
    render(wrap({ payload: folderFixtureWithPreset("crm") }));
    expect(screen.queryByTestId("burn-chart")).not.toBeInTheDocument();
    expect(screen.queryByText("Next milestones")).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Pipeline/ })).toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: /People/ }),
    ).not.toBeInTheDocument();
  });

  it("shows only the KPI cards the layout selects, in order", () => {
    render(wrap({ payload: folderFixtureWithPreset("crm") }));
    const labels = screen.getAllByTestId("kpi-label").map((n) => n.textContent);
    expect(labels).toEqual(["Complete", "Overdue", "Due this week"]);
  });

  it("never navigates when switching tabs", () => {
    render(wrap({ payload: folderFixture() }));
    fireEvent.click(screen.getByRole("tab", { name: /Boards/ }));
    expect(routerPush).not.toHaveBeenCalled();
    expect(routerRefresh).not.toHaveBeenCalled();
  });

  // Customize mode (spec §6). `useSearchParams` is mocked to a static test
  // double above (it doesn't re-sync from `history.replaceState` the way real
  // Next.js does), so tests that need edit mode already on preset
  // `params.current` with `edit=1` before rendering, mirroring how the
  // existing stage/tab tests preset params for a "deep link" scenario, rather
  // than relying on a click-to-customize transition being visible mid-test.
  function sectionCell(id: string) {
    const cell = screen
      .getAllByTestId("section-cell")
      .find((el) => el.dataset.sectionId === id);
    if (!cell) throw new Error(`no section-cell for "${id}"`);
    return cell;
  }
  function enterEdit() {
    params.current = new URLSearchParams("edit=1");
    window.history.replaceState({}, "", "/folders/f1?edit=1");
  }

  it("entering edit mode makes no server call", () => {
    render(wrap({ payload: folderFixture() }));
    fireEvent.click(screen.getByRole("button", { name: "Customize" }));
    expect(routerRefresh).not.toHaveBeenCalled();
    expect(saveFolderLayout).not.toHaveBeenCalled();
    expect(window.location.search).toBe("?edit=1");
  });

  it("hiding a section and moving one are local until Save", () => {
    enterEdit();
    render(wrap({ payload: folderFixture() }));
    expect(screen.getByTestId("burn-chart")).toBeInTheDocument();
    fireEvent.click(
      within(sectionCell("burn")).getByRole("button", {
        name: "Hide Planned vs completed",
      }),
    );
    expect(screen.queryByTestId("burn-chart")).not.toBeInTheDocument();
    fireEvent.click(
      within(sectionCell("attention")).getByRole("button", {
        name: "Move up",
      }),
    );
    expect(saveFolderLayout).not.toHaveBeenCalled();
  });

  it("Save sends the edited config once and refreshes", async () => {
    enterEdit();
    vi.mocked(saveFolderLayout).mockResolvedValueOnce({
      ok: true,
      data: { version: 2 },
    });
    render(wrap({ payload: folderFixture() }));
    fireEvent.click(
      within(sectionCell("burn")).getByRole("button", {
        name: "Hide Planned vs completed",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saveFolderLayout).toHaveBeenCalledTimes(1));
    const sent = vi.mocked(saveFolderLayout).mock.calls[0]![0] as {
      config: FolderLayoutConfig;
    };
    const overview = sent.config.tabs.find((t) => t.id === "overview")!;
    const panels = (overview.sections ?? [])
      .filter((s) => s.type === "builtin")
      .map((s) => s.panel);
    expect(panels).not.toContain("burn");
    await waitFor(() => expect(routerRefresh).toHaveBeenCalledTimes(1));
  });

  it("Cancel restores the original layout and leaves edit mode", () => {
    enterEdit();
    render(wrap({ payload: folderFixture() }));
    fireEvent.click(
      within(sectionCell("burn")).getByRole("button", {
        name: "Hide Planned vs completed",
      }),
    );
    expect(screen.queryByTestId("burn-chart")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByTestId("burn-chart")).toBeInTheDocument();
    expect(window.location.search).not.toContain("edit");
    expect(saveFolderLayout).not.toHaveBeenCalled();
  });

  it("a stale save surfaces the error and stays in edit mode", async () => {
    enterEdit();
    vi.mocked(saveFolderLayout).mockResolvedValueOnce({
      ok: false,
      error: "This layout changed — reload the page and try again.",
    });
    render(wrap({ payload: folderFixture() }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saveFolderLayout).toHaveBeenCalledTimes(1));
    expect(toastError).toHaveBeenCalledWith("Couldn't save the layout", {
      description: "This layout changed — reload the page and try again.",
    });
    expect(routerRefresh).not.toHaveBeenCalled();
    // Save is still on screen — the failed save left edit mode intact so the
    // user's work isn't lost.
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("Reset to preset re-syncs stale rename inputs (section and tab)", () => {
    // Regression: SectionChrome/TabRow seed their rename textbox from props
    // in local state and never resync. Section/tab ids repeat across every
    // preset, so React keys stay stable and these rows never unmount when
    // `draft.reset()` swaps the whole config — without the fix, the textbox
    // keeps showing the pre-reset text.
    enterEdit();
    render(wrap({ payload: folderFixture() }));

    // Section rename: SectionChrome's aria-label is the constant panel name,
    // not the (possibly renamed) title, so it stays queryable across renames.
    const sectionInput = within(sectionCell("attention")).getByRole("textbox", {
      name: "Rename Needs attention",
    });
    fireEvent.change(sectionInput, { target: { value: "My section" } });
    fireEvent.blur(sectionInput);
    expect(
      within(sectionCell("attention")).getByRole("textbox", {
        name: "Rename Needs attention",
      }),
    ).toHaveValue("My section");

    // Tab rename, via the Sections sheet.
    fireEvent.click(screen.getByRole("button", { name: "Sections" }));
    const tabInput = screen.getByRole("textbox", {
      name: "Rename Stages tab",
    });
    fireEvent.change(tabInput, { target: { value: "Pipeline" } });
    fireEvent.blur(tabInput);
    expect(
      screen.getByRole("textbox", { name: "Rename Pipeline tab" }),
    ).toHaveValue("Pipeline");

    // Reset wholesale-replaces the draft config with PRESETS.project, whose
    // "attention" section has no custom title and whose stages tab is
    // labelled "Stages" — both rename boxes must reflect that immediately.
    // The Sections sheet stays open (deliberately — the TabRow instance must
    // stay mounted, same as it would for a real user, to actually exercise
    // the resync-on-prop-change fix rather than a fresh mount that would
    // read the current label either way); Radix marks the rest of the page
    // `aria-hidden` for focus-trapping while it's open, so these queries
    // pass `hidden: true` to see past that.
    fireEvent.click(
      screen.getByRole("button", { name: /Reset to preset/, hidden: true }),
    );
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Project", hidden: true }),
    );

    expect(
      within(sectionCell("attention")).getByRole("textbox", {
        name: "Rename Needs attention",
        hidden: true,
      }),
    ).toHaveValue("Needs attention");
    expect(
      screen.getByRole("textbox", {
        name: "Rename Stages tab",
        hidden: true,
      }),
    ).toHaveValue("Stages");
  });
});
