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
 *
 * The skeleton must sit BESIDE the page, not above it. A `loading.tsx` is the
 * Suspense boundary for its own segment, keyed by that segment: a parent's
 * boundary does not re-suspend when you move between two of its children, so
 * `/settings/a` → `/settings/b` blocked on the server even though
 * `settings/loading.tsx` "covered" both pages (gotcha-110). An ancestor's
 * skeleton only helps on the way INTO the section.
 */
describe("route skeletons", () => {
  for (const [name, root] of [
    ["(app)", APP_GROUP],
    ["admin", join(process.cwd(), "src/app/admin")],
  ] as const) {
    it(`gives every ${name} page its own sibling loading.tsx`, () => {
      const pages = pageFiles(root);
      expect(pages.length).toBeGreaterThan(0);
      const uncovered = pages.filter(
        (p) => !existsSync(join(dirname(p), "loading.tsx")),
      );
      expect(
        uncovered,
        `these pages block navigation with no skeleton of their own: ${uncovered.join(", ")}`,
      ).toEqual([]);
    });
  }
});

/**
 * The bold light frame. In light mode the wash is a saturated gradient and
 * `.chrome-scope` (globals.css) re-seeds the generic tokens to white-on-colour
 * for whatever is painted on it; `.chrome-reset` hands the root values back to
 * an opaque surface nested inside. Both are plain class names on elements, so
 * nothing but this test notices when one is dropped in a refactor — and a
 * missing scope is dark text on a dark frame, a missing reset white text on a
 * white card.
 */
describe("bold frame chrome scope", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

  it("every element painted on the wash carries chrome-scope", () => {
    expect(read("src/components/sidebar.tsx")).toMatch(/"chrome-scope /);
    expect(read("src/components/app-shell.tsx")).toMatch(
      /<header className="chrome-scope /,
    );
    const ask = read("src/app/ask/layout.tsx");
    expect(ask).toMatch(/<aside className="chrome-scope /);
    expect(ask).toMatch(/<header className="chrome-scope /);
    expect(read("src/components/boards/dock/BoardDock.tsx")).toMatch(
      /"chrome-scope /,
    );
  });

  it("the wash root and the content card stay outside the scope", () => {
    for (const file of [
      "src/components/app-shell.tsx",
      "src/app/ask/layout.tsx",
    ]) {
      const src = read(file);
      expect(src, file).not.toMatch(
        /className="[^"]*app-wash[^"]*chrome-scope/,
      );
      expect(src, file).not.toMatch(
        /className="[^"]*chrome-scope[^"]*app-wash/,
      );
      expect(src, file).not.toMatch(/<main className="[^"]*chrome-/);
    }
  });

  it.each([
    ["the account avatar fallback", "src/components/shell/user-menu.tsx"],
    ["the dock composer", "src/components/ai/ask/Composer.tsx"],
    ["the thinking tile", "src/components/ai/ask/ThinkingIndicator.tsx"],
    ["the stream-drop card", "src/components/ai/ask/StreamDropNotice.tsx"],
    [
      "the proposed-action card",
      "src/components/ai/actions/ActionConfirmCard.tsx",
    ],
    [
      "the batch-confirm card",
      "src/components/ai/assistant/BatchConfirmCard.tsx",
    ],
    [
      "the intelligence Q&A card",
      "src/components/boards/dock/intelligence/AskComposer.tsx",
    ],
    [
      "the suggestion card",
      "src/components/boards/dock/intelligence/SuggestionCard.tsx",
    ],
    ["the sleeping-Mono card", "src/components/mono/rail/MonoTab.tsx"],
  ])(
    "%s — an opaque surface inside the scope — carries chrome-reset",
    (_name, file) => {
      // On the same class string as the opaque fill it resets for.
      expect(read(file)).toMatch(
        /"chrome-reset [^"]*\bbg-surface\b|"chrome-reset hover:bg-state-hover /,
      );
    },
  );
});
