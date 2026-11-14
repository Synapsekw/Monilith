import { Suspense } from "react";
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  THEME_PRESET_ATTR,
  THEME_PRESET_STORAGE_KEY,
  THEME_REACH_ATTR,
  THEME_REACH_STORAGE_KEY,
  type ThemePresetId,
  type ThemeReachId,
} from "@/lib/theme/presets";
import { ThemePresetSync } from "./theme-preset-sync";

const root = document.documentElement;

async function mount(preset: ThemePresetId, reach: ThemeReachId) {
  const presetPromise = Promise.resolve(preset);
  const reachPromise = Promise.resolve(reach);
  await act(async () => {
    render(
      <Suspense fallback={null}>
        <ThemePresetSync preset={presetPromise} reach={reachPromise} />
      </Suspense>,
    );
  });
}

beforeEach(() => {
  localStorage.clear();
  root.removeAttribute(THEME_PRESET_ATTR);
  root.removeAttribute(THEME_REACH_ATTR);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ThemePresetSync", () => {
  it("stamps the server preset and reach and stores both", async () => {
    await mount("graphite", "vivid");

    expect(root.getAttribute(THEME_PRESET_ATTR)).toBe("graphite");
    expect(root.getAttribute(THEME_REACH_ATTR)).toBe("vivid");
    expect(localStorage.getItem(THEME_PRESET_STORAGE_KEY)).toBe("graphite");
    expect(localStorage.getItem(THEME_REACH_STORAGE_KEY)).toBe("vivid");
  });

  it("lets the server reach win over a stale device value", async () => {
    localStorage.setItem(THEME_REACH_STORAGE_KEY, "vivid");
    root.setAttribute(THEME_REACH_ATTR, "vivid");

    await mount("keystone", "subtle");

    expect(root.getAttribute(THEME_REACH_ATTR)).toBe("subtle");
    expect(localStorage.getItem(THEME_REACH_STORAGE_KEY)).toBe("subtle");
  });

  it("removes the reach attribute for the default but still stores it", async () => {
    localStorage.setItem(THEME_REACH_STORAGE_KEY, "vivid");
    root.setAttribute(THEME_REACH_ATTR, "vivid");

    await mount("keystone", "tinted");

    expect(root.hasAttribute(THEME_REACH_ATTR)).toBe(false);
    expect(localStorage.getItem(THEME_REACH_STORAGE_KEY)).toBe("tinted");
  });

  it("still applies both attributes when storage throws", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });

    await mount("aurora", "subtle");

    expect(root.getAttribute(THEME_PRESET_ATTR)).toBe("aurora");
    expect(root.getAttribute(THEME_REACH_ATTR)).toBe("subtle");
  });
});
