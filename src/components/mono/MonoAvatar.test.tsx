import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MonoAvatar } from "./MonoAvatar";

describe("MonoAvatar", () => {
  it("is an accessible image carrying its mood", () => {
    render(
      <MonoAvatar
        color="#7395ff"
        mood="thinking"
        size={32}
        label="Nova, Danijel's Mono"
      />,
    );
    const img = screen.getByRole("img", { name: "Nova, Danijel's Mono" });
    expect(img.dataset.mood).toBe("thinking");
    expect(img.style.width).toBe("32px");
  });

  it("defaults to idle and survives a missing canvas context (jsdom)", () => {
    render(<MonoAvatar color="#3fe0a5" size={24} label="Pip" />);
    expect(screen.getByRole("img", { name: "Pip" }).dataset.mood).toBe("idle");
  });
});
