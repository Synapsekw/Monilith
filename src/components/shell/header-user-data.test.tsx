import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/boards",
  useParams: () => ({}),
}));
vi.mock("@/lib/auth/session", () => ({
  requireUser: vi.fn(async () => ({
    id: "u1",
    email: "info@synapse-solutions.ai",
    user_metadata: {},
    app_metadata: {},
  })),
}));
vi.mock("@/lib/platform/guard", () => ({
  isPlatformAdminCached: vi.fn(async () => true),
}));
// NotificationsBell hits realtime/supabase; stub to a marker.
vi.mock("@/components/notifications/NotificationsBell", () => ({
  NotificationsBell: ({ userId }: { userId: string }) => (
    <div>bell:{userId}</div>
  ),
}));

beforeEach(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

describe("HeaderUserData", () => {
  it("renders the notifications bell for the current user", async () => {
    const { HeaderUserData } = await import("./header-user-data");
    render(await HeaderUserData());
    expect(screen.getByText("bell:u1")).toBeInTheDocument();
  });

  it("shows the platform-admin link in the user menu for admins", async () => {
    const { HeaderUserData } = await import("./header-user-data");
    render(await HeaderUserData());
    await userEvent.click(
      screen.getByRole("button", { name: /open user menu/i }),
    );
    expect(
      await screen.findByRole("menuitem", { name: /platform admin/i }),
    ).toHaveAttribute("href", "/admin");
  });
});
