import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { reachable } from "@/test/static-imports";

const SRC = join(process.cwd(), "src");
const ENTRY = join(SRC, "components/folders/CommandCenter.tsx");
const INNER = join(SRC, "components/boards/gantt/GanttCanvas.tsx");
const TIMELINE_INNER = join(SRC, "components/folders/tabs/TimelineInner.tsx");

// The folder Timeline tab draws the board Gantt canvas (dnd-kit, react-virtual,
// bar + link machinery). It must stay behind the tab's next/dynamic boundary so
// none of it ships in the command center's first paint.
describe("command center first-paint bundle boundary — timeline", () => {
  const { files, bare } = reachable(ENTRY);

  it("does not statically reach GanttCanvas from CommandCenter", () => {
    expect(files.has(INNER)).toBe(false);
  });

  it("does not statically reach the timeline tab body or dnd-kit", () => {
    expect(files.has(TIMELINE_INNER)).toBe(false);
    expect(bare.has("@dnd-kit/core")).toBe(false);
  });

  it("does reach GanttCanvas from the lazily loaded tab body", () => {
    // Proves the guard is live: the edge exists, just past the split point.
    expect(reachable(TIMELINE_INNER).files.has(INNER)).toBe(true);
  });
});
