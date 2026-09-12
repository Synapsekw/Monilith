import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";

/**
 * The content card (`app-shell.tsx`'s authed frame, `ask/layout.tsx`'s
 * full-page chat surface) is the one deliberate exception to "one card
 * radius" — everything else uses `--radius` (`rounded-lg`) directly, never
 * the 1.4x `rounded-xl` step.
 */
const ALLOW = [
  "src/components/app-shell.tsx",
  "src/app/ask/layout.tsx",
  // Not a card: the lit seam is a STROKED COPY of the content card's outline,
  // so it has to declare the same radius — it reads its own computed
  // `borderTopLeftRadius` to build the path that follows the card's corners.
  "src/components/shell/card-seam.tsx",
];

describe("one card radius", () => {
  it("no rounded-xl outside the content card", () => {
    let files: string[] = [];
    try {
      files = execFileSync(
        "grep",
        [
          "-rl",
          "rounded-xl",
          "src",
          "--include=*.tsx",
          "--exclude=*.test.tsx",
        ],
        { encoding: "utf8" },
      )
        .split("\n")
        .filter(Boolean);
    } catch {
      files = [];
    }
    expect(files.filter((f) => !ALLOW.includes(f))).toEqual([]);
  });

  it("no raw shadow-{sm,md,lg,xl,2xl} in app components", () => {
    let files: string[] = [];
    try {
      files = execFileSync(
        "grep",
        [
          "-rlE",
          "\\bshadow-(sm|md|lg|xl|2xl)\\b",
          "src/components",
          "src/app",
          "--include=*.tsx",
        ],
        { encoding: "utf8" },
      )
        .split("\n")
        .filter(Boolean);
    } catch {
      files = [];
    }
    expect(files.filter((f) => !f.startsWith("src/components/ui/"))).toEqual(
      [],
    );
  });
});
