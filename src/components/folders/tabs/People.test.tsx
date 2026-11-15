import { render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { WorkloadRow } from "@/lib/folders/types";

const rows: WorkloadRow[] = [
  {
    userId: "u1",
    boardId: "b1",
    boardName: "Backend",
    stageKey: "build",
    stageName: "Build",
    open: 16,
    overdue: 2,
  },
  {
    userId: "u1",
    boardId: "b2",
    boardName: "Mobile",
    stageKey: "qa",
    stageName: "QA",
    open: 1,
    overdue: 0,
  },
  {
    userId: "u2",
    boardId: "b1",
    boardName: "Backend",
    stageKey: "build",
    stageName: "Build",
    open: 3,
    overdue: 0,
  },
  {
    userId: null,
    boardId: "b2",
    boardName: "Mobile",
    stageKey: "build",
    stageName: "Build",
    open: 2,
    overdue: 1,
  },
];
vi.mock("@/lib/folders/actions", () => ({
  getFolderWorkload: vi.fn(async () => ({ ok: true, data: rows })),
}));
import { getFolderWorkload } from "@/lib/folders/actions";
import { PeopleTab, peopleFromWorkload } from "./People";

const members = [
  { userId: "u1", fullName: "Ada Lovelace", avatarUrl: null },
  { userId: "u2", fullName: "Grace Hopper", avatarUrl: null },
];

describe("peopleFromWorkload", () => {
  it("sums per person for the selected stage and excludes the null row", () => {
    const all = peopleFromWorkload(rows, null, members);
    expect(all.map((p) => [p.name, p.open])).toEqual([
      ["Ada Lovelace", 17],
      ["Grace Hopper", 3],
    ]);
    expect(peopleFromWorkload(rows, "qa", members).map((p) => p.open)).toEqual([
      1,
    ]);
  });
});

describe("PeopleTab", () => {
  it("fetches workload once, renders bars, who-owns-what and unassigned", async () => {
    const qc = new QueryClient();
    const onWorkload = vi.fn();
    const { rerender } = render(
      <QueryClientProvider client={qc}>
        <PeopleTab
          folderId="f1"
          stage={null}
          members={members}
          onWorkload={onWorkload}
        />
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(
        within(screen.getByTestId("workload-section")).getByText(
          "Ada Lovelace",
        ),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText("Who owns what")).toBeInTheDocument();
    const ownersSection = screen.getByTestId("owners-section");
    // Visible (not hover-only) on the who-owns-what row too — this app is iPad-first.
    expect(within(ownersSection).getByText("Ada Lovelace")).toBeInTheDocument();
    expect(
      within(ownersSection).getByText("Backend, Mobile"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Unassigned · 2 open/ }),
    ).toHaveAttribute("href", "/boards/b2");
    expect(onWorkload).toHaveBeenCalledWith(rows);
    rerender(
      <QueryClientProvider client={qc}>
        <PeopleTab
          folderId="f1"
          stage="qa"
          members={members}
          onWorkload={onWorkload}
        />
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(
        within(screen.getByTestId("workload-section")).queryByText(
          "Grace Hopper",
        ),
      ).toBeNull(),
    );
    // The stage switch removes her from BOTH sections — "who owns what" is
    // scoped to the current stage too, not just the folder-wide totals.
    expect(
      within(screen.getByTestId("owners-section")).queryByText("Grace Hopper"),
    ).toBeNull();
    expect(getFolderWorkload).toHaveBeenCalledTimes(1); // stage switch = 0 new calls
  });

  it("applies the board filter to every section, from the cache", async () => {
    const qc = new QueryClient();
    const ui = (board: string | null) => (
      <QueryClientProvider client={qc}>
        <PeopleTab
          folderId="f1"
          stage={null}
          board={board}
          members={members}
          onWorkload={vi.fn()}
        />
      </QueryClientProvider>
    );
    const calls = vi.mocked(getFolderWorkload).mock.calls.length;
    const { rerender } = render(ui(null));
    await waitFor(() =>
      expect(
        screen.getByRole("link", { name: /Unassigned · 2 open/ }),
      ).toBeInTheDocument(),
    );
    rerender(ui("b1"));
    const owners = screen.getByTestId("owners-section");
    // Ada's Mobile row drops out; only Backend remains.
    expect(within(owners).getAllByText("Backend")).toHaveLength(2);
    expect(within(owners).queryByText("Backend, Mobile")).toBeNull();
    expect(within(owners).getByText("16 open · 2 overdue")).toBeInTheDocument();
    // The only unassigned row is on Mobile.
    expect(screen.queryByRole("link", { name: /Unassigned/ })).toBeNull();
    expect(
      screen.getByText("Every open item has an owner."),
    ).toBeInTheDocument();
    expect(vi.mocked(getFolderWorkload).mock.calls.length).toBe(calls + 1);
  });
});

describe("peopleFromWorkload board filter", () => {
  it("keeps only the selected board's rows", () => {
    expect(
      peopleFromWorkload(rows, null, members, "b2").map((p) => [
        p.name,
        p.open,
      ]),
    ).toEqual([["Ada Lovelace", 1]]);
  });
});

describe("member display fallback", () => {
  const mixed = [
    {
      userId: "u1",
      fullName: null,
      email: "ada.lovelace@x.com",
      avatarUrl: null,
    },
    { userId: "u2", fullName: "Grace Hopper", email: null, avatarUrl: null },
  ];
  it("labels a nameless member by email, a named one by name, a stranger Unknown member", () => {
    const stranger = [...rows, { ...rows[2], userId: "gone" }];
    const names = peopleFromWorkload(stranger, null, mixed).map((p) => p.name);
    expect(names).toContain("ada.lovelace@x.com");
    expect(names).toContain("Grace Hopper");
    expect(names).toContain("Unknown member");
  });

  it("shows the email and its initials in who-owns-what", async () => {
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <PeopleTab
          folderId="f9"
          stage={null}
          members={mixed}
          onWorkload={vi.fn()}
        />
      </QueryClientProvider>,
    );
    const owners = await screen.findByTestId("owners-section");
    expect(within(owners).getByText("ada.lovelace@x.com")).toHaveAttribute(
      "title",
      "ada.lovelace@x.com",
    );
    expect(within(owners).getByText("AL")).toBeInTheDocument();
    expect(within(owners).queryByText("Unknown member")).toBeNull();
  });
});
