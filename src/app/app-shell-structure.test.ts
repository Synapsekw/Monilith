import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
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

/** All `page.tsx` files at or below `dir`, as absolute paths. */
function pageFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...pageFiles(full));
    } else if (entry === "page.tsx") {
      out.push(full);
    }
  }
  return out;
}

/**
 * The nearest `loading.tsx` at or above `pageFile`, stopping at `root`.
 * A `loading.tsx` is the Suspense boundary for its whole subtree, so a
 * settings subsection is covered by `settings/loading.tsx` — the invariant is
 * "an ancestor has one", not "a sibling has one".
 */
function nearestLoading(pageFile: string, root: string): string | null {
  let dir = dirname(pageFile);
  for (;;) {
    const candidate = join(dir, "loading.tsx");
    if (existsSync(candidate)) return candidate;
    if (dir === root) return null;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Cache Components (`cacheComponents: true`) validates every Page segment in
 * dev. These pages all await Supabase in the page body, which is only legal
 * because `loading.tsx` wraps the segment in a Suspense boundary — that is
 * Pulse's chosen instant-nav mechanism (gotcha-48: `instant` itself is off,
 * because the shell reads `useSearchParams()` pervasively for gotcha-09).
 *
 * Note that `instant = false` on `admin/layout.tsx` opts out the LAYOUT
 * segment only; it does not cover the pages beneath it. The whole `/admin`
 * section shipped without a single `loading.tsx` and every route logged a
 * blocking-prerender-dynamic error on navigation — this test is the guard.
 */
describe("route skeletons", () => {
  for (const [name, root] of [
    ["(app)", APP_GROUP],
    ["admin", join(process.cwd(), "src/app/admin")],
  ] as const) {
    it(`covers every ${name} page with a loading.tsx at or above it`, () => {
      const pages = pageFiles(root);
      expect(pages.length).toBeGreaterThan(0);
      const uncovered = pages.filter((p) => nearestLoading(p, root) === null);
      expect(
        uncovered,
        `these pages block navigation with no skeleton: ${uncovered.join(", ")}`,
      ).toEqual([]);
    });
  }

  it("gives each admin route its own skeleton, not the overview's", () => {
    // The overview fallback (stat cards + two panels) is wrong for a list or a
    // detail page, so inheriting it would be worse than the geometry mismatch
    // it fixes. Every admin segment that owns a page owns a fallback.
    const adminRoot = join(process.cwd(), "src/app/admin");
    for (const page of pageFiles(adminRoot)) {
      const sibling = join(dirname(page), "loading.tsx");
      expect(existsSync(sibling), `${page} has no sibling loading.tsx`).toBe(
        true,
      );
    }
  });
});
