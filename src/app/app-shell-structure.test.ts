import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const APP_GROUP = join(process.cwd(), "src/app/(app)");

/** All `layout.tsx` files at or below `dir`, as absolute paths. */
function layoutFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...layoutFiles(full));
    } else if (entry === "layout.tsx") {
      out.push(full);
    }
  }
  return out;
}

describe("(app) route group shell structure", () => {
  it("mounts AuthenticatedShell exactly once — on the group layout", () => {
    // The group layout exists and is the shell mount.
    const groupLayout = join(APP_GROUP, "layout.tsx");
    expect(existsSync(groupLayout)).toBe(true);
    expect(readFileSync(groupLayout, "utf8")).toContain("AuthenticatedShell");

    // No section layout *under* the group re-mounts the shell. A second mount
    // here would re-introduce the per-section reload bug this group fixes.
    const sectionLayouts = layoutFiles(APP_GROUP).filter(
      (f) => f !== groupLayout,
    );
    for (const file of sectionLayouts) {
      expect(
        readFileSync(file, "utf8"),
        `${file} must not mount AuthenticatedShell — the shared (app) layout already does`,
      ).not.toContain("AuthenticatedShell");
    }
  });
});
