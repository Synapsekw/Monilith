import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AgentSwitcher } from "./AgentSwitcher";

const AGENTS = [
  { id: "a1", name: "Morning Brief" },
  { id: "a2", name: "Overdue Chaser" },
];

describe("AgentSwitcher", () => {
  it("offers Ask first, then the roster", () => {
    render(
      <AgentSwitcher agents={AGENTS} value={null} onChange={() => {}} />, //
    );
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Ask",
      "Morning Brief",
      "Overdue Chaser",
    ]);
  });

  it("reports null for Ask and the id for an agent", async () => {
    const onChange = vi.fn();
    render(<AgentSwitcher agents={AGENTS} value={null} onChange={onChange} />);
    const select = screen.getByRole("combobox");

    await userEvent.selectOptions(select, "a2");
    expect(onChange).toHaveBeenLastCalledWith("a2");

    await userEvent.selectOptions(select, "");
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("locks mid-thread, because the persona lives on the conversation row", () => {
    render(
      <AgentSwitcher agents={AGENTS} value="a1" disabled onChange={() => {}} />,
    );
    expect(screen.getByRole("combobox")).toBeDisabled();
    expect(screen.getByRole("combobox")).toHaveValue("a1");
  });
});
