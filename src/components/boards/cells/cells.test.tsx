import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  CheckboxCell,
  DateCell,
  DropdownCell,
  EmailCell,
  LinkCell,
  NumberCell,
  PeopleCell,
  PhoneCell,
  RatingCell,
  StatusCell,
  TextCell,
} from "./index";

const upsertCellMock = vi.fn();
const renameItemMock = vi.fn();
vi.mock("@/lib/boards/actions", () => ({
  upsertCell: (...a: unknown[]) => upsertCellMock(...a),
  clearCell: vi.fn().mockResolvedValue({ ok: true, data: undefined }),
  renameItem: (...a: unknown[]) => renameItemMock(...a),
  createItem: vi.fn().mockResolvedValue({
    ok: true,
    data: {
      item: {
        id: "x",
        board_id: "b1",
        group_id: "g1",
        org_id: "o1",
        name: "New Item",
        position: 1,
        parent_id: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    },
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

// jsdom has no layout, so the real virtualizer measures a 0px scroll element
// and renders no rows. Stub it to render every row at a stable offset.
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        key: index,
        start: index * 40,
        size: 40,
      })),
    getTotalSize: () => count * 40,
  }),
}));

import { BoardTable } from "@/components/boards/BoardTable";
import type { BoardPayload } from "@/lib/boards/queries";

const statusSettings = {
  options: [{ id: "o1", label: "Done", color: "#00c875" }],
};

