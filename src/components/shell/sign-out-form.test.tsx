import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SignOutForm } from "./sign-out-form";
import { signOut } from "@/app/auth/actions";
import { CELEBRATE_ATTR } from "@/components/ui/done-burst";
import {
  THEME_PRESET_ATTR,
  THEME_PRESET_STORAGE_KEY,
  THEME_REACH_ATTR,
  THEME_REACH_STORAGE_KEY,
} from "@/lib/theme/presets";

vi.mock("@/app/auth/actions", () => ({ signOut: vi.fn() }));

const { wipeOfflineData } = vi.hoisted(() => ({
  wipeOfflineData: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/offline/wipe", () => ({ wipeOfflineData }));

const root = document.documentElement;

function resetBrowserState() {
  localStorage.clear();
  root.removeAttribute(THEME_REACH_ATTR);
  root.removeAttribute(THEME_PRESET_ATTR);
  root.removeAttribute(CELEBRATE_ATTR);
}

beforeEach(() => {
  vi.clearAllMocks();
  wipeOfflineData.mockResolvedValue(undefined);
  resetBrowserState();
});

afterEach(() => {
  vi.restoreAllMocks();
  resetBrowserState();
});

describe("SignOutForm", () => {
  it("wipes offline data before signing out", async () => {
    render(<SignOutForm />);
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

  /**
   * Theme reach and the celebration switch are ACCOUNT preferences mirrored
   * onto the device: reach in localStorage (for the no-flash script) and both
   * as `<html>` attributes. The sign-out redirect is a client navigation, so
   * the document — and its attributes — survives it. Left alone, the next
   * person to use this browser inherits the previous account's choices.
   */
  describe("account display preferences", () => {
    function signInAsVividCelebrator() {
      localStorage.setItem(THEME_REACH_STORAGE_KEY, "vivid");
      root.setAttribute(THEME_REACH_ATTR, "vivid");
      root.setAttribute(CELEBRATE_ATTR, "on");
    }

    it("clears the stored reach, the reach attribute and the celebrate attribute", async () => {
      signInAsVividCelebrator();
      render(<SignOutForm />);
      await userEvent.click(screen.getByRole("button", { name: /sign out/i }));

      expect(localStorage.getItem(THEME_REACH_STORAGE_KEY)).toBeNull();
      expect(root.hasAttribute(THEME_REACH_ATTR)).toBe(false);
      expect(root.hasAttribute(CELEBRATE_ATTR)).toBe(false);
    });

    it("has them cleared before signOut() is called — the action redirects away", async () => {
      signInAsVividCelebrator();
      const seen: Record<string, unknown> = {};
      vi.mocked(signOut).mockImplementation(async () => {
        seen.stored = localStorage.getItem(THEME_REACH_STORAGE_KEY);
        seen.reach = root.getAttribute(THEME_REACH_ATTR);
        seen.celebrate = root.getAttribute(CELEBRATE_ATTR);
      });
      render(<SignOutForm />);
      await userEvent.click(screen.getByRole("button", { name: /sign out/i }));

      expect(seen).toEqual({ stored: null, reach: null, celebrate: null });
    });

    it("still clears the attributes and signs out when storage throws", async () => {
      signInAsVividCelebrator();
      vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
        throw new Error("storage disabled");
      });
      render(<SignOutForm />);
      await userEvent.click(screen.getByRole("button", { name: /sign out/i }));

      expect(root.hasAttribute(THEME_REACH_ATTR)).toBe(false);
      expect(root.hasAttribute(CELEBRATE_ATTR)).toBe(false);
      expect(signOut).toHaveBeenCalledTimes(1);
    });

    // Scope guard: the preset has never been cleared at sign-out and this
    // change deliberately leaves that as it was.
    it("leaves the theme preset exactly as it was", async () => {
      signInAsVividCelebrator();
      localStorage.setItem(THEME_PRESET_STORAGE_KEY, "ocean");
      root.setAttribute(THEME_PRESET_ATTR, "ocean");
      render(<SignOutForm />);
      await userEvent.click(screen.getByRole("button", { name: /sign out/i }));

      expect(localStorage.getItem(THEME_PRESET_STORAGE_KEY)).toBe("ocean");
      expect(root.getAttribute(THEME_PRESET_ATTR)).toBe("ocean");
    });
  });
});
