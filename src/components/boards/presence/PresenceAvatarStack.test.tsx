import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PresenceAvatarStack } from "./PresenceAvatarStack";
import type { RosterOccupant } from "@/lib/boards/presence-types";

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    const { src, alt, width, height } = props as {
      src: string;
      alt: string;
      width: number;
      height: number;
    };
    // eslint-disable-next-line @next/next/no-img-element -- jsdom passthrough stub for next/image
    return <img src={src} alt={alt} width={width} height={height} />;
  },
}));

function occ(id: string, name: string): RosterOccupant {
  return { userId: id, name, avatarUrl: null, color: "#888", isSelf: false };
}

function occWithAvatar(
  id: string,
  name: string,
  avatarUrl: string,
): RosterOccupant {
  return { userId: id, name, avatarUrl, color: "#888", isSelf: false };
}

describe("PresenceAvatarStack", () => {
  it("renders nothing when there are no occupants", () => {
    const { container } = render(
      <PresenceAvatarStack occupants={[]} ariaLabel="People" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders a face per occupant up to maxFaces and a +k overflow chip", () => {
    const occupants = [
      occ("1", "Ann"),
      occ("2", "Bob"),
      occ("3", "Cy"),
      occ("4", "Dee"),
    ];
    render(
      <PresenceAvatarStack
        occupants={occupants}
        ariaLabel="People"
        maxFaces={2}
      />,
    );
    expect(screen.getByLabelText("People")).toBeInTheDocument();
    // 2 faces shown, remaining 2 collapse to "+2"
    expect(screen.getByLabelText("2 more people")).toHaveTextContent("+2");
  });

  it("renders an avatar image with fixed dimensions when avatarUrl is provided", () => {
    const { container } = render(
      <PresenceAvatarStack
        occupants={[occWithAvatar("1", "Ann", "https://x/ann.png")]}
        ariaLabel="People"
      />,
    );
    const img = container.querySelector("img");
    expect(img).toHaveAttribute("src", "https://x/ann.png");
    expect(img?.getAttribute("width")).toBeTruthy();
    expect(img?.getAttribute("height")).toBeTruthy();
  });

  it("falls back to initials when avatarUrl is null", () => {
    render(
      <PresenceAvatarStack
        occupants={[occ("1", "Ann Smith")]}
        ariaLabel="People"
      />,
    );
    expect(screen.getByText("AS")).toBeInTheDocument();
  });
});
