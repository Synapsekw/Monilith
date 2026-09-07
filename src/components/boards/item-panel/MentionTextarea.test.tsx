import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MentionTextarea } from "@/components/boards/item-panel/MentionTextarea";
import type { MentionTarget } from "@/lib/collaboration/mentions";

const targets: MentionTarget[] = [
  { kind: "user", userId: "u1", fullName: "Ada Lovelace" },
  { kind: "user", userId: "u2", fullName: "Alan Turing" },
];

describe("MentionTextarea", () => {
  it("suggests members on @query and records the chosen target", () => {
    const onChange = vi.fn();
    render(
      <MentionTextarea
        value=""
        mentions={[]}
        targets={targets}
        onChange={onChange}
      />,
    );
    const ta = screen.getByRole("textbox");
    fireEvent.change(ta, { target: { value: "hi @Al", selectionStart: 6 } });
    const option = screen.getByText("@Alan Turing");
    expect(screen.queryByText("@Ada Lovelace")).not.toBeInTheDocument();
    fireEvent.mouseDown(option);
    const [text, mentions] = onChange.mock.calls.at(-1)!;
    expect(text).toContain("@Alan Turing");
    expect(mentions).toEqual([{ kind: "user", userId: "u2" }]);
  });

  it("completes an agent by handle and emits a tagged target", async () => {
    const onChange = vi.fn();
    render(
      <MentionTextarea
        value="ping @op"
        mentions={[]}
        targets={[
          { kind: "agent", agentId: "a1", handle: "ops", name: "Ops Chaser" },
        ]}
        onChange={onChange}
      />,
    );
    await userEvent.click(await screen.findByRole("button", { name: /ops/i }));
    expect(onChange).toHaveBeenCalledWith("ping @ops ", [
      { kind: "agent", agentId: "a1" },
    ]);
  });

  it("keeps an already-recorded target and does not duplicate it", () => {
    const onChange = vi.fn();
    render(
      <MentionTextarea
        value="hi @Ada Lovelace and @Al"
        mentions={[{ kind: "user", userId: "u1" }]}
        targets={targets}
        onChange={onChange}
      />,
    );
    fireEvent.mouseDown(screen.getByText("@Alan Turing"));
    const [, mentions] = onChange.mock.calls.at(-1)!;
    expect(mentions).toEqual([
      { kind: "user", userId: "u1" },
      { kind: "user", userId: "u2" },
    ]);
  });
});
