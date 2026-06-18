// src/components/landing/mono/mono-scene.test.tsx
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
// React 19 (react-jsx) drops the global `JSX` namespace; import it so the
// motion proxy's `keyof JSX.IntrinsicElements` cast below typechecks.
import type { JSX } from "react";

const reduced = { value: false };
const stop = vi.fn();
const animate = vi.fn(() => ({ stop }));
vi.mock("framer-motion", () => ({
  useReducedMotion: () => reduced.value,
  useAnimate: () => [{ current: document.createElement("div") }, animate],
  motion: new Proxy(
    {},
    {
      get:
        (_t, tag: string) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (props: any) => {
          const Tag = tag as keyof JSX.IntrinsicElements;
          return <Tag {...props} />;
        },
    },
  ),
}));
// LightRays pulls in ogl/WebGL; stub it to a plain node here.
vi.mock("@/components/landing/light-rays", () => ({
  LightRays: () => <div data-testid="rays" />,
}));

import { MonoScene } from "./mono-scene";

beforeEach(() => {
  reduced.value = false;
  animate.mockClear();
  stop.mockClear();
  // jsdom lacks document.fonts; provide a resolved ready promise.
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { ready: Promise.resolve() },
  });
});
afterEach(() => {
  reduced.value = false;
});

describe("MonoScene", () => {
  it("renders the hero content (final state) for SSR", () => {
    render(<MonoScene />);
    // The wordmark splits the 2nd O into its own <span> (the animation's O
    // anchor: MON<span ref={oRef}>O</span>LITH), so the default getByText
    // node-text matcher won't see "MONOLITH" on a single element. Match on the
    // wordmark element's full textContent instead.
    expect(
      screen.getByText(
        (_content, el) =>
          el?.textContent === "MONOLITH" && el.tagName === "SPAN",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("The only work surface you need."),
    ).toBeInTheDocument();
  });

  it("runs the animation when motion is allowed", async () => {
    render(<MonoScene />);
    await waitFor(() => expect(animate).toHaveBeenCalled());
  });

  it("does not animate under reduced motion", async () => {
    reduced.value = true;
    render(<MonoScene />);
    // give any async effect a chance to (not) fire
    await new Promise((r) => setTimeout(r, 0));
    expect(animate).not.toHaveBeenCalled();
  });

  it("stops the animation on unmount", async () => {
    const view = render(<MonoScene />);
    await waitFor(() => expect(animate).toHaveBeenCalled());
    view.unmount();
    expect(stop).toHaveBeenCalled();
  });
});
