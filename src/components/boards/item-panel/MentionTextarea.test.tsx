import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MentionTextarea } from "@/components/boards/item-panel/MentionTextarea";

const members = [
  { userId: "u1", fullName: "Ada Lovelace" },
  { userId: "u2", fullName: "Alan Turing" },
];

describe("MentionTextarea", () => {
  it("suggests members on @query and records the chosen id", () => {
    const onChange = vi.fn();
    render(
      <MentionTextarea
        value=""
        mentionIds={[]}
        members={members}
        onChange={onChange}
      />,
    );
    const ta = screen.getByRole("textbox");
    fireEvent.change(ta, { target: { value: "hi @Al", selectionStart: 6 } });
    const option = screen.getByText("Alan Turing");
    expect(screen.queryByText("Ada Lovelace")).not.toBeInTheDocument();
    fireEvent.mouseDown(option);
    const [text, ids] = onChange.mock.calls.at(-1)!;
    expect(text).toContain("@Alan Turing");
    expect(ids).toContain("u2");
  });
});
