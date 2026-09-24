import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const params = { current: new URLSearchParams("tab=stages&stage=build") };
const routerPush = vi.fn();
vi.mock("next/navigation", () => ({
  useSearchParams: () => params.current,
  useRouter: () => ({ push: routerPush }),
}));

import { parseTab, useCommandCenterState } from "./command-center-state";

const LEGACY_TABS = ["overview", "stages", "boards", "people"];

describe("parseTab", () => {
  it("accepts a configured tab id and falls back to the first tab", () => {
    expect(parseTab("people", LEGACY_TABS)).toBe("people");
    expect(parseTab("nope", LEGACY_TABS)).toBe("overview");
    expect(parseTab(null, LEGACY_TABS)).toBe("overview");
  });
});

describe("useCommandCenterState", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/folders/f1?tab=stages&stage=build");
    params.current = new URLSearchParams("tab=stages&stage=build");
  });

  it("reads tab / stage / board from the URL", () => {
    const { result } = renderHook(() => useCommandCenterState(LEGACY_TABS));
    expect(result.current.tab).toBe("stages");
    expect(result.current.stage).toBe("build");
    expect(result.current.board).toBeNull();
  });

  it("writes with history.replaceState and never navigates", () => {
    const replace = vi.spyOn(window.history, "replaceState");
    const push = vi.spyOn(window.history, "pushState");
    const { result } = renderHook(() => useCommandCenterState(LEGACY_TABS));
    act(() => result.current.setStage("qa"));
    expect(replace).toHaveBeenCalledTimes(1);
    expect(String(replace.mock.calls[0][2])).toContain("stage=qa");
    act(() => result.current.setStage(null));
    expect(String(replace.mock.calls[1][2])).not.toContain("stage=");
    act(() => result.current.setTab("overview"));
    expect(String(replace.mock.calls[2][2])).not.toContain("tab="); // default tab is omitted
    expect(push).not.toHaveBeenCalled();
  });
});

describe("useCommandCenterState (config-driven tab ids)", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/folders/f1");
    params.current = new URLSearchParams("");
    routerPush.mockClear();
  });

  it("falls back to the first configured tab when ?tab= names an unknown id", () => {
    params.current = new URLSearchParams("tab=nope");
    const { result } = renderHook(() =>
      useCommandCenterState(["overview", "pipeline"]),
    );
    expect(result.current.tab).toBe("overview");
  });

  it("accepts any configured tab id, not just the legacy four", () => {
    params.current = new URLSearchParams("tab=pipeline");
    const { result } = renderHook(() =>
      useCommandCenterState(["overview", "pipeline"]),
    );
    expect(result.current.tab).toBe("pipeline");
  });

  it("writes the tab id with replaceState and never navigates", () => {
    const { result } = renderHook(() =>
      useCommandCenterState(["overview", "pipeline"]),
    );
    act(() => result.current.setTab("pipeline"));
    expect(window.location.search).toBe("?tab=pipeline");
    expect(routerPush).not.toHaveBeenCalled();
  });

  it("drops the param entirely for the first tab, keeping bare links clean", () => {
    const { result } = renderHook(() =>
      useCommandCenterState(["overview", "pipeline"]),
    );
    act(() => result.current.setTab("pipeline"));
    act(() => result.current.setTab("overview"));
    expect(window.location.search).toBe("");
  });
});
