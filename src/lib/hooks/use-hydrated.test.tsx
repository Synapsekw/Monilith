import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import { renderHook } from "@testing-library/react";
import { useHydrated } from "@/lib/hooks/use-hydrated";

function Probe() {
  return <span>{useHydrated() ? "client" : "server"}</span>;
}

describe("useHydrated", () => {
  it("is false when rendered on the server", () => {
    expect(renderToString(<Probe />)).toContain("server");
  });

  it("is true after a client render", () => {
    const { result } = renderHook(() => useHydrated());
    expect(result.current).toBe(true);
  });
});
