import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const params = { current: new URLSearchParams("tab=stages&stage=build") };
vi.mock("next/navigation", () => ({ useSearchParams: () => params.current }));

import { parseTab, useCommandCenterState } from "./command-center-state";

describe("parseTab", () => {
  it("accepts the four tabs and defaults to overview", () => {
    expect(parseTab("people")).toBe("people");
    expect(parseTab("nope")).toBe("overview");
    expect(parseTab(null)).toBe("overview");
  });
});

describe("useCommandCenterState", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/folders/f1?tab=stages&stage=build");
    params.current = new URLSearchParams("tab=stages&stage=build");
  });

  it("reads tab / stage / board from the URL", () => {
    const { result } = renderHook(() => useCommandCenterState());
    expect(result.current.tab).toBe("stages");
    expect(result.current.stage).toBe("build");
    expect(result.current.board).toBeNull();
  });

  it("writes with history.replaceState and never navigates", () => {
    const replace = vi.spyOn(window.history, "replaceState");
    const push = vi.spyOn(window.history, "pushState");
    const { result } = renderHook(() => useCommandCenterState());
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
