import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_THEME_PRESET,
  DEFAULT_THEME_REACH,
  THEME_PRESET_ATTR,
  THEME_PRESET_STORAGE_KEY,
  THEME_REACH_ATTR,
  THEME_REACH_IDS,
  THEME_REACH_STORAGE_KEY,
} from "./presets";
import { THEME_PRESET_INLINE_SCRIPT } from "./theme-preset-script";

/** Evaluate the script string the way the browser does: as plain code. */
function run(): void {
  new Function(THEME_PRESET_INLINE_SCRIPT)();
}

const root = document.documentElement;

beforeEach(() => {
  localStorage.clear();
  root.removeAttribute(THEME_PRESET_ATTR);
  root.removeAttribute(THEME_REACH_ATTR);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("no-flash inline script: reach", () => {
  for (const id of THEME_REACH_IDS.filter((r) => r !== DEFAULT_THEME_REACH)) {
    it(`stamps data-theme-reach="${id}" from localStorage`, () => {
      localStorage.setItem(THEME_REACH_STORAGE_KEY, id);
      run();
      expect(root.getAttribute(THEME_REACH_ATTR)).toBe(id);
    });
  }

  it("writes no attribute for the default reach", () => {
    localStorage.setItem(THEME_REACH_STORAGE_KEY, DEFAULT_THEME_REACH);
    run();
    expect(root.hasAttribute(THEME_REACH_ATTR)).toBe(false);
  });

  it("writes no attribute when nothing is stored", () => {
    run();
    expect(root.hasAttribute(THEME_REACH_ATTR)).toBe(false);
  });

  it("writes no attribute for a value outside the whitelist", () => {
    localStorage.setItem(THEME_REACH_STORAGE_KEY, '"><script>alert(1)');
    run();
    expect(root.hasAttribute(THEME_REACH_ATTR)).toBe(false);

    // A valid PRESET id is still not a reach id.
    localStorage.setItem(THEME_REACH_STORAGE_KEY, "graphite");
    run();
    expect(root.hasAttribute(THEME_REACH_ATTR)).toBe(false);
  });

  it("swallows a throwing storage and stamps nothing", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    expect(run).not.toThrow();
    expect(root.hasAttribute(THEME_REACH_ATTR)).toBe(false);
    expect(root.hasAttribute(THEME_PRESET_ATTR)).toBe(false);
  });
});

describe("no-flash inline script: preset and reach together", () => {
  it("stamps both attributes from the one script", () => {
    localStorage.setItem(THEME_PRESET_STORAGE_KEY, "graphite");
    localStorage.setItem(THEME_REACH_STORAGE_KEY, "vivid");
    run();
    expect(root.getAttribute(THEME_PRESET_ATTR)).toBe("graphite");
    expect(root.getAttribute(THEME_REACH_ATTR)).toBe("vivid");
  });

  it("still writes no preset attribute for the default or an invalid preset", () => {
    localStorage.setItem(THEME_PRESET_STORAGE_KEY, DEFAULT_THEME_PRESET);
    run();
    expect(root.hasAttribute(THEME_PRESET_ATTR)).toBe(false);

    // A valid REACH id is not a preset id.
    localStorage.setItem(THEME_PRESET_STORAGE_KEY, "vivid");
    run();
    expect(root.hasAttribute(THEME_PRESET_ATTR)).toBe(false);
  });

  it("resolves a removed preset id through the alias map before the whitelist", () => {
    // Literal on purpose: the four removed ids and what each one stamps now.
    for (const [stored, stamped] of [
      ["ocean", "lagoon"],
      ["forest", "tropic"],
      ["ember", "peach"],
      ["rose", "orchid"],
    ]) {
      root.removeAttribute(THEME_PRESET_ATTR);
      localStorage.setItem(THEME_PRESET_STORAGE_KEY, stored);
      run();
      expect(root.getAttribute(THEME_PRESET_ATTR), stored).toBe(stamped);
    }
  });

  it("the alias map applies to the preset only, never to the reach", () => {
    localStorage.setItem(THEME_REACH_STORAGE_KEY, "ocean");
    run();
    expect(root.hasAttribute(THEME_REACH_ATTR)).toBe(false);
  });

  it("an invalid preset does not stop a valid reach from being stamped", () => {
    localStorage.setItem(THEME_PRESET_STORAGE_KEY, "nope");
    localStorage.setItem(THEME_REACH_STORAGE_KEY, "subtle");
    run();
    expect(root.hasAttribute(THEME_PRESET_ATTR)).toBe(false);
    expect(root.getAttribute(THEME_REACH_ATTR)).toBe("subtle");
  });

  it("a preset read that throws does not stop the reach from being stamped", () => {
    const real = Storage.prototype.getItem;
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (
      this: Storage,
      key: string,
    ) {
      if (key === THEME_PRESET_STORAGE_KEY) throw new Error("boom");
      return real.call(this, key);
    });
    localStorage.setItem(THEME_REACH_STORAGE_KEY, "vivid");
    run();
    expect(root.getAttribute(THEME_REACH_ATTR)).toBe("vivid");
  });
});
