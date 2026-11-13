import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { THEME_REACH_ATTR, THEME_REACH_STORAGE_KEY } from "./presets";
import { useThemeReach } from "./use-theme-reach";

const updateProfileThemeReach = vi.fn();
vi.mock("@/lib/profile/actions", () => ({
  updateProfileThemeReach: (input: { themeReach: string }) =>
    updateProfileThemeReach(input),
}));

const root = document.documentElement;

beforeEach(() => {
  vi.clearAllMocks();
  updateProfileThemeReach.mockResolvedValue({ ok: true, data: undefined });
  localStorage.clear();
  root.removeAttribute(THEME_REACH_ATTR);
});

describe("useThemeReach", () => {
  it("starts from the server value when one is passed", () => {
    root.setAttribute(THEME_REACH_ATTR, "vivid");
    const { result } = renderHook(() => useThemeReach("subtle"));
    expect(result.current.reach).toBe("subtle");
  });

  it("falls back to the attribute, then to the default", () => {
    const first = renderHook(() => useThemeReach());
    expect(first.result.current.reach).toBe("tinted");
    first.unmount();

    root.setAttribute(THEME_REACH_ATTR, "vivid");
    const second = renderHook(() => useThemeReach());
    expect(second.result.current.reach).toBe("vivid");
  });

  it("writes the attribute and localStorage before the action resolves", async () => {
    let resolve: (v: { ok: true; data: undefined }) => void = () => {};
    updateProfileThemeReach.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const { result } = renderHook(() => useThemeReach("tinted"));

    act(() => result.current.setReach("vivid"));

    expect(root.getAttribute(THEME_REACH_ATTR)).toBe("vivid");
    expect(localStorage.getItem(THEME_REACH_STORAGE_KEY)).toBe("vivid");
    expect(result.current.reach).toBe("vivid");
    expect(result.current.pending).toBe(true);
    expect(updateProfileThemeReach).toHaveBeenCalledWith({
      themeReach: "vivid",
    });

    await act(async () => resolve({ ok: true, data: undefined }));
    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(result.current.error).toBeNull();
    expect(root.getAttribute(THEME_REACH_ATTR)).toBe("vivid");
  });

  it("removes the attribute for the default reach", async () => {
    root.setAttribute(THEME_REACH_ATTR, "vivid");
    const { result } = renderHook(() => useThemeReach("vivid"));

    await act(async () => result.current.setReach("tinted"));

    expect(root.hasAttribute(THEME_REACH_ATTR)).toBe(false);
    expect(localStorage.getItem(THEME_REACH_STORAGE_KEY)).toBe("tinted");
  });

  it("does not call the action when the value is unchanged", async () => {
    const { result } = renderHook(() => useThemeReach("subtle"));
    await act(async () => result.current.setReach("subtle"));
    expect(updateProfileThemeReach).not.toHaveBeenCalled();
  });

  it("rolls back state, attribute and storage and reports the error on failure", async () => {
    updateProfileThemeReach.mockResolvedValue({
      ok: false,
      error: "Could not update theme.",
    });
    root.setAttribute(THEME_REACH_ATTR, "subtle");
    localStorage.setItem(THEME_REACH_STORAGE_KEY, "subtle");
    const { result } = renderHook(() => useThemeReach("subtle"));

    await act(async () => result.current.setReach("vivid"));

    await waitFor(() =>
      expect(result.current.error).toBe("Could not update theme."),
    );
    expect(result.current.reach).toBe("subtle");
    expect(root.getAttribute(THEME_REACH_ATTR)).toBe("subtle");
    expect(localStorage.getItem(THEME_REACH_STORAGE_KEY)).toBe("subtle");
  });

  it("clears a previous error on the next selection", async () => {
    updateProfileThemeReach.mockResolvedValueOnce({
      ok: false,
      error: "Could not update theme.",
    });
    const { result } = renderHook(() => useThemeReach("tinted"));

    await act(async () => result.current.setReach("vivid"));
    await waitFor(() => expect(result.current.error).not.toBeNull());

    await act(async () => result.current.setReach("subtle"));
    await waitFor(() => expect(result.current.error).toBeNull());
    expect(result.current.reach).toBe("subtle");
  });
});
