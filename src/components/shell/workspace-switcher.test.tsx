import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "@/components/ui/tooltip";
import { WorkspaceSwitcher } from "./workspace-switcher";
import { setActiveWorkspace } from "@/lib/workspaces/active-actions";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/lib/workspaces/active-actions", () => ({
  setActiveWorkspace: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/workspaces/actions", () => ({ createWorkspace: vi.fn() }));

const ws = [
  { id: "w1", name: "Product" },
  { id: "w2", name: "Growth" },
];

function renderSwitcher(active = "w1") {
  return render(
    <TooltipProvider>
      <WorkspaceSwitcher workspaces={ws} activeWorkspaceId={active} />
    </TooltipProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

describe("WorkspaceSwitcher", () => {
  it("shows the active workspace name", () => {
    renderSwitcher("w2");
    expect(screen.getByText("Growth")).toBeInTheDocument();
  });

  it("switches workspace and refreshes on select", async () => {
    renderSwitcher("w1");
    await userEvent.click(
      screen.getByRole("button", { name: /switch workspace/i }),
    );
    await userEvent.click(screen.getByRole("menuitem", { name: /growth/i }));
    expect(vi.mocked(setActiveWorkspace)).toHaveBeenCalledWith("w2");
  });
});
