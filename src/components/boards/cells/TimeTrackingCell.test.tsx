import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TimeTrackingCell } from "./TimeTrackingCell";

const base = {
  entries: [],
  estimateSeconds: null,
  currentUserId: "u1",
  nowMs: Date.UTC(2026, 5, 20, 12, 0, 0),
  onStart: vi.fn(),
  onStop: vi.fn(),
  onAddManual: vi.fn(),
  onEdit: vi.fn(),
  onDelete: vi.fn(),
  onSetEstimate: vi.fn(),
};

it("renders tracked / estimate", () => {
  render(
    <TimeTrackingCell
      {...base}
      entries={[
        {
          id: "a",
          user_id: "u1",
          started_at: "x",
          ended_at: "y",
          duration_secs: 9900,
        } as never,
      ]}
      estimateSeconds={14400}
    />,
  );
  expect(screen.getByText(/2h 45m/)).toBeInTheDocument();
  expect(screen.getByText(/4h/)).toBeInTheDocument();
});

it("start button calls onStart when no running entry", async () => {
  render(<TimeTrackingCell {...base} />);
  await userEvent.click(screen.getByRole("button", { name: /start timer/i }));
  expect(base.onStart).toHaveBeenCalled();
});

describe("TimeTrackingCell expanded popover", () => {
  it("opens a popover when the trigger is clicked", async () => {
    render(
      <TimeTrackingCell
        {...base}
        entries={[
          {
            id: "e1",
            user_id: "u1",
            started_at: "2026-06-20T10:00:00Z",
            ended_at: "2026-06-20T11:00:00Z",
            duration_secs: 3600,
          } as never,
        ]}
      />,
    );
    // Click the trigger area (the time display)
    await userEvent.click(
      screen.getByRole("button", { name: /open time tracking/i }),
    );
    // Popover content should be visible
    expect(screen.getByText(/tracked/i)).toBeInTheDocument();
  });

  it("shows Add time row in popover", async () => {
    render(<TimeTrackingCell {...base} />);
    await userEvent.click(
      screen.getByRole("button", { name: /open time tracking/i }),
    );
    expect(
      screen.getByRole("button", { name: /add time/i }),
    ).toBeInTheDocument();
  });

  it("stop button calls onStop with entry id when running entry exists", async () => {
    const onStop = vi.fn();
    render(
      <TimeTrackingCell
        {...base}
        onStop={onStop}
        entries={[
          {
            id: "running-entry",
            user_id: "u1",
            started_at: new Date(base.nowMs - 60000).toISOString(),
            ended_at: null,
            duration_secs: null,
          } as never,
        ]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /stop timer/i }));
    expect(onStop).toHaveBeenCalledWith("running-entry");
  });

  it("onDelete called when delete button clicked in popover", async () => {
    const onDelete = vi.fn();
    render(
      <TimeTrackingCell
        {...base}
        onDelete={onDelete}
        entries={[
          {
            id: "del-entry",
            user_id: "u1",
            started_at: "2026-06-20T08:00:00Z",
            ended_at: "2026-06-20T09:00:00Z",
            duration_secs: 3600,
          } as never,
        ]}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /open time tracking/i }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: /delete entry/i }),
    );
    expect(onDelete).toHaveBeenCalledWith("del-entry");
  });
});

describe("TimeTrackingCell date pickers (Calendar primitive)", () => {
  // Pin "today" so the add-manual picker opens on a known month deterministically.
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 5, 20)); // local 2026-06-20
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders no native date inputs in the popover (migration guard)", async () => {
    render(<TimeTrackingCell {...base} nowMs={undefined} />);
    await userEvent.click(
      screen.getByRole("button", { name: /open time tracking/i }),
    );
    // Popover content portals to document.body, so query the whole document.
    expect(document.querySelector('input[type="date"]')).toBeNull();
  });

  it("add-manual: picking a day commits the correct local ISO via onAddManual", async () => {
    const onAddManual = vi.fn();
    render(
      <TimeTrackingCell
        {...base}
        nowMs={undefined}
        onAddManual={onAddManual}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /open time tracking/i }),
    );
    await userEvent.type(
      screen.getByRole("textbox", { name: /duration to add/i }),
      "1h",
    );
    // Open the date picker popover, then pick June 15 from the calendar grid.
    await userEvent.click(
      screen.getByRole("button", { name: /date for manual entry/i }),
    );
    expect(screen.getByRole("grid")).toBeInTheDocument();
    await userEvent.click(screen.getByText("15"));
    await userEvent.click(screen.getByRole("button", { name: /add time/i }));
    expect(onAddManual).toHaveBeenCalledWith("2026-06-15", 3600);
  });

  it("edit: picking a day calls onEdit with the correct local ISO + duration", async () => {
    const onEdit = vi.fn();
    render(
      <TimeTrackingCell
        {...base}
        onEdit={onEdit}
        entries={[
          {
            id: "edit-entry",
            user_id: "u1",
            started_at: "2026-06-20T08:00:00Z",
            ended_at: "2026-06-20T09:30:00Z",
            duration_secs: 5400,
          } as never,
        ]}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /open time tracking/i }),
    );
    await userEvent.click(screen.getByRole("button", { name: /edit entry/i }));
    await userEvent.click(screen.getByRole("button", { name: /edit date/i }));
    expect(screen.getByRole("grid")).toBeInTheDocument();
    await userEvent.click(screen.getByText("15"));
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(onEdit).toHaveBeenCalledWith("edit-entry", "2026-06-15", 5400);
  });
});
