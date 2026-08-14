import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import {
  AGENT_CAPABILITIES,
  type AgentCapability,
} from "@/lib/agents/capabilities";
import { CapabilityToggles } from "@/components/agents/CapabilityToggles";

const FULL_CEILING: AgentCapability[] = [...AGENT_CAPABILITIES];

function toggleFor(name: RegExp) {
  return screen.getByRole("switch", { name });
}

/**
 * `CapabilityToggles` is a controlled component — `AgentEditor` drives it by
 * feeding `onChange`'s result straight back in as `value`. A harness that
 * does the same is what makes "toggle twice returns to the original set" a
 * real assertion about the round trip, not just about two isolated
 * `onChange` calls.
 */
function Harness({
  initial,
  ceiling = FULL_CEILING,
  onChange,
}: {
  initial: AgentCapability[];
  ceiling?: AgentCapability[];
  onChange?: (next: AgentCapability[]) => void;
}) {
  const [value, setValue] = useState<AgentCapability[]>(initial);
  return (
    <CapabilityToggles
      value={value}
      ceiling={ceiling}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

describe("CapabilityToggles", () => {
  it("renders every capability with its plain-language label and one-line consequence", () => {
    render(<Harness initial={[]} />);

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

  it("explains what an ungranted capability does instead, under the toggles", () => {
    render(<Harness initial={[]} />);
    expect(
      screen.getByText(
        "Anything not granted here is recorded as a proposal for you to approve, instead of being blocked.",
      ),
    ).toBeInTheDocument();
  });

  it("disables a capability outside the org's ceiling and says why", () => {
    const ceiling: AgentCapability[] = AGENT_CAPABILITIES.filter(
      (c) => c !== "files.write",
    );
    render(<Harness initial={[]} ceiling={ceiling} />);

    const filesToggle = toggleFor(/create and attach files/i);
    expect(filesToggle).toBeDisabled();
    expect(
      screen.getByText("Disabled for this organization by an admin."),
    ).toBeInTheDocument();

    // A capability inside the ceiling stays enabled and carries no reason.
    expect(toggleFor(/create and update items/i)).toBeEnabled();
  });

  it("toggles a capability on, then off, calling onChange with the updated set each time", async () => {
    const onChange = vi.fn();
    render(<Harness initial={[]} onChange={onChange} />);
    const toggle = toggleFor(/log time/i);

    await userEvent.click(toggle);
    expect(onChange).toHaveBeenLastCalledWith(["time.log"]);

    await userEvent.click(toggle);
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("leaves the other granted capabilities untouched when toggling one off", async () => {
    const onChange = vi.fn();
    render(
      <Harness initial={["board.write", "time.log"]} onChange={onChange} />,
    );
    await userEvent.click(toggleFor(/log time/i));
    expect(onChange).toHaveBeenLastCalledWith(["board.write"]);
  });

  it("starts a granted-but-now-over-ceiling capability disabled without losing its checked state", () => {
    // A grant made before the org tightened its ceiling: still recorded on the
    // agent, but no longer editable from here — run time is what actually
    // clamps it.
    const ceiling: AgentCapability[] = AGENT_CAPABILITIES.filter(
      (c) => c !== "files.write",
    );
    render(<Harness initial={["files.write"]} ceiling={ceiling} />);
    const filesToggle = toggleFor(/create and attach files/i);
    expect(filesToggle).toBeDisabled();
    expect(filesToggle).toHaveAttribute("data-state", "checked");
  });
});
