import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AvatarUploader } from "@/components/settings/avatar-uploader";

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    storage: {
      from: () => ({
        upload: vi.fn().mockResolvedValue({ error: null }),
        remove: vi.fn().mockResolvedValue({ error: null }),
        getPublicUrl: () => ({ data: { publicUrl: "https://x/y.webp" } }),
      }),
    },
  }),
}));
vi.mock("@/lib/profile/actions", () => ({
  updateProfileAvatar: vi.fn().mockResolvedValue({ ok: true }),
  removeProfileAvatar: vi.fn().mockResolvedValue({ ok: true }),
}));

describe("AvatarUploader", () => {
  it("shows the current avatar image when a url is provided", () => {
    render(
      <AvatarUploader
        userId="u1"
        name="Ada Lovelace"
        currentAvatarUrl="https://x/y.webp"
      />,
    );
    expect(screen.getByRole("img")).toHaveAttribute(
      "src",
      expect.stringContaining("y.webp"),
    );
  });

  it("shows a Change and Remove button when an avatar is set", () => {
    render(
      <AvatarUploader
        userId="u1"
        name="Ada Lovelace"
        currentAvatarUrl="https://x/y.webp"
      />,
    );
    expect(screen.getByRole("button", { name: /change/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /remove/i })).toBeInTheDocument();
  });

  it("falls back to initials and hides Remove when there is no avatar", () => {
    render(
      <AvatarUploader
        userId="u1"
        name="Ada Lovelace"
        currentAvatarUrl={null}
      />,
    );
    expect(screen.getByText("AL")).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByRole("button", { name: /remove/i })).toBeNull();
    expect(screen.getByRole("button", { name: /upload/i })).toBeInTheDocument();
  });
});
