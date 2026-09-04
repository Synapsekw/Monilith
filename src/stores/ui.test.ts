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
    // Absent, not `false` — see the delete-on-reopen test below.
    expect(useUIStore.getState().collapsedSections["boards"]).toBeUndefined();
  });

  it("re-opening a section removes its key rather than persisting false", () => {
    // The map is persisted to localStorage. Both readers test `!map[key]`, so
    // `false` and absent are indistinguishable — writing `false` only grows the
    // stored object forever, one key per section the user ever collapsed.
    useUIStore.getState().toggleSection("boards");
    useUIStore.getState().toggleSection("boards");
    expect("boards" in useUIStore.getState().collapsedSections).toBe(false);
  });

  it("keeps sections independent", () => {
    useUIStore.getState().toggleSection("boards");
    expect(useUIStore.getState().collapsedSections["planning"]).toBeUndefined();
  });
});

describe("collapsedSections — setSection", () => {
  beforeEach(() => {
    useUIStore.setState({ collapsedSections: {} });
  });

  it("is idempotent and does not flip an already-open section", () => {
    // A successful drop into a folder must open it. `toggleSection` would CLOSE
    // a folder that was already open — the whole reason this setter exists.
    useUIStore.getState().setSection("boards", false);
    useUIStore.getState().setSection("boards", false);
    expect(useUIStore.getState().collapsedSections["boards"]).toBeUndefined();

    useUIStore.getState().setSection("boards", true);
    expect(useUIStore.getState().collapsedSections["boards"]).toBe(true);

    useUIStore.getState().setSection("boards", true);
    expect(useUIStore.getState().collapsedSections["boards"]).toBe(true);
  });

  it("re-opening through setSection also removes the key", () => {
    useUIStore.getState().setSection("boards", true);
    useUIStore.getState().setSection("boards", false);
    expect("boards" in useUIStore.getState().collapsedSections).toBe(false);
  });

  it("returns the identical map when the value is already what was asked for", () => {
    useUIStore.getState().setSection("boards", true);
    const before = useUIStore.getState().collapsedSections;
    useUIStore.getState().setSection("boards", true);
    expect(useUIStore.getState().collapsedSections).toBe(before);
  });
});

describe("collapsedSections — pruneSections", () => {
  beforeEach(() => {
    useUIStore.setState({ collapsedSections: {} });
  });

  it("drops folder keys that are not in the keep set", () => {
    useUIStore.setState({
      collapsedSections: { "folder:a": true, "folder:b": true, boards: true },
    });
    useUIStore.getState().pruneSections("folder:", new Set(["a"]));

    const map = useUIStore.getState().collapsedSections;
    expect(map["folder:a"]).toBe(true);
    expect("folder:b" in map).toBe(false);
    // Prefix scoping IS the safety property: an unprefixed section key belongs
    // to NavSection and must never be touched by a folder prune.
    expect(map["boards"]).toBe(true);
  });

  it("removes every folder key when the keep set is empty", () => {
    useUIStore.setState({
      collapsedSections: { "folder:a": true, "folder:b": true, boards: true },
    });
    useUIStore.getState().pruneSections("folder:", new Set());

    const map = useUIStore.getState().collapsedSections;
    expect("folder:a" in map).toBe(false);
    expect("folder:b" in map).toBe(false);
    expect(map["boards"]).toBe(true);
  });

  it("returns the identical object when nothing is stale", () => {
    useUIStore.setState({
      collapsedSections: { "folder:a": true, boards: true },
    });
    const before = useUIStore.getState().collapsedSections;
    useUIStore.getState().pruneSections("folder:", new Set(["a"]));
    // BoardsNav calls this from an effect. A fresh object every time would set
    // state on every commit and loop.
    expect(useUIStore.getState().collapsedSections).toBe(before);
  });
});
