import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { AskAiMark } from "./ask-ai-mark";

describe("AskAiMark", () => {
  it("renders a decorative currentColor svg and passes through className", () => {
    const { container } = render(<AskAiMark className="size-4" />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveClass("size-4");
    // slab (slice + body) + the spark diamond = three filled paths.
    expect(svg!.querySelectorAll('path[fill="currentColor"]').length).toBe(3);
  });
});
