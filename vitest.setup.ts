import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// next/font/google requires the Next build loader and throws under jsdom. Stub
// the font factories the app uses so components importing a font render in
// tests without per-file mocks.
vi.mock("next/font/google", () => {
  const font = () => ({ className: "font-mock", variable: "", style: {} });
  return {
    Nunito_Sans: font,
    Nunito: font,
    JetBrains_Mono: font,
    Geist: font,
    Geist_Mono: font,
  };
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

// jsdom lacks DOMMatrix. pdf.js's display/canvas.js module evaluates
// `new DOMMatrix()` at MODULE TOP LEVEL (`const SCALE_MATRIX = new DOMMatrix()`)
// — that line runs the instant `pdfjs-dist` is imported, before any code calls
// page.render(). So even the pure text-extraction path in extract-text.ts
// (which never touches a canvas) throws `DOMMatrix is not defined` on import
// without this. A real 2D affine implementation, not a no-op stub, because
// pdf.js's own transform math (multiplySelf/preMultiplySelf/invertSelf) runs
// on it whenever a document is actually parsed.
if (typeof globalThis.DOMMatrix === "undefined") {
  class DOMMatrixPolyfill {
    a = 1;
    b = 0;
    c = 0;
    d = 1;
    e = 0;
    f = 0;
    constructor(init?: number[]) {
      if (Array.isArray(init) && init.length >= 6) {
        [this.a, this.b, this.c, this.d, this.e, this.f] = init;
      }
    }
    multiplySelf(other: DOMMatrixPolyfill) {
      const { a, b, c, d, e, f } = this;
      this.a = a * other.a + c * other.b;
      this.b = b * other.a + d * other.b;
      this.c = a * other.c + c * other.d;
      this.d = b * other.c + d * other.d;
      this.e = a * other.e + c * other.f + e;
      this.f = b * other.e + d * other.f + f;
      return this;
    }
    preMultiplySelf(other: DOMMatrixPolyfill) {
      const m = new DOMMatrixPolyfill([
        other.a,
        other.b,
        other.c,
        other.d,
        other.e,
        other.f,
      ]).multiplySelf(this);
      ({
        a: this.a,
        b: this.b,
        c: this.c,
        d: this.d,
        e: this.e,
        f: this.f,
      } = m);
      return this;
    }
    translate(tx = 0, ty = 0) {
      return this.multiplySelf(new DOMMatrixPolyfill([1, 0, 0, 1, tx, ty]));
    }
    scale(sx = 1, sy = sx) {
      return this.multiplySelf(new DOMMatrixPolyfill([sx, 0, 0, sy, 0, 0]));
    }
    invertSelf() {
      const { a, b, c, d, e, f } = this;
      const det = a * d - b * c;
      if (det === 0) {
        this.a = this.b = this.c = this.d = this.e = this.f = NaN;
        return this;
      }
      this.a = d / det;
      this.b = -b / det;
      this.c = -c / det;
      this.d = a / det;
      this.e = (c * f - d * e) / det;
      this.f = (b * e - a * f) / det;
      return this;
    }
  }
  globalThis.DOMMatrix = DOMMatrixPolyfill as unknown as typeof DOMMatrix;
}

// `Promise.try` (TC39 stage-4, shipped Chrome 128+/Node 23+) is what pdf.js's
// MessageHandler uses internally once the fake-worker path above is live.
// This repo's Node 22 dev/CI runtime predates it, even though the browsers
// Next 16 ships to have it — polyfill so the real parser runs under test
// rather than the test asserting on a runtime gap the shipped app won't have.
Promise.try ??= function tryPolyfill<T>(
  fn: (...args: unknown[]) => T,
  ...args: unknown[]
) {
  try {
    return Promise.resolve(fn(...args));
  } catch (err) {
    return Promise.reject(err);
  }
} as typeof Promise.try;

// `Uint8Array.prototype.toHex`/`.toBase64` (TC39 stage-4, also newer than this
// repo's Node 22 runtime) are what pdf.js uses to stringify its computed MD5
// document fingerprint — hit on every document load, not just exotic PDF
// features. `fromHex`/`fromBase64`/`setFromHex`/`setFromBase64` are added
// alongside for the same reason `toBase64` is: other pdf.js internals (fonts,
// XFA, signatures) reach for the decode side of this same proposal, and it's
// the same five-line shim either way.
if (typeof Uint8Array.prototype.toHex !== "function") {
  const bytesOf = (u8: Uint8Array) =>
    Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength);
  Uint8Array.prototype.toHex = function () {
    return bytesOf(this).toString("hex");
  };
  Uint8Array.prototype.toBase64 = function () {
    return bytesOf(this).toString("base64");
  };
  Uint8Array.prototype.setFromHex = function (hex: string) {
    const decoded = Buffer.from(hex, "hex");
    const written = Math.min(decoded.length, this.length);
    this.set(decoded.subarray(0, written));
    return { read: written * 2, written };
  };
  Uint8Array.prototype.setFromBase64 = function (b64: string) {
    const decoded = Buffer.from(b64, "base64");
    const written = Math.min(decoded.length, this.length);
    this.set(decoded.subarray(0, written));
    return { read: b64.length, written };
  };
  Uint8Array.fromHex = (hex: string) => new Uint8Array(Buffer.from(hex, "hex"));
  Uint8Array.fromBase64 = (b64: string) =>
    new Uint8Array(Buffer.from(b64, "base64"));
}

// Provide placeholder public env vars so modules that import the validated env
// (e.g. the Supabase server client pulled in transitively by server actions)
// can be loaded in the test environment. These are not real credentials.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://localhost:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key";

afterEach(() => {
  cleanup();
});
