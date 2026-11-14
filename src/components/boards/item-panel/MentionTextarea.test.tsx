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

  it("completes a person mid-token on mount and emits a tagged target", async () => {
    const onChange = vi.fn();
    render(
      <MentionTextarea
        value="ping @Al"
        mentions={[]}
        targets={targets}
        onChange={onChange}
      />,
    );
    await userEvent.click(
      await screen.findByRole("button", { name: /alan turing/i }),
    );
    expect(onChange).toHaveBeenCalledWith("ping @Alan Turing ", [
      { kind: "user", userId: "u2" },
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
  it("suggests the author's own Mono as a Mono and records a mono target", () => {
    const onChange = vi.fn();
    render(
      <MentionTextarea
        value=""
        mentions={[]}
        targets={[
          ...targets,
          {
            kind: "mono",
            userId: "m1",
            name: "Nova",
            ownerName: "Ada Lovelace",
            color: "#7395ff",
          },
        ]}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "hi @No", selectionStart: 6 },
    });
    expect(screen.getByText("Agent")).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "Nova, Ada's Mono" }),
    ).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByText("Nova"));
    const [text, mentions] = onChange.mock.calls.at(-1)!;
    expect(text).toContain("@Nova ");
    expect(mentions).toEqual([{ kind: "mono", userId: "m1" }]);
  });
});
