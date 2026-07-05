import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserMenu } from "./user-menu";

vi.mock("@/app/auth/actions", () => ({ signOut: vi.fn() }));

beforeEach(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

describe("UserMenu", () => {
  it("no longer offers a Platform admin item", async () => {
    render(<UserMenu user={{ email: "a@b.co", full_name: "Ada" }} />);
    await userEvent.click(
      screen.getByRole("button", { name: /open user menu/i }),
    );
    expect(
      screen.getByRole("menuitem", { name: /settings/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: /platform admin/i }),
    ).not.toBeInTheDocument();
  });
});
