import { beforeEach, describe, expect, it } from "vitest";
import { useUIStore } from "./ui";

describe("useUIStore", () => {
  beforeEach(() => {
    useUIStore.setState({ commandOpen: false, sidebarCollapsed: false });
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

  it("defaults the sidebar to expanded", () => {
    expect(useUIStore.getState().sidebarCollapsed).toBe(false);
  });

  it("toggles the sidebar collapsed state", () => {
    useUIStore.getState().toggleSidebar();
    expect(useUIStore.getState().sidebarCollapsed).toBe(true);
    useUIStore.getState().toggleSidebar();
    expect(useUIStore.getState().sidebarCollapsed).toBe(false);
  });

  it("sets the sidebar collapsed state explicitly", () => {
    useUIStore.getState().setSidebarCollapsed(true);
    expect(useUIStore.getState().sidebarCollapsed).toBe(true);
  });
});

describe("useUIStore create-dialog flags", () => {
  beforeEach(() => {
    useUIStore.setState({ newBoardOpen: false, newDashboardOpen: false });
  });

  it("setNewBoardOpen toggles newBoardOpen", () => {
    useUIStore.getState().setNewBoardOpen(true);
    expect(useUIStore.getState().newBoardOpen).toBe(true);
    useUIStore.getState().setNewBoardOpen(false);
    expect(useUIStore.getState().newBoardOpen).toBe(false);
  });

  it("setNewDashboardOpen toggles newDashboardOpen", () => {
    useUIStore.getState().setNewDashboardOpen(true);
    expect(useUIStore.getState().newDashboardOpen).toBe(true);
  });
});

describe("useUIStore ask-pulse flag", () => {
  beforeEach(() => {
    useUIStore.setState({ askPulseOpen: false });
  });

  it("defaults askPulseOpen to closed", () => {
    expect(useUIStore.getState().askPulseOpen).toBe(false);
  });

  it("setAskPulseOpen toggles askPulseOpen", () => {
    useUIStore.getState().setAskPulseOpen(true);
    expect(useUIStore.getState().askPulseOpen).toBe(true);
    useUIStore.getState().setAskPulseOpen(false);
    expect(useUIStore.getState().askPulseOpen).toBe(false);
  });
});

describe("collapsedSections", () => {
  beforeEach(() => {
    useUIStore.setState({ collapsedSections: {} });
  });

  it("defaults a section to open (absent key)", () => {
    expect(useUIStore.getState().collapsedSections["boards"]).toBeUndefined();
  });

  it("toggleSection flips a section collapsed then open", () => {
    useUIStore.getState().toggleSection("boards");
    expect(useUIStore.getState().collapsedSections["boards"]).toBe(true);
    useUIStore.getState().toggleSection("boards");
    expect(useUIStore.getState().collapsedSections["boards"]).toBe(false);
  });

  it("keeps sections independent", () => {
    useUIStore.getState().toggleSection("boards");
    expect(useUIStore.getState().collapsedSections["planning"]).toBeUndefined();
  });
});
