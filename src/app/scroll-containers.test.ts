import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * Every page-region scroller opts into `scrollbar-gutter: stable`.
 *
 * `globals.css` reserves the gutter for `main, [data-scroll-container]`, and
 * the opt-in hook shipped with ZERO usages — so the board table, the item
 * panel, kanban, gantt, calendar, my-work and the rest all still shift
 * sideways when a list crosses the overflow threshold. This test is what stops
 * that regressing back to zero.
 *
 * The idiom it recognises is this codebase's page-region scroller: `flex-1`
 * plus `overflow-auto` / `overflow-y-auto` on the same className string. That
 * deliberately excludes `max-h` popovers, `h-full` widget bodies and
 * `SheetContent` drawers, where a permanent gutter is dead space.
 *
 * LIMITATION, stated rather than hidden: this compares COUNTS per file, not
 * per element, so it cannot prove the attribute landed on the same JSX node as
 * the classes. It catches deletion, which is the regression that matters; the
 * visual pass catches misplacement.
 */

const SRC = join(process.cwd(), "src");

/** Bounded surfaces that match the idiom but must NOT reserve a gutter. */
const EXEMPT = new Set([
  // A dashboard widget tile, often <200px wide — 10px is a large fraction.
  "src/components/dashboards/widgets/CompletionWidget.tsx",
  // A bounded modal panel with a fixed action list; it does not grow.
  "src/components/ai/actions/QuickAction.tsx",
  // The shell's scroller IS the `<main>` element, so the `main` half of the
  // `main, [data-scroll-container]` selector already reserves its gutter. The
  // attribute would be redundant markup asserting something already true.
  "src/components/app-shell.tsx",
]);

const SCROLLER =
  /className=(?:"|\{`)[^"`]*\bflex-1\b[^"`]*\boverflow-(?:y-)?auto\b[^"`]*(?:"|`\})|className=(?:"|\{`)[^"`]*\boverflow-(?:y-)?auto\b[^"`]*\bflex-1\b[^"`]*(?:"|`\})/g;

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) tsxFiles(full, out);
    else if (full.endsWith(".tsx") && !full.includes(".test.")) out.push(full);
  }
  return out;
}

/**
 * `matchAll` iterates a CLONE of the regex, so the shared `/g` literal's
 * `lastIndex` stays 0 across files. `SCROLLER.test(...)` would not — it
 * mutates `lastIndex` and the next file would be scanned from an arbitrary
 * offset, silently under-reporting. Every read below goes through `matchAll`.
 */
function countScrollers(source: string): number {
  return [...source.matchAll(SCROLLER)].length;
}

export function findUnguardedScrollers(
  files: { path: string; source: string }[],
  exempt: Set<string> = EXEMPT,
): { path: string; scrollers: number; guards: number }[] {
  const hits = [];
  for (const { path, source } of files) {
    if (exempt.has(path)) continue;
    const scrollers = countScrollers(source);
    if (scrollers === 0) continue;
    const guards = [...source.matchAll(/data-scroll-container/g)].length;
    if (guards < scrollers) hits.push({ path, scrollers, guards });
  }
  return hits;
}

describe("page-region scrollers reserve the scrollbar gutter", () => {
  const files = tsxFiles(SRC).map((path) => ({
    path: relative(process.cwd(), path).split(sep).join("/"),
    source: readFileSync(path, "utf8"),
  }));

  it("finds the known scrollers at all — the matcher is not vacuous", () => {
    // A regex that matched nothing would make the next case pass forever.
    const found = files.filter((f) => countScrollers(f.source) > 0);
    const paths = found.map((f) => f.path);
    expect(paths).toContain("src/components/boards/table/BoardTableInner.tsx");
    expect(paths).toContain("src/components/boards/item-panel/ItemPanel.tsx");
    expect(paths.length).toBeGreaterThanOrEqual(20);
  });

  it("leaves no page-region scroller without the opt-in hook", () => {
    expect(findUnguardedScrollers(files)).toEqual([]);
  });

  it("keeps every skeleton in lockstep with the component it mirrors", () => {
    // A gutter on the content but not on its loading fallback turns the fix
    // into the layout shift it exists to prevent.
    const pairs: [string, string][] = [
      [
        "src/components/goals/GoalTree.tsx",
        "src/components/goals/GoalTreeSkeleton.tsx",
      ],
      [
        "src/app/(app)/my-work/page.tsx",
        "src/components/my-work/MyWorkSkeleton.tsx",
      ],
      [
        "src/components/portfolios/PortfolioGrid.tsx",
        "src/components/portfolios/PortfolioGridSkeleton.tsx",
      ],
      [
        "src/components/time/TimeCard.tsx",
        "src/components/time/TimeCardSkeleton.tsx",
      ],
      [
        "src/components/workload/WorkloadGrid.tsx",
        "src/components/workload/WorkloadGridSkeleton.tsx",
      ],
    ];
    const has = (p: string) =>
      files.find((f) => f.path === p)?.source.includes("data-scroll-container");
    for (const [component, skeleton] of pairs) {
      expect(has(component), `${component} must opt in`).toBe(true);
      expect(has(skeleton), `${skeleton} must match ${component}`).toBe(true);
    }
  });
});
