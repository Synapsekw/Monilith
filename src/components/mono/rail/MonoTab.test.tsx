import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useMyMonoStore } from "@/stores/my-mono";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const createMyMono = vi.fn();
const addMyMonoToBoard = vi.fn();
const removeMyMonoFromBoard = vi.fn();
vi.mock("@/lib/monos/actions", () => ({
  createMyMono: (i: unknown) => createMyMono(i),
  addMyMonoToBoard: (i: unknown) => addMyMonoToBoard(i),
  removeMyMonoFromBoard: (i: unknown) => removeMyMonoFromBoard(i),
}));
const loadMyMonoThread = vi.fn();
vi.mock("@/lib/monos/thread-actions", () => ({
  loadMyMonoThread: () => loadMyMonoThread(),
}));
const askChatProps = vi.fn();
vi.mock("@/components/ai/ask/AskChat", () => ({
  AskChat: (p: Record<string, unknown>) => {
    askChatProps(p);
    return <div data-testid="ask-chat" />;
  },
}));

import { MonoTab } from "./MonoTab";

const BOARD = "33333333-3333-4333-8333-333333333333";
const mono = (brain: "none" | "key") => ({
  userId: "m1",
  orgId: "o1",
  ownerId: "u1",
  name: "Nova",
  color: "#7395ff",
  brain,
  keyProvider: brain === "key" ? ("anthropic" as const) : null,
  lastSeenAt: null,
  createdAt: "t",
});

beforeEach(() => {
  vi.clearAllMocks();
  useMyMonoStore.setState({ threads: {}, membership: {} });
  loadMyMonoThread.mockResolvedValue({
    ok: true,
    data: { conversationId: "c1", messages: [] },
  });
});

describe("MonoTab", () => {
  it("first open: name and colour, then creates the Mono", async () => {
    const user = userEvent.setup();
    createMyMono.mockResolvedValue({ ok: true, data: mono("none") });
    render(
      <MonoTab
        boardId={BOARD}
        initialMono={null}
        initialOnBoard={false}
        ownerName="Ada Owner"
      />,
    );
    await user.type(screen.getByLabelText("Name"), "Nova");
    await user.click(screen.getByRole("button", { name: "Create my Mono" }));
    expect(createMyMono).toHaveBeenCalledWith({
      name: "Nova",
      color: "#7395ff",
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Asleep")).toBeInTheDocument();
  });

  it("asleep: a Wake up card linking to the API key settings, no chat", () => {
    render(
      <MonoTab
        boardId={BOARD}
        initialMono={mono("none")}
        initialOnBoard={false}
        ownerName="Ada Owner"
      />,
    );
    expect(
      screen.getByRole("link", { name: "Add an API key" }),
    ).toHaveAttribute("href", "/settings/ai");
    expect(screen.queryByTestId("ask-chat")).toBeNull();
    expect(loadMyMonoThread).not.toHaveBeenCalled();
    expect(
      screen.getByText("Only you can chat with, assign or @mention it."),
    ).toBeInTheDocument();
  });

  it("awake: loads its thread once and chats as the Mono", async () => {
    const { unmount } = render(
      <MonoTab
        boardId={BOARD}
        initialMono={mono("key")}
        initialOnBoard
        ownerName="Ada Owner"
      />,
    );
    await screen.findByTestId("ask-chat");
    expect(askChatProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ monoId: "m1", conversationId: "c1" }),
    );
    expect(
      screen.getByText("Runs on your Anthropic key. Chat with it here."),
    ).toBeInTheDocument();
    unmount();
    render(
      <MonoTab
        boardId={BOARD}
        initialMono={mono("key")}
        initialOnBoard
        ownerName="Ada Owner"
      />,
    );
    await screen.findByTestId("ask-chat");
    expect(loadMyMonoThread).toHaveBeenCalledTimes(1);
  });

  it("adds and removes the Mono on this board", async () => {
    const user = userEvent.setup();
    addMyMonoToBoard.mockResolvedValue({ ok: true, data: undefined });
    removeMyMonoFromBoard.mockResolvedValue({ ok: true, data: undefined });
    render(
      <MonoTab
        boardId={BOARD}
        initialMono={mono("key")}
        initialOnBoard={false}
        ownerName="Ada Owner"
      />,
    );
    await user.click(screen.getByRole("button", { name: "Add to this board" }));
    await waitFor(() =>
      expect(addMyMonoToBoard).toHaveBeenCalledWith({ boardId: BOARD }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Remove from this board" }),
    );
    expect(removeMyMonoFromBoard).toHaveBeenCalledWith({ boardId: BOARD });
  });
});
