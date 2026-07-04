import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AiReviewBanner } from "./AiReviewBanner";

const mockPush = vi.fn();
const mockReplace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
}));

const mockDeleteDashboard = vi.fn();

vi.mock("@/lib/dashboards/actions", () => ({
  deleteDashboard: (...args: unknown[]) => mockDeleteDashboard(...args),
}));

beforeEach(() => {
  mockPush.mockReset();
  mockReplace.mockReset();
  mockDeleteDashboard.mockReset();
  mockDeleteDashboard.mockResolvedValue({ ok: true, data: undefined });
});

describe("AiReviewBanner", () => {
  it("renders the keep, discard, and regenerate controls", () => {
    render(<AiReviewBanner dashboardId="dash-1" />);
    expect(screen.getByRole("button", { name: /keep/i })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /discard/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /regenerate/i }),
    ).toBeInTheDocument();
  });

  it("renders the AI-generated explanation copy", () => {
    render(<AiReviewBanner dashboardId="dash-1" />);
    expect(screen.getByText(/ai generated/i)).toBeInTheDocument();
  });

  it("clicking Keep drops the review param via the History API (no RSC re-run) and dismisses", async () => {
    // Keep is an in-page URL cleanup, not a navigation: it must use
    // window.history.replaceState (0 server round-trips), NOT router.replace
    // which would re-run the whole RSC tree.
    const replaceState = vi
      .spyOn(window.history, "replaceState")
      .mockImplementation(() => {});
    render(<AiReviewBanner dashboardId="dash-42" />);
    fireEvent.click(screen.getByRole("button", { name: /keep/i }));
    await waitFor(() =>
      expect(replaceState).toHaveBeenCalledWith(
        null,
        "",
        "/dashboards/dash-42",
      ),
    );
    // The banner dismisses itself in-page; no RSC nav, no dashboard delete.
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockDeleteDashboard).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: /keep/i }),
    ).not.toBeInTheDocument();
    replaceState.mockRestore();
  });

  it("clicking Discard calls deleteDashboard with the dashboardId then pushes /dashboards", async () => {
    render(<AiReviewBanner dashboardId="dash-99" />);
    fireEvent.click(screen.getByRole("button", { name: /discard/i }));
    await waitFor(() =>
      expect(mockDeleteDashboard).toHaveBeenCalledWith({
        dashboardId: "dash-99",
      }),
    );
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/dashboards"));
  });

  it("clicking Regenerate calls deleteDashboard then pushes /dashboards?ai=1", async () => {
    render(<AiReviewBanner dashboardId="dash-7" />);
    fireEvent.click(screen.getByRole("button", { name: /regenerate/i }));
    await waitFor(() =>
      expect(mockDeleteDashboard).toHaveBeenCalledWith({
        dashboardId: "dash-7",
      }),
    );
    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith("/dashboards?ai=1"),
    );
  });

  it("shows an error message when deleteDashboard fails on Discard", async () => {
    mockDeleteDashboard.mockResolvedValue({
      ok: false,
      error: "Something went wrong",
    });
    render(<AiReviewBanner dashboardId="dash-fail" />);
    fireEvent.click(screen.getByRole("button", { name: /discard/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(mockPush).not.toHaveBeenCalled();
  });
});
