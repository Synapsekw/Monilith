import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  DateCell,
  DropdownCell,
  NumberCell,
  PeopleCell,
  StatusCell,
  TextCell,
} from "./index";

const upsertCellMock = vi.fn();
vi.mock("@/lib/boards/actions", () => ({
  upsertCell: (...a: unknown[]) => upsertCellMock(...a),
  clearCell: vi.fn(),
  createItem: vi.fn().mockResolvedValue({ ok: true, data: { itemId: "x" } }),
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
        settings: { options: [{ id: "o1", label: "Done", color: "#00c875" }] },
      } as never,
    ],
    items: [{ id: "i1", board_id: "b1", group_id: "g1", name: "One" } as never],
    cellValues: [],
  };
}

describe("BoardTable inline edit (optimistic + rollback)", () => {
  beforeEach(() => upsertCellMock.mockReset());

  it("reverts the optimistic status edit when the action fails", async () => {
    upsertCellMock.mockResolvedValue({ ok: false, error: "boom" });
    const qc = new QueryClient();
    render(<BoardTable payload={statusPayload()} members={[]} />, {
      wrapper: tableWrapper(qc),
    });

    // Open the Status cell editor (the empty cell on row "One"), targeted by
    // its stable accessible name `${item.name} ${column.name}`.
    await userEvent.click(screen.getByRole("button", { name: "One Status" }));
    // Pick "Done" → optimistic write shows it, then the failed action rolls back.
    await userEvent.click(await screen.findByRole("option", { name: /done/i }));

    await waitFor(() =>
      expect(screen.queryByText("Done")).not.toBeInTheDocument(),
    );
  });
});
