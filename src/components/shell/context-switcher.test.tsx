import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ContextSwitcher } from "./context-switcher";
import { setActiveWorkspace } from "@/lib/workspaces/active-actions";
import { setActiveOrg } from "@/lib/org/active-actions";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/lib/workspaces/active-actions", () => ({
  setActiveWorkspace: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/org/active-actions", () => ({
  setActiveOrg: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/workspaces/actions", () => ({ createWorkspace: vi.fn() }));

const ws = [
  { id: "w1", name: "Product" },
  { id: "w2", name: "Growth" },
];
const orgs = [
  { id: "o1", name: "Acme" },
  { id: "o2", name: "Globex" },
];

function renderIt(
  props: Partial<React.ComponentProps<typeof ContextSwitcher>> = {},
) {
  return render(
    <TooltipProvider>
      <ContextSwitcher workspaces={ws} activeWorkspaceId="w1" {...props} />
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

describe("ContextSwitcher", () => {
  it("renders nothing without workspaces", () => {
    const { container } = renderIt({ workspaces: [] });
    expect(container).toBeEmptyDOMElement();
  });

  it("single org: shows the workspace only, labelled 'Switch workspace'", () => {
    renderIt({ orgs: [orgs[0]], activeOrgId: "o1" });
    const trigger = screen.getByRole("button", { name: "Switch workspace" });
    expect(trigger).toHaveTextContent("Product");
    expect(screen.queryByText("Acme")).not.toBeInTheDocument();
  });

  it("multi org: org name as a kicker above the workspace, one trigger, one menu with both groups", async () => {
    renderIt({ orgs, activeOrgId: "o2" });
    const trigger = screen.getByRole("button", {
      name: "Switch organization or workspace",
    });
    expect(screen.getByText("Globex")).toHaveClass("text-kicker");
    expect(trigger).toHaveTextContent("Product");
    await userEvent.click(trigger);
    expect(screen.getByText("Organization")).toBeInTheDocument();
    expect(screen.getByText("Workspaces")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /acme/i })).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /growth/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /new workspace/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /manage workspaces/i }),
    ).toHaveAttribute("href", "/settings");
  });

  it("switches org / workspace and refreshes; the active one is a no-op", async () => {
    renderIt({ orgs, activeOrgId: "o1" });
    await userEvent.click(
      screen.getByRole("button", { name: /switch organization/i }),
    );
    await userEvent.click(screen.getByRole("menuitem", { name: /globex/i }));
    expect(vi.mocked(setActiveOrg)).toHaveBeenCalledWith("o2");
    await userEvent.click(
      screen.getByRole("button", { name: /switch organization/i }),
    );
    await userEvent.click(screen.getByRole("menuitem", { name: /growth/i }));
    expect(vi.mocked(setActiveWorkspace)).toHaveBeenCalledWith("w2");
    await userEvent.click(
      screen.getByRole("button", { name: /switch organization/i }),
    );
    await userEvent.click(screen.getByRole("menuitem", { name: /product/i }));
    expect(vi.mocked(setActiveWorkspace)).toHaveBeenCalledTimes(1);
  });

  it("chip: alpha fill, brightening hairline, no card-lift", () => {
    renderIt();
    const trigger = screen.getByRole("button", { name: "Switch workspace" });
    expect(trigger.className).toContain("bg-chrome-fill");
    expect(trigger.className).toContain("hover:border-border-bright");
    expect(trigger.className).not.toContain("card-lift");
  });

  it("collapsed: a 36px chip with the workspace initial", () => {
    renderIt({ collapsed: true, orgs, activeOrgId: "o1" });
    const trigger = screen.getByRole("button", {
      name: "Switch organization or workspace",
    });
    expect(trigger.className).toContain("size-9");
    expect(trigger).toHaveTextContent("P");
    expect(screen.queryByText("Product")).not.toBeInTheDocument();
  });

  it("opens the New workspace dialog from the menu", async () => {
    renderIt();
    await userEvent.click(
      screen.getByRole("button", { name: "Switch workspace" }),
    );
    await userEvent.click(
      screen.getByRole("menuitem", { name: /new workspace/i }),
    );
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});
