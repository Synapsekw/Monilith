import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(process.cwd(), "src");

/**
 * Every `mutationFn` in the codebase must refuse to run offline, or a user with
 * no network gets an optimistic patch that silently never persists. Reviewers
 * cannot hold that rule across 16 files and every future one, so it is a test.
 *
 * Regex literals are constructed fresh at each use and none carry the `g` flag
 * into `.test()`. A global regex reused across `.test()` calls advances
 * `lastIndex` between calls and starts skipping matches — that is
 * gotcha-72, which has shipped three times in this repo.
 */
function sourceFiles(): string[] {
  return readdirSync(SRC, { recursive: true, encoding: "utf8" })
    .filter((p) => /\.tsx?$/.test(p) && !/\.(test|spec)\.tsx?$/.test(p))
    .map((p) => join(SRC, p));
}

const MUTATION_FN_ARROW = /mutationFn:\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{/g;

describe("offline mutation guard", () => {
  it("every mutationFn opens with assertOnline()", () => {
    const offenders: string[] = [];

    for (const file of sourceFiles()) {
      const src = readFileSync(file, "utf8");
      if (!src.includes("useMutation")) continue;

      for (const match of src.matchAll(MUTATION_FN_ARROW)) {
        const body = src.slice(match.index + match[0].length);
        const firstStatement = body.trimStart().split("\n")[0].trim();
        if (firstStatement !== "assertOnline();") {
          offenders.push(`${file.slice(SRC.length)} → "${firstStatement}"`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("recognises the form of every declared mutationFn", () => {
    // A guard that silently skips an unrecognised syntax is worse than no
    // guard: it reports green over an unguarded mutation. If someone writes a
    // `mutationFn` this matcher cannot parse, fail here and widen the matcher.
    const mismatches: string[] = [];

    for (const file of sourceFiles()) {
      const src = readFileSync(file, "utf8");
      if (!src.includes("useMutation")) continue;

      const declared = [...src.matchAll(/mutationFn:/g)].length;
      const recognised = [...src.matchAll(MUTATION_FN_ARROW)].length;
      if (declared !== recognised) {
        mismatches.push(
          `${file.slice(SRC.length)}: ${declared} declared, ${recognised} recognised`,
        );
      }
    }

    expect(mismatches).toEqual([]);
  });
});
