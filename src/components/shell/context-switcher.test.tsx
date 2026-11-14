import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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
  it("renders nothing without workspaces when there is only one org", () => {
    const { container } = renderIt({
      workspaces: [],
      orgs: [orgs[0]],
      activeOrgId: "o1",
    });
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing without workspaces and without orgs", () => {
    const { container } = renderIt({ workspaces: [] });
    expect(container).toBeEmptyDOMElement();
  });

  it("multi org with no workspaces: still switchable, org name on the bold line", async () => {
    renderIt({ workspaces: [], orgs, activeOrgId: "o1" });
    const trigger = screen.getByRole("button", {
      name: "Switch organization or workspace",
    });
    expect(trigger).toHaveTextContent("Acme");
    // No workspace → no kicker line above the name.
    expect(document.querySelector(".text-kicker")).toBeNull();
    await userEvent.click(trigger);
    expect(screen.getByText("Organization")).toBeInTheDocument();
    expect(screen.queryByText("Workspaces")).not.toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /globex/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /new workspace/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /manage workspaces/i }),
    ).toHaveAttribute("href", "/settings");
  });

  it("multi org with no workspaces, collapsed: org initial + org tooltip", () => {
    renderIt({ workspaces: [], orgs, activeOrgId: "o2", collapsed: true });
    const trigger = screen.getByRole("button", {
      name: "Switch organization or workspace",
    });
    expect(trigger).toHaveTextContent("G");
    expect(trigger.className).toContain("size-9");
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
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    refresh.mockClear();
    await userEvent.click(
      screen.getByRole("button", { name: /switch organization/i }),
    );
    await userEvent.click(screen.getByRole("menuitem", { name: /growth/i }));
    expect(vi.mocked(setActiveWorkspace)).toHaveBeenCalledWith("w2");
    await waitFor(() => expect(refresh).toHaveBeenCalled());
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

  it("the workspace initial is a solid tile in light, the 18% tint in dark", () => {
    // On the light frame the chip is already a white alpha fill, and a white
    // glyph on an 18% white tile stacked on it measured 3.5–4.2:1. Solid, the
    // tile is white with the brand as its glyph there (and the brand with its
    // own label anywhere else in light) — both pinned ≥ 4.5 by
    // globals.contrast.test.ts. Dark keeps the tint exactly.
    renderIt();
    const tile = screen
      .getByRole("button", { name: "Switch workspace" })
      .querySelector("span")!;
    expect(tile).toHaveTextContent("P");
    const classes = tile.className.split(/\s+/);
    expect(classes).toContain("bg-primary");
    expect(classes).toContain("text-primary-foreground");
    expect(classes).toContain("dark:bg-primary/[0.18]");
    expect(classes).toContain("dark:text-primary");
    expect(classes).not.toContain("bg-primary/[0.18]");
    expect(classes).not.toContain("text-primary");
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
