import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// next/font/google requires the Next build loader and throws under jsdom. Stub
// the font factories the app uses so components importing a font render in
// tests without per-file mocks.
vi.mock("next/font/google", () => {
  const font = () => ({ className: "font-mock", variable: "", style: {} });
  return { Nunito: font, JetBrains_Mono: font, Geist: font, Geist_Mono: font };
});

// ogl spins up a real WebGL context, which jsdom lacks. Stub the four primitives
// the LightRays hero uses so it mounts (and tears down) under jsdom without a
// GPU. Renderer exposes a fake gl/canvas so the component's append + cleanup run.
vi.mock("ogl", () => {
  class Renderer {
    dpr = 1;
    gl = {
      canvas: document.createElement("canvas"),
      getExtension: () => null,
    };
    setSize() {}
    render() {}
  }
  class Program {}
  class Triangle {}
  class Mesh {}
  return { Renderer, Program, Triangle, Mesh };
});

// jsdom lacks the layout/observer APIs Radix (Popover/DismissableLayer + Floating
// UI) relies on. Provide minimal stubs so portaled floating surfaces can mount.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
Element.prototype.scrollIntoView ??= vi.fn();
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.setPointerCapture ??= () => {};
Element.prototype.releasePointerCapture ??= () => {};

// jsdom lacks matchMedia; Framer Motion's useReducedMotion (and any media-query
// reads) need it. Default to "no match" (motion enabled) so components render.
globalThis.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;

// Radix menu triggers open on `pointerdown` (button 0), not on `click`. In a
// real browser a click is always preceded by pointer events; jsdom's synthetic
// `fireEvent.click` is a bare click, so the menu never opens. Bridge it: when a
// click reaches a Radix dropdown-menu trigger that hasn't already seen a
// pointerdown, synthesize the `pointerdown`/`pointerup` Radix listens for. This
// completes the Radix jsdom shim so component tests can drive the menu via
// `fireEvent.click` without simulating raw pointer sequences.
if (typeof globalThis.PointerEvent === "undefined") {
  // jsdom may lack PointerEvent; fall back to MouseEvent which carries `button`.
  globalThis.PointerEvent = globalThis.MouseEvent as typeof PointerEvent;
}
document.addEventListener(
  "click",
  (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const trigger = target.closest('[data-slot="dropdown-menu-trigger"]');
    if (!trigger || trigger.getAttribute("data-state") !== "closed") return;
    trigger.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
    );
    trigger.dispatchEvent(
      new MouseEvent("pointerup", { bubbles: true, button: 0 }),
    );
  },
  true,
);

// Provide placeholder public env vars so modules that import the validated env
// (e.g. the Supabase server client pulled in transitively by server actions)
// can be loaded in the test environment. These are not real credentials.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://localhost:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key";

afterEach(() => {
  cleanup();
});
