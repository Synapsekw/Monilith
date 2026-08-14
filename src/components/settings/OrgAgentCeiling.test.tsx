import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const setAgentCapabilityCeiling = vi.fn();
vi.mock("@/lib/ai/settings-actions", () => ({
  setAgentCapabilityCeiling: (...a: unknown[]) =>
    setAgentCapabilityCeiling(...a),
}));

import { OrgAgentCeiling } from "@/components/settings/OrgAgentCeiling";

function toggleFor(name: RegExp) {
  return screen.getByRole("switch", { name });
}

/**
 * The org admin's clamp on what ANY personal agent may be granted — the
 * counterpart to `CapabilityToggles` (Task 8's per-agent grant editor), which
 * disables anything outside this set. This control WRITES the ceiling rather
 * than reading it, so — unlike `CapabilityToggles` — every toggle here is
 * always enabled: there is no "outside the ceiling" state for the control
 * that IS the ceiling.
 */
describe("OrgAgentCeiling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders every capability with its plain-language label and one-line consequence", () => {
    render(<OrgAgentCeiling initial={[]} />);

    expect(screen.getByText("Create and update items")).toBeInTheDocument();
    expect(
      screen.getByText(
        "This agent can add items and change field values on boards in its scope.",
      ),
    ).toBeInTheDocument();

    expect(screen.getByText("Create and attach files")).toBeInTheDocument();
    expect(
      screen.getByText(
        "This agent can write documents and attach them to items.",
      ),
    ).toBeInTheDocument();

    expect(screen.getByText("Create board automations")).toBeInTheDocument();
    expect(
      screen.getByText(
        "This agent can create rules that later run on their own.",
      ),
    ).toBeInTheDocument();

    expect(screen.getByText("Log time")).toBeInTheDocument();
    expect(
      screen.getByText("This agent can record time allocations against items."),
    ).toBeInTheDocument();
  });

  it("checks each switch per the current ceiling value", () => {
    render(<OrgAgentCeiling initial={["board.write", "time.log"]} />);

    expect(toggleFor(/create and update items/i)).toHaveAttribute(
      "data-state",
      "checked",
    );
    expect(toggleFor(/log time/i)).toHaveAttribute("data-state", "checked");
    expect(toggleFor(/create and attach files/i)).toHaveAttribute(
      "data-state",
      "unchecked",
    );
    expect(toggleFor(/create board automations/i)).toHaveAttribute(
      "data-state",
      "unchecked",
    );
  });

  it("shows the verbatim scope-of-the-clamp copy", () => {
    render(<OrgAgentCeiling initial={[]} />);
    expect(
      screen.getByText(
        "Agents can never exceed what their owner can already do. This only narrows it further.",
      ),
    ).toBeInTheDocument();
  });

  // Unlike CapabilityToggles, nothing here is disabled by a ceiling — this
  // control IS the ceiling, so every switch stays interactive regardless of
  // the current value.
  it("never disables a switch", () => {
    render(<OrgAgentCeiling initial={["board.write"]} />);
    expect(toggleFor(/create and update items/i)).toBeEnabled();
    expect(toggleFor(/create and attach files/i)).toBeEnabled();
    expect(toggleFor(/create board automations/i)).toBeEnabled();
    expect(toggleFor(/log time/i)).toBeEnabled();
  });

  it("toggling a capability on saves the whole next set", async () => {
    setAgentCapabilityCeiling.mockResolvedValue({
      ok: true,
      data: { capabilities: ["board.write", "time.log"] },
    });
    render(<OrgAgentCeiling initial={["board.write"]} />);

    await userEvent.click(toggleFor(/log time/i));

    expect(setAgentCapabilityCeiling).toHaveBeenCalledWith({
      capabilities: ["board.write", "time.log"],
    });
  });

  it("toggling a capability off saves the set without it", async () => {
    setAgentCapabilityCeiling.mockResolvedValue({
      ok: true,
      data: { capabilities: ["time.log"] },
    });
    render(<OrgAgentCeiling initial={["board.write", "time.log"]} />);

    await userEvent.click(toggleFor(/create and update items/i));

    expect(setAgentCapabilityCeiling).toHaveBeenCalledWith({
      capabilities: ["time.log"],
    });
  });

  it("reverts and shows an error when the save is rejected", async () => {
    setAgentCapabilityCeiling.mockResolvedValue({
      ok: false,
      error: "Only organization admins can change AI settings.",
    });
    render(<OrgAgentCeiling initial={[]} />);

    await userEvent.click(toggleFor(/log time/i));

    await waitFor(() =>
      expect(
        screen.getByText("Only organization admins can change AI settings."),
      ).toBeInTheDocument(),
    );
    expect(toggleFor(/log time/i)).toHaveAttribute("data-state", "unchecked");
  });
});
