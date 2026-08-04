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

  it("offers the share toggle only on threads the caller owns", () => {
    const onToggleShare = vi.fn();
    render(
      <DockThreadList
        boardThreads={[
          row({ id: "mine", title: "Mine", user_id: "me" }),
          row({
            id: "theirs",
            title: "Theirs",
            user_id: "someone-else",
            visibility: "board",
          }),
        ]}
        agentThreads={[]}
        activeId={null}
        currentUserId="me"
        agentNames={{}}
        onSelect={() => {}}
        onToggleShare={onToggleShare}
      />,
    );
    // RLS scopes the update to the owner regardless; this is the affordance,
    // and offering a control that always fails is worse than not offering it.
    expect(
      screen.getByRole("button", { name: /share "mine" with this board/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /"theirs"/i })).toBeNull();
  });

  it("names the share toggle after what pressing it does", async () => {
    const onToggleShare = vi.fn();
    const shared = row({ user_id: "me", visibility: "board" });
    render(
      <DockThreadList
        boardThreads={[shared]}
        agentThreads={[]}
        activeId={null}
        currentUserId="me"
        agentNames={{}}
        onSelect={() => {}}
        onToggleShare={onToggleShare}
      />,
    );
    // Already on the board, so the action available is taking it back.
    const toggle = screen.getByRole("button", {
      name: /make "thread" private/i,
    });
    await userEvent.click(toggle);
    expect(onToggleShare).toHaveBeenCalledWith(shared);
  });

  it("marks a board-visible thread as Shared whoever owns it", () => {
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
    // "Shared" states a fact about the thread — everyone on this board can
    // read it — not a fact about who owns it.
    expect(screen.getByText(/shared/i)).toBeInTheDocument();
  });

  it("does not mark a private thread as shared", () => {
    render(
      <DockThreadList
        boardThreads={[row({ user_id: "me", visibility: "private" })]}
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
