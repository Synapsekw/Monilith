import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserMenu } from "./user-menu";
import { signOut } from "@/app/auth/actions";

vi.mock("@/app/auth/actions", () => ({ signOut: vi.fn() }));

const { wipeOfflineData } = vi.hoisted(() => ({
  wipeOfflineData: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/offline/wipe", () => ({ wipeOfflineData }));

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

  it("wipes offline data before signing out", async () => {
    render(<UserMenu user={{ email: "a@b.co", full_name: "Ada" }} />);
    await userEvent.click(
      screen.getByRole("button", { name: /open user menu/i }),
    );
    await userEvent.click(screen.getByRole("button", { name: /sign out/i }));

    expect(wipeOfflineData).toHaveBeenCalledTimes(1);
    expect(signOut).toHaveBeenCalledTimes(1);

    // Ordering is the substance of this test: a Server Action can't reach
    // IndexedDB or the Cache API, so the wipe MUST complete before signOut()
    // fires (and redirects away). Asserting call counts alone would pass
    // even if the wipe ran after the redirect.
    const wipeOrder = wipeOfflineData.mock.invocationCallOrder[0];
    const signOutOrder = vi.mocked(signOut).mock.invocationCallOrder[0];
    expect(wipeOrder).toBeLessThan(signOutOrder);
  });
});
