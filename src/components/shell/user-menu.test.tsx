import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserMenu } from "./user-menu";

// UserMenu is a Server Component; SignOutForm (the "use client" leaf that
// wires wipeOfflineData + signOut, see sign-out-form.test.tsx) is mocked out
// here so this file only exercises the server-safe parts of the menu.
vi.mock("./sign-out-form", () => ({
  SignOutForm: () => <button type="button">Sign out</button>,
}));

// Radix Avatar only mounts <AvatarImage> once its internal probe image reports
// "loaded"; jsdom never fires image load events, so force a resolved image so
// the rendered <img> can be asserted (mirrors real browsers, where a cached
// Supabase avatar resolves immediately).
class LoadedImage {
  complete = true;
  naturalWidth = 1;
  set src(_v: string) {}
  addEventListener() {}
  removeEventListener() {}
}

beforeEach(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
  vi.stubGlobal("Image", LoadedImage);
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

  it("renders the avatar image in the trigger when avatar_url is present", () => {
    const { container } = render(
      <UserMenu
        user={{
          email: "a@b.co",
          full_name: "Ada",
          avatar_url:
            "https://ref.supabase.co/storage/v1/object/public/avatars/u1/a.webp",
        }}
      />,
    );
    // Decorative avatar (alt=""), so query the element directly rather than by role.
    const img = container.querySelector("img");
    expect(img).toHaveAttribute(
      "src",
      "https://ref.supabase.co/storage/v1/object/public/avatars/u1/a.webp",
    );
  });

  it("falls back to the initial when no avatar_url is present", () => {
    const { container } = render(
      <UserMenu user={{ email: "a@b.co", full_name: "Ada" }} />,
    );
    // No image element; the trigger shows the uppercase initial as a fallback.
    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /open user menu/i }),
    ).toHaveTextContent("A");
  });

  it("keeps the fallback disc opaque on hover in light mode", () => {
    // The disc is an opaque surface inside the header's chrome scope, so it
    // carries `chrome-reset` — and inside the reset a hover fill is the root's
    // black 4%. An unprefixed `hover:bg-state-hover` therefore swapped the
    // white disc for a near-transparent one and left a dark initial on the
    // coloured frame. The translucent hover is the DARK look only.
    const { container } = render(
      <UserMenu user={{ email: "a@b.co", full_name: "Ada" }} />,
    );
    const classes = container
      .querySelector('[data-slot="avatar-fallback"]')!
      .className.split(/\s+/);
    expect(classes).toContain("chrome-reset");
    expect(classes).toContain("bg-surface");
    expect(classes).toContain("text-foreground");
    expect(classes).not.toContain("hover:bg-state-hover");
    expect(classes).toContain("dark:hover:bg-state-hover");
  });

  it("renders the sign-out control in the menu", async () => {
    render(<UserMenu user={{ email: "a@b.co", full_name: "Ada" }} />);
    await userEvent.click(
      screen.getByRole("button", { name: /open user menu/i }),
    );
    // The wipe-before-signOut ordering guarantee is asserted against the
    // real SignOutForm in sign-out-form.test.tsx; this only checks UserMenu
    // wires the control in.
    expect(
      screen.getByRole("button", { name: /sign out/i }),
    ).toBeInTheDocument();
  });
});
