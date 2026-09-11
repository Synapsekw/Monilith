import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The sidebar's active state is `bg-state-selected` + the brand edge bar
 * (see sidebar-row.tsx). `bg-primary/80 text-foreground` was the old recipe
 * for board/dashboard rows: white on periwinkle in dark, ~2:1, fails AA.
 * Guard the three folders that render sidebar rows.
 */
const ROOTS = [
  "src/components/shell",
  "src/components/boards",
  "src/components/dashboards",
];

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".tsx") && !p.endsWith(".test.tsx")) out.push(p);
  }
  return out;
}

describe("sidebar active-state guard", () => {
  it("no sidebar component uses the AA-failing bg-primary/80 fill", () => {
    const offenders = ROOTS.flatMap((root) => walk(root)).filter((p) =>
      /bg-primary\/80/.test(readFileSync(p, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
