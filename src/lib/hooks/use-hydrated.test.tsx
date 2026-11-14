import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import { renderHook, act } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
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

  it("hydrates without a mismatch, then flips to true", async () => {
    const container = document.createElement("div");
    container.innerHTML = renderToString(<Probe />);
    const errors: unknown[] = [];
    await act(async () => {
      hydrateRoot(container, <Probe />, {
        onRecoverableError: (e) => errors.push(e),
      });
    });
    expect(errors).toEqual([]);
    expect(container.textContent).toBe("client");
  });
});
