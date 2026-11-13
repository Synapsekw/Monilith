import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PeopleEditor } from "./PeopleEditor";

const members = [
  { userId: "u1", fullName: "Ada Owner", email: null, avatarUrl: null },
  {
    userId: "m1",
    fullName: "Nova",
    email: null,
    avatarUrl: null,
    mono: {
      color: "#7395ff",
      ownerId: "u1",
      ownerName: "Ada Owner",
      directable: true,
    },
  },
  {
    userId: "m2",
    fullName: "Pip",
    email: null,
    avatarUrl: null,
    mono: {
      color: "#3fe0a5",
      ownerId: "u2",
      ownerName: "Ben Mate",
      directable: false,
    },
  },
];

describe("PeopleEditor with Monos", () => {
  it("offers the viewer's own Mono and never someone else's", () => {
    render(
      <PeopleEditor
        value={null}
        settings={{}}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
        members={members}
      />,
    );
    expect(screen.getByRole("option", { name: /Nova/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Pip/ })).toBeNull();
    expect(screen.getByText("Agent")).toBeInTheDocument();
  });

  it("still shows another person's Mono when it is already assigned", () => {
    render(
      <PeopleEditor
        value={{ userIds: ["m2"] }}
        settings={{}}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
        members={members}
      />,
    );
    expect(
      screen.getByRole("option", { name: "Unassign Pip" }),
    ).toBeInTheDocument();
  });
});