describe("cell renderers (read-only, 2a)", () => {
  it("TextCell shows the text value", () => {
    render(<TextCell value={{ text: "Hello" }} settings={{}} />);
    expect(screen.getByText("Hello")).toBeInTheDocument();
  });

  it("TextCell renders an empty cell when value is null", () => {
    const { container } = render(<TextCell value={null} settings={{}} />);
    expect(container.textContent).toBe("");
  });

  it("StatusCell shows the matching option label", () => {
    render(<StatusCell value={{ optionId: "o1" }} settings={statusSettings} />);
    expect(screen.getByText("Done")).toBeInTheDocument();
  });

  it("StatusCell shows nothing for a null optionId", () => {
    const { container } = render(
      <StatusCell value={{ optionId: null }} settings={statusSettings} />,
    );
    expect(container.textContent).toBe("");
  });

  it("DropdownCell shows all selected option labels", () => {
    render(
      <DropdownCell value={{ optionIds: ["o1"] }} settings={statusSettings} />,
    );
    expect(screen.getByText("Done")).toBeInTheDocument();
  });

  it("PeopleCell shows the count of assignees", () => {
    render(<PeopleCell value={{ userIds: ["u1", "u2"] }} settings={{}} />);
    expect(screen.getByText(/2/)).toBeInTheDocument();
  });

  it("DateCell shows the formatted date", () => {
    render(<DateCell value={{ date: "2026-06-15" }} settings={{}} />);
    expect(screen.getByText(/2026/)).toBeInTheDocument();
  });

  it("NumberCell shows the number with its unit", () => {
    render(<NumberCell value={{ n: 42 }} settings={{ unit: "$" }} />);
    expect(screen.getByText(/42/)).toBeInTheDocument();
  });

  it("renderers do not expose editing affordances in 2a", () => {
    render(<TextCell value={{ text: "x" }} settings={{}} />);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("CheckboxCell shows a checked state", () => {
    render(<CheckboxCell value={{ checked: true }} settings={{}} />);
    expect(screen.getByLabelText(/checked/)).toBeInTheDocument();
  });

  it("RatingCell shows the rating out of five", () => {
    render(<RatingCell value={{ rating: 3 }} settings={{}} />);
    expect(screen.getByLabelText("3 of 5")).toBeInTheDocument();
  });

  it("LinkCell renders an anchor with href and target=_blank", () => {
    render(
      <LinkCell
        value={{ url: "https://example.com", text: "Site" }}
        settings={{}}
      />,
    );
    const link = screen.getByRole("link", { name: "Site" });
    expect(link).toHaveAttribute("href", "https://example.com");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("EmailCell renders a mailto link", () => {
    render(<EmailCell value={{ email: "a@x.io" }} settings={{}} />);
    expect(screen.getByRole("link", { name: "a@x.io" })).toHaveAttribute(
      "href",
      "mailto:a@x.io",
    );
  });

  it("PhoneCell renders a tel link", () => {
    render(<PhoneCell value={{ phone: "+15551234" }} settings={{}} />);
    expect(screen.getByRole("link", { name: "+15551234" })).toHaveAttribute(
      "href",
      "tel:+15551234",
    );
  });
});

function tableWrapper(qc: QueryClient) {
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return Wrapper;
}

function statusPayload(): BoardPayload {
  return {
    board: { id: "b1", org_id: "o1", name: "B" } as never,
    groups: [
      { id: "g1", board_id: "b1", name: "Group 1", color: "#0073ea" } as never,
    ],
    columns: [
      {
        id: "c1",
        board_id: "b1",
        org_id: "o1",
        kind: "status",
        name: "Status",
        settings: {
          options: [
            { id: "o1", label: "Done", color: "#00c875" },
            { id: "o2", label: "Stuck", color: "#e2445c" },
          ],
        },
      } as never,
    ],
    items: [{ id: "i1", board_id: "b1", group_id: "g1", name: "One" } as never],
    // Seed an existing "Stuck" value so a successful optimistic write would
    // change the label to "Done" — making the rollback assertion meaningful.
    cellValues: [
      {
        item_id: "i1",
        column_id: "c1",
        org_id: "o1",
        board_id: "b1",
        value: { optionId: "o2" },
      } as never,
    ],
    views: [
      { id: "v1", board_id: "b1", kind: "table", name: "Main Table" } as never,
    ],
    dependencies: [],
  };
}

describe("BoardTable inline edit (optimistic + rollback)", () => {
  beforeEach(() => upsertCellMock.mockReset());

  it("optimistically applies then rolls back a status edit when the action fails", async () => {
    // Defer the failure so the optimistic "Done" pill is observable before the
    // rollback fires — proving both the optimistic write and the rollback.
    let rejectAction: (res: { ok: false; error: string }) => void = () => {};
    upsertCellMock.mockReturnValue(
      new Promise((resolve) => {
        rejectAction = resolve;
      }),
    );
    const qc = new QueryClient();
    render(
      <BoardTable payload={statusPayload()} members={[]} selectedViewId="v1" />,
      {
        wrapper: tableWrapper(qc),
      },
    );

    // Resting state shows the seeded "Stuck" pill.
    expect(screen.getByText("Stuck")).toBeInTheDocument();

    // Open the Status cell editor, targeted by its stable accessible name
    // `${item.name} ${column.name}`.
    await userEvent.click(screen.getByRole("button", { name: "One Status" }));
    // Pick "Done" → optimistic write swaps the pill to "Done"…
    await userEvent.click(await screen.findByRole("option", { name: /done/i }));
    expect(await screen.findByText("Done")).toBeInTheDocument();

    // …then the action fails and the cache rolls back to the original "Stuck".
    rejectAction({ ok: false, error: "boom" });
    await waitFor(() => {
      expect(screen.queryByText("Done")).not.toBeInTheDocument();
      expect(screen.getByText("Stuck")).toBeInTheDocument();
    });
  });
});

describe("BoardTable Name column rename", () => {
  beforeEach(() => renameItemMock.mockReset());

  it("renames an item via the renameItem action on Enter", async () => {
    renameItemMock.mockResolvedValue({ ok: true, data: undefined });
    const qc = new QueryClient();
    render(
      <BoardTable payload={statusPayload()} members={[]} selectedViewId="v1" />,
      {
        wrapper: tableWrapper(qc),
      },
    );

    // The Name cell is click/Enter-to-edit, labelled `${item.name} name`.
    await userEvent.click(screen.getByRole("button", { name: "One name" }));
    const input = screen.getByRole("textbox", { name: /rename one/i });
    await userEvent.clear(input);
    await userEvent.type(input, "Renamed{Enter}");

    expect(renameItemMock).toHaveBeenCalledWith({
      itemId: "i1",
      name: "Renamed",
    });
  });
});
