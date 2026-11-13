import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const createMyMono = vi.fn();
const updateMyMono = vi.fn();
const removeMyMonoFromBoard = vi.fn();
vi.mock("@/lib/monos/actions", () => ({
  createMyMono: (i: unknown) => createMyMono(i),
  updateMyMono: (i: unknown) => updateMyMono(i),
  removeMyMonoFromBoard: (i: unknown) => removeMyMonoFromBoard(i),
}));

import { MyMonoSettings } from "./MyMonoSettings";

const mono = {
  userId: "m1",
  orgId: "o1",
  ownerId: "u1",
  name: "Nova",
  color: "#7395ff",
  brain: "key" as const,
  keyProvider: "openai" as const,
  lastSeenAt: null,
  createdAt: "t",
};
const BOARD = "33333333-3333-4333-8333-333333333333";

beforeEach(() => vi.clearAllMocks());

describe("MyMonoSettings", () => {
  it("offers to create a Mono when there is none", () => {
    render(<MyMonoSettings mono={null} boards={[]} ownerName="Ada" />);
    expect(
      screen.getByRole("button", { name: "Create my Mono" }),
    ).toBeInTheDocument();
  });

  it("renames, says the brain, and lists boards", async () => {
    const user = userEvent.setup();
    updateMyMono.mockResolvedValue({ ok: true, data: mono });
    render(
      <MyMonoSettings
        mono={mono}
        boards={[{ boardId: BOARD, name: "Launch", accessLevel: "editor" }]}
        ownerName="Ada"
      />,
    );
    expect(
      screen.getByText("Runs on your OpenAI key. Chat with it here."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Launch" })).toHaveAttribute(
      "href",
      `/boards/${BOARD}`,
    );
    const name = screen.getByLabelText("Name");
    await user.clear(name);
    await user.type(name, "Nova Two");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(updateMyMono).toHaveBeenCalledWith({
      name: "Nova Two",
      color: "#7395ff",
    });
  });

  it("shows a generic error when saving throws", async () => {
    const user = userEvent.setup();
    updateMyMono.mockRejectedValue(new Error("boom"));
    render(<MyMonoSettings mono={mono} boards={[]} ownerName="Ada" />);
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Something went wrong. Try again.",
    );
  });

  it("removes the Mono from a board without a page refresh", async () => {
    const user = userEvent.setup();
    removeMyMonoFromBoard.mockResolvedValue({ ok: true, data: undefined });
    render(
      <MyMonoSettings
        mono={mono}
        boards={[{ boardId: BOARD, name: "Launch", accessLevel: "editor" }]}
        ownerName="Ada"
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "Remove Nova from Launch" }),
    );
    expect(removeMyMonoFromBoard).toHaveBeenCalledWith({ boardId: BOARD });
    expect(
      await screen.findByText("Not on any board yet."),
    ).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});
