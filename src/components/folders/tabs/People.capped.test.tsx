import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const getFolderWorkload = vi.fn();
vi.mock("@/lib/folders/actions", () => ({
  getFolderWorkload: (input: unknown) => getFolderWorkload(input),
}));
import { PeoplePanel } from "@/components/folders/panels/PeoplePanel";
import { PeopleTab } from "./People";

const rows = [
  {
    userId: "u1",
    boardId: "b1",
    boardName: "Backend",
    stageKey: "build",
    stageName: "Build",
    open: 3,
    overdue: 1,
  },
];
const members = [{ userId: "u1", fullName: "Ada Lovelace", avatarUrl: null }];

function wrap(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{node}</QueryClientProvider>;
}

describe("workload row cap", () => {
  it("the People tab and the Overview panel both say so when the read was cut", async () => {
    getFolderWorkload.mockResolvedValue({ ok: true, data: rows, capped: true });
    render(
      wrap(
        <>
          <PeopleTab
            folderId="f1"
            stage={null}
            members={members}
            onWorkload={vi.fn()}
          />
          <PeoplePanel
            kicker="05"
            folderId="f1"
            stage={null}
            members={members}
          />
        </>,
      ),
    );
    await waitFor(() =>
      expect(screen.getAllByTestId("workload-capped")).toHaveLength(2),
    );
    expect(screen.getAllByTestId("workload-capped")[0]).toHaveTextContent(
      "Only the first 1 rows are counted here, so these totals are incomplete.",
    );
    // One shared query: two readers, one read.
    expect(getFolderWorkload).toHaveBeenCalledTimes(1);
  });

  it("says nothing when the read is complete", async () => {
    getFolderWorkload.mockResolvedValue({ ok: true, data: rows });
    render(
      wrap(
        <PeopleTab
          folderId="f1"
          stage={null}
          members={members}
          onWorkload={vi.fn()}
        />,
      ),
    );
    await waitFor(() => screen.getByTestId("workload-section"));
    expect(screen.queryByTestId("workload-capped")).toBeNull();
  });
});
