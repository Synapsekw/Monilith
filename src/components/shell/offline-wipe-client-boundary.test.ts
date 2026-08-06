import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(process.cwd(), "src");

/**
 * `wipeOfflineData` (@/lib/offline/wipe) touches localStorage, IndexedDB and
 * the Cache API — browser-only. Any module that imports it MUST be a client
 * module, or the import can end up inside a Server Component's render tree:
 * an inline function passed to a DOM prop like `<form action>` there is
 * compiled as a Server Action and executed on the server, where none of
 * those globals exist (see sign-out-form.tsx, split out of the Server
 * Component user-menu.tsx for exactly this reason).
 *
 * No test exercised the server/client boundary itself before, so this
 * reads source directly rather than rendering — the same idiom as
 * mutation-guard.test.ts. Regex literals are constructed fresh at each use
 * and never carry the `g` flag into `.test()`: a global regex reused across
 * `.test()` calls advances `lastIndex` and starts skipping matches
 * (gotcha-72).
 */
function sourceFiles(): string[] {
  return readdirSync(SRC, { recursive: true, encoding: "utf8" })
    .filter((p) => /\.tsx?$/.test(p) && !/\.(test|spec)\.tsx?$/.test(p))
    .map((p) => join(SRC, p));
}

const IMPORTS_WIPE = /from\s+["']@\/lib\/offline\/wipe["']/;
const USE_CLIENT_DIRECTIVE = /^["']use client["'];?\s*$/m;

describe("wipeOfflineData client boundary", () => {
  it('every importer of @/lib/offline/wipe declares "use client"', () => {
    const offenders: string[] = [];

    for (const file of sourceFiles()) {
      const src = readFileSync(file, "utf8");
      if (!IMPORTS_WIPE.test(src)) continue;

      // The directive must be one of the leading statements, not just
      // present anywhere in the file (e.g. in a comment).
      const leading = src.split(/\n/).slice(0, 5).join("\n");
      if (!USE_CLIENT_DIRECTIVE.test(leading)) {
        offenders.push(file.slice(SRC.length));
      }
    }

    expect(offenders).toEqual([]);
  });
});
