import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DockTabs } from "./DockTabs";

describe("DockTabs", () => {
  it("renders two tabs, marks the active one, and shows the unresolved badge", () => {
    render(<DockTabs value="chat" onChange={() => {}} badge={3} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Chat", "Intelligence3"]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(tabs[1]).toHaveAttribute("aria-selected", "false");
    expect(screen.queryByText(/pulse|ai/i)).toBeNull();
  });

  it("hides a zero badge", () => {
    render(<DockTabs value="intelligence" onChange={() => {}} badge={0} />);
    expect(
      screen.getByRole("tab", { name: "Intelligence" }),
    ).toBeInTheDocument();
  });

  it("switches on click and on arrow keys", async () => {
    const onChange = vi.fn();
    render(<DockTabs value="chat" onChange={onChange} badge={0} />);
    await userEvent.click(screen.getByRole("tab", { name: "Intelligence" }));
    expect(onChange).toHaveBeenLastCalledWith("intelligence");
    screen.getByRole("tab", { name: "Chat" }).focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith("intelligence");
    await userEvent.keyboard("{ArrowLeft}");
    expect(onChange).toHaveBeenLastCalledWith("chat");
  });

  it("jumps to the ends with Home and End", async () => {
    const onChange = vi.fn();
    render(<DockTabs value="chat" onChange={onChange} badge={0} />);
    screen.getByRole("tab", { name: "Chat" }).focus();
    await userEvent.keyboard("{End}");
    expect(onChange).toHaveBeenLastCalledWith("intelligence");
    await userEvent.keyboard("{Home}");
    expect(onChange).toHaveBeenLastCalledWith("chat");
  });

  it("names the panel each tab controls", () => {
    render(<DockTabs value="chat" onChange={() => {}} badge={0} />);
    expect(screen.getByRole("tablist")).toHaveAttribute(
      "aria-label",
      "Dock sections",
    );
    const [chat, intel] = screen.getAllByRole("tab");
    expect(chat).toHaveAttribute("id", "dock-tab-chat");
    expect(intel).toHaveAttribute("id", "dock-tab-intelligence");
    // Only the open section is mounted, so only the selected tab has a panel to
    // point at — the other would be naming an id that is not in the document.
    expect(chat).toHaveAttribute("aria-controls", "dock-panel-chat");
    expect(intel).not.toHaveAttribute("aria-controls");
  });

  it("moves aria-controls with the selection", () => {
    render(<DockTabs value="intelligence" onChange={() => {}} badge={0} />);
    const [chat, intel] = screen.getAllByRole("tab");
    expect(intel).toHaveAttribute("aria-controls", "dock-panel-intelligence");
    expect(chat).not.toHaveAttribute("aria-controls");
  });
});
