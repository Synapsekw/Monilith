import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlatformAdminMenu } from "./platform-admin-menu";

beforeEach(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

describe("PlatformAdminMenu", () => {
  it("renders nothing for non-admins", () => {
    const { container } = render(<PlatformAdminMenu isPlatformAdmin={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("opens the five admin destinations for admins", async () => {
    render(<PlatformAdminMenu isPlatformAdmin newCount={3} />);
    await userEvent.click(
      screen.getByRole("button", { name: /platform admin/i }),
    );
    expect(screen.getByRole("menuitem", { name: /overview/i })).toHaveAttribute(
      "href",
      "/admin",
    );
    for (const label of ["Organizations", "Users", "Audit log", "Feedback"]) {
      expect(
        screen.getByRole("menuitem", { name: new RegExp(label, "i") }),
      ).toBeInTheDocument();
    }
  });
});
