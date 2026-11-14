import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MonoAvatar } from "./MonoAvatar";
import { monoPalette } from "./mono-palette";
import { MONO_MOODS, drawMono } from "./mono-renderer";

/** A 2D context that accepts every call and property the renderer uses. */
function fakeContext(): CanvasRenderingContext2D {
  const gradient = { addColorStop: () => undefined };
  const props: Record<string | symbol, unknown> = {};
  return new Proxy(props, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return (..._args: unknown[]) =>
        typeof prop === "string" && prop.startsWith("create")
          ? gradient
          : undefined;
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

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

  it("falls back to the default colour instead of throwing on a bad one", () => {
    expect(() =>
      render(<MonoAvatar color="not-a-colour" size={24} label="Odd" />),
    ).not.toThrow();
    expect(screen.getByRole("img", { name: "Odd" })).toBeInTheDocument();
  });

  it("draws and animates without matchMedia or IntersectionObserver", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      fakeContext() as never,
    );
    vi.stubGlobal("matchMedia", undefined);
    vi.stubGlobal("IntersectionObserver", undefined);
    const { unmount } = render(
      <MonoAvatar color="#ff8a4c" mood="hello" size={64} label="Ember" />,
    );
    expect(screen.getByRole("img", { name: "Ember" })).toBeInTheDocument();
    unmount();
  });
});

describe("drawMono", () => {
  it("draws every mood at several moments without throwing", () => {
    const palette = monoPalette("#a77bff");
    expect(MONO_MOODS).toHaveLength(7);
    for (const mood of MONO_MOODS)
      for (const t of [0, 1.3, 3.1])
        for (const blink of [0, 0.08])
          expect(() =>
            drawMono(fakeContext(), 96, 102, mood, t, blink, palette),
          ).not.toThrow();
  });
});
