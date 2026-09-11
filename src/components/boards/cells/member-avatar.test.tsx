import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { STATUS_COLORS } from "@/components/ui/status-pill";
import { MemberAvatar, memberColor, memberInitials } from "./member-avatar";

vi.mock("next/image", () => ({
  __esModule: true,
  default: ({ src, alt }: { src: string; alt: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} />
  ),
}));

describe("memberInitials", () => {
  it("takes the first letter of the first two words", () => {
    expect(memberInitials("Ada Lovelace")).toBe("AL");
  });

  it("falls back to a single letter for one-word labels", () => {
    expect(memberInitials("grace@hopper.dev")).toBe("G");
  });
});

describe("memberColor", () => {
  it("is stable for the same user id", () => {
    expect(memberColor("u-42")).toBe(memberColor("u-42"));
  });

  it("always lands on a status token", () => {
    expect(STATUS_COLORS).toContain(memberColor("u-42"));
  });

  it("spreads a workspace's members across several colours", () => {
    const ids = Array.from({ length: 12 }, (_, i) => `1f0c9a${i}-member`);
    const distinct = new Set(ids.map(memberColor));
    expect(distinct.size).toBeGreaterThanOrEqual(4);
  });
});

describe("MemberAvatar", () => {
  it("fills an initials disc with that member's own status colour", () => {
    const { container } = render(
      <MemberAvatar userId="u1" name="Ada Lovelace" avatarUrl={null} />,
    );
    const disc = container.querySelector('[data-slot="member-avatar"]');
    expect(disc).toHaveTextContent("AL");
    expect(disc?.className).toContain(`bg-status-${memberColor("u1")}`);
  });

  it("gives two members different fills when their colours differ", () => {
    const first = memberColor("u1");
    const other = ["u2", "u3", "u4", "u5", "u6", "u7", "u8", "u9"].find(
      (id) => memberColor(id) !== first,
    );
    expect(other).toBeDefined();
    const { container } = render(
      <>
        <MemberAvatar userId="u1" name="Ada" avatarUrl={null} />
        <MemberAvatar userId={other!} name="Grace" avatarUrl={null} />
      </>,
    );
    const discs = container.querySelectorAll('[data-slot="member-avatar"]');
    expect(discs[0].className).not.toBe(discs[1].className);
  });

  it("renders the photo and no initials when the member has an avatar", () => {
    const { container } = render(
      <MemberAvatar
        userId="u1"
        name="Ada Lovelace"
        avatarUrl="https://cdn.example/ada.png"
      />,
    );
    // alt="" — the photo is decorative; the name rides on the cell's label.
    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "https://cdn.example/ada.png",
    );
    expect(container.textContent).not.toContain("AL");
  });
});
