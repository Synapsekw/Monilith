import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// next/font/google requires the Next build loader and throws under jsdom. Stub
// the font factories the app uses so components importing a font render in
// tests without per-file mocks.
vi.mock("next/font/google", () => {
  const font = () => ({ className: "font-mock", variable: "", style: {} });
  return { Archivo: font, Geist: font, Geist_Mono: font };
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

// Provide placeholder public env vars so modules that import the validated env
// (e.g. the Supabase server client pulled in transitively by server actions)
// can be loaded in the test environment. These are not real credentials.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://localhost:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key";

afterEach(() => {
  cleanup();
});
