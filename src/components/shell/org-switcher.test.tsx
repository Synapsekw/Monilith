import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OrgSwitcher } from "./org-switcher";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const setActiveOrg = vi.fn();
vi.mock("@/lib/org/active-actions", () => ({
  setActiveOrg: (id: string) => setActiveOrg(id),
}));

const orgs = [
  { id: "a", name: "Alpha", timezone: "UTC" },
  { id: "b", name: "Beta", timezone: "UTC" },
];

describe("OrgSwitcher", () => {
  it("renders nothing for a single-org user", () => {
    const { container } = render(
      <OrgSwitcher orgs={[orgs[0]]} activeOrgId="a" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("lists orgs and switches on select", async () => {
    render(<OrgSwitcher orgs={orgs} activeOrgId="a" />);
    await userEvent.click(
      screen.getByRole("button", { name: /switch organization/i }),
    );
    await userEvent.click(screen.getByText("Beta"));
    expect(setActiveOrg).toHaveBeenCalledWith("b");
  });

  it("gives the trigger an alpha-on-parent fill, not an opaque patch", () => {
    render(<OrgSwitcher orgs={orgs} activeOrgId="a" />);
    const trigger = screen.getByRole("button", {
      name: /switch organization/i,
    });
    expect(trigger.className).toContain("bg-chrome-fill");
    expect(trigger.className).not.toMatch(/\bbg-surface-muted\b/);
  });
});
