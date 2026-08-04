import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DockThreadList } from "./DockThreadList";
import type { BoardThreadRow } from "@/lib/ai/ask/board-threads";

const row = (over: Partial<BoardThreadRow> = {}): BoardThreadRow => ({
  id: "c1",
  title: "Thread",
  updated_at: "2026-08-03T10:00:00Z",
  agent_id: null,
  visibility: "private",
  user_id: "me",
  ...over,
});

describe("DockThreadList", () => {
  it("separates board threads from agent threads", () => {
    render(
      <DockThreadList
        boardThreads={[row({ id: "b", title: "About the roadmap" })]}
        agentThreads={[
          row({ id: "a", title: "Morning Brief — 3 Aug", agent_id: "a1" }),
        ]}
        activeId={null}
        currentUserId="me"
        agentNames={{ a1: "Morning Brief" }}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByText("This board")).toBeInTheDocument();
    expect(screen.getByText("From your agents")).toBeInTheDocument();
    expect(screen.getByText("About the roadmap")).toBeInTheDocument();
  });

  it("marks a thread shared by someone else so it reads as not-yours", () => {
    render(
      <DockThreadList
        boardThreads={[row({ user_id: "someone-else", visibility: "board" })]}
        agentThreads={[]}
        activeId={null}
        currentUserId="me"
        agentNames={{}}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByText(/shared/i)).toBeInTheDocument();
  });

  it("does not mark your OWN shared thread as someone else's", () => {
    render(
      <DockThreadList
        boardThreads={[row({ user_id: "me", visibility: "board" })]}
        agentThreads={[]}
        activeId={null}
        currentUserId="me"
        agentNames={{}}
        onSelect={() => {}}
      />,
    );
    expect(screen.queryByText(/shared/i)).toBeNull();
  });

  it("renders an empty state rather than two empty headings", () => {
    render(
      <DockThreadList
        boardThreads={[]}
        agentThreads={[]}
        activeId={null}
        currentUserId="me"
        agentNames={{}}
        onSelect={() => {}}
      />,
    );
    expect(screen.queryByText("This board")).not.toBeInTheDocument();
    expect(screen.getByText(/no threads yet/i)).toBeInTheDocument();
  });

  it("marks the active thread and reports the id it was asked to select", async () => {
    const onSelect = vi.fn();
    render(
      <DockThreadList
        boardThreads={[
          row({ id: "b1", title: "First" }),
          row({ id: "b2", title: "Second" }),
        ]}
        agentThreads={[]}
        activeId="b2"
        currentUserId="me"
        agentNames={{}}
        onSelect={onSelect}
      />,
    );
    expect(screen.getByRole("button", { name: /second/i })).toHaveAttribute(
      "aria-current",
      "true",
    );
    await userEvent.click(screen.getByRole("button", { name: /first/i }));
    expect(onSelect).toHaveBeenCalledWith("b1");
  });
});
