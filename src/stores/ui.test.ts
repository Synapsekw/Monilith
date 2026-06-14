import { beforeEach, describe, expect, it } from "vitest";
import { useUIStore } from "./ui";

describe("useUIStore", () => {
  beforeEach(() => {
    useUIStore.setState({ commandOpen: false });
  });

  it("defaults the command palette to closed", () => {
    expect(useUIStore.getState().commandOpen).toBe(false);
  });

  it("toggles the command palette", () => {
    useUIStore.getState().toggleCommand();
    expect(useUIStore.getState().commandOpen).toBe(true);
    useUIStore.getState().toggleCommand();
    expect(useUIStore.getState().commandOpen).toBe(false);
  });

  it("sets the command palette open state explicitly", () => {
    useUIStore.getState().setCommandOpen(true);
    expect(useUIStore.getState().commandOpen).toBe(true);
  });
});
