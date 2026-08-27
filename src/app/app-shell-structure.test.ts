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

const ADMIN_LAYOUT = join(process.cwd(), "src/app/admin/layout.tsx");

/**
 * The `(app)` group layout mounts the app-wide `<Toaster />`. `admin` sits
 * OUTSIDE that group on purpose (its platform-admin guard has to run before any
 * Suspense boundary), which means it inherits nothing from it — so every
 * `toast()` fired from an admin surface rendered into a toaster that was not
 * on the page. `UserRowActions` reports a refused reset/suspend/reactivate that
 * way, and without this mount the failure is silent all over again.
 */
describe("admin route Toaster", () => {
  it("mounts a Toaster, since admin is outside the (app) group that owns one", () => {
    const groupLayout = readFileSync(join(APP_GROUP, "layout.tsx"), "utf8");
    expect(groupLayout).toContain("<Toaster />");

    const adminLayout = readFileSync(ADMIN_LAYOUT, "utf8");
    expect(adminLayout).toContain('from "@/components/ui/sonner"');
    expect(adminLayout).toContain("<Toaster />");
  });
});

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
