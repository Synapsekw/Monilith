import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LAST_USER_KEY } from "@/lib/offline/constants";

const offlineBoardProps = vi.fn();
vi.mock("@/components/offline/OfflineBoard", () => ({
  // Named function expression (not an anonymous arrow) so eslint's
  // react/display-name has a name to infer — same idiom used throughout the
  // offline test suite (OfflineBoard.test.tsx, snapshot.test.tsx).
  OfflineBoard: function OfflineBoard(props: Record<string, unknown>) {
    offlineBoardProps(props);
    return <div data-testid="offline-board" />;
  },
}));

import OfflinePage from "./page";

const VALID_UUID = "11111111-1111-4111-8111-111111111111";

function setPath(path: string) {
  window.history.pushState({}, "", path);
}

beforeEach(() => {
  offlineBoardProps.mockClear();
  window.localStorage.clear();
});

describe("OfflinePage", () => {
  it("resolves a valid board path with a stored user id into OfflineBoard", async () => {
    window.localStorage.setItem(LAST_USER_KEY, "u1");
    setPath(`/boards/${VALID_UUID}`);

    render(<OfflinePage />);

    expect(await screen.findByTestId("offline-board")).toBeInTheDocument();
    expect(offlineBoardProps).toHaveBeenCalledWith({
      boardId: VALID_UUID,
      userId: "u1",
    });
  });

  it("falls back to the generic offline copy for a non-board path", async () => {
    window.localStorage.setItem(LAST_USER_KEY, "u1");
    setPath("/dashboards/some-id");

    render(<OfflinePage />);

    expect(await screen.findByText(/you.re offline/i)).toBeInTheDocument();
    expect(screen.queryByTestId("offline-board")).not.toBeInTheDocument();
  });

  it("falls back for a malformed board id rather than passing it downstream", async () => {
    window.localStorage.setItem(LAST_USER_KEY, "u1");
    // Not a real UUID: this is exactly the shape the old
    // `/^\/boards\/([0-9a-f-]{36})/` regex would have accepted (36
    // hex-or-hyphen characters with no 8-4-4-4-12 grouping).
    setPath("/boards/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");

    render(<OfflinePage />);

    expect(await screen.findByText(/you.re offline/i)).toBeInTheDocument();
    expect(screen.queryByTestId("offline-board")).not.toBeInTheDocument();
  });

  it("falls back for a valid board id followed by extra path segments", async () => {
    window.localStorage.setItem(LAST_USER_KEY, "u1");
    // Being unanchored, the old regex also matched `/boards/<id>/settings`.
    setPath(`/boards/${VALID_UUID}/reports`);

    render(<OfflinePage />);

    expect(await screen.findByText(/you.re offline/i)).toBeInTheDocument();
    expect(screen.queryByTestId("offline-board")).not.toBeInTheDocument();
  });

  it("falls back when there is no stored user id, even for a valid board path", async () => {
    setPath(`/boards/${VALID_UUID}`);
    // Deliberately no LAST_USER_KEY in localStorage.

    render(<OfflinePage />);

    expect(await screen.findByText(/you.re offline/i)).toBeInTheDocument();
    expect(screen.queryByTestId("offline-board")).not.toBeInTheDocument();
  });
});
