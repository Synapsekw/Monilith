import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ALLOW = [
  "src/components/ui/kicker.tsx",
  "src/components/landing/",
  // Deliberate, documented exception (see the file's own header comment):
  // a colour-fill file-type badge, not the mono eyebrow/kicker recipe —
  // white text on a coloured silhouette, not `text-kicker` on transparent.
  "src/components/boards/FileTypeChip.tsx",
];

const PATTERN = /uppercase[^"]*tracking-|tracking-[^"]*uppercase/;

/** Recursive .tsx walk fallback for environments where `grep` isn't spawnable. */
function findViaFs(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        walk(full);
      } else if (entry.endsWith(".tsx")) {
        const content = readFileSync(full, "utf8");
        if (PATTERN.test(content)) out.push(full.replace(/\\/g, "/"));
      }
    }
  };
  walk(root);
  return out;
}

describe("kickers use <Kicker>", () => {
  it("no hand-rolled uppercase+tracking labels outside the primitive", () => {
    let files: string[];
    try {
      files = execFileSync(
        "grep",
        [
          "-rlE",
          'uppercase[^"]*tracking-|tracking-[^"]*uppercase',
          "src",
          "--include=*.tsx",
        ],
        { encoding: "utf8" },
      )
        .split("\n")
        .filter(Boolean);
    } catch (err) {
      const e = err as { status?: number; stdout?: string };
      if (e.status === 1) {
        files = (e.stdout ?? "").split("\n").filter(Boolean);
      } else {
        files = findViaFs("src");
      }
    }

    const out = files
      .map((f) => f.replace(/\\/g, "/"))
      .filter((f) => !ALLOW.some((a) => f.startsWith(a)))
      .sort();
    expect(out).toEqual([]);
  });
});
