import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SignOutForm } from "./sign-out-form";
import { signOut } from "@/app/auth/actions";

vi.mock("@/app/auth/actions", () => ({ signOut: vi.fn() }));

const { wipeOfflineData } = vi.hoisted(() => ({
  wipeOfflineData: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/offline/wipe", () => ({ wipeOfflineData }));

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
});
