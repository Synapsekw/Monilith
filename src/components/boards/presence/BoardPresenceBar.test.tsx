import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BoardPresenceBar } from "./BoardPresenceBar";

const occ = (id: string, name: string) => ({
  userId: id, name, avatarUrl: null, color: "#2d9cdb", isSelf: false,
});

vi.mock("@/lib/boards/presence-context", () => ({
  useBoardPresenceContext: () => ({
    selfUserId: "self",
    roster: [occ("self", "Me"), ...Array.from({ length: 8 }, (_, i) => occ(`u${i}`, `User ${i}`))],
  }),
}));

describe("BoardPresenceBar", () => {
  it("caps rendered faces and folds the rest into a +k overflow chip", () => {
    render(<BoardPresenceBar maxFaces={5} />);
    expect(screen.getByText("+4")).toBeInTheDocument(); // 9 total - 5 shown
  });
});
