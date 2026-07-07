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
// countNewFeedback hits supabase (via next/headers cookies()), which has no
// request scope in tests; stub it to a fixed count.
vi.mock("@/lib/feedback/queries", () => ({
  countNewFeedback: vi.fn(async () => 2),
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

  it("passes the session avatar_url through to the account menu avatar", async () => {
    const { requireUser } = await import("@/lib/auth/session");
    vi.mocked(requireUser).mockResolvedValueOnce({
      id: "u1",
      email: "info@synapse-solutions.ai",
      user_metadata: {
        avatar_url:
          "https://ref.supabase.co/storage/v1/object/public/avatars/u1/a.webp",
      },
      app_metadata: {},
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- partial session user for the test
    } as any);
    class LoadedImage {
      complete = true;
      naturalWidth = 1;
      set src(_v: string) {}
      addEventListener() {}
      removeEventListener() {}
    }
    vi.stubGlobal("Image", LoadedImage);

    const { HeaderUserData } = await import("./header-user-data");
    const { container } = render(await HeaderUserData());

    const img = container.querySelector("img");
    expect(img).toHaveAttribute(
      "src",
      "https://ref.supabase.co/storage/v1/object/public/avatars/u1/a.webp",
    );
  });

  it("shows the platform-admin button in the header for admins", async () => {
    const { HeaderUserData } = await import("./header-user-data");
    render(await HeaderUserData());
    await userEvent.click(
      screen.getByRole("button", { name: /platform admin/i }),
    );
    expect(
      await screen.findByRole("menuitem", { name: /overview/i }),
    ).toHaveAttribute("href", "/admin");
  });
});
