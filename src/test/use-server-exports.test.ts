import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A `"use server"` module may export ONLY async functions.
 *
 * Next.js's server-actions transform enumerates the module's export CLAUSES to
 * decide what to register, and it does so without regard for TypeScript's
 * `type` modifier. So `export type { Foo };` in a `"use server"` file compiles
 * to a registration for a binding the TypeScript pass then erases:
 *
 *   ensureServerEntryExports([decideProposal, getPendingProposals, Foo])
 *   registerServerReference(Foo, "7ffce24e…", null)
 *
 * `Foo` is never declared in that chunk, so evaluating the module throws
 * `ReferenceError: Foo is not defined` — at import time, taking down every
 * route whose action graph includes it. This shipped to production once
 * (2026-08-14) and broke the boards page; `pnpm build` exits 0 because nothing
 * type-checks a generated bare identifier, and no unit test imports a compiled
 * server-action chunk.
 *
 * A type ALIAS DECLARATION (`export type Foo = { … }`) is fine and is used
 * widely in this repo — it is not an export clause, so the transform never
 * sees it. Only the re-export clause form is dangerous.
 *
 * The fix is never to delete the type: put it in a module that is neither
 * `"use server"` nor `server-only` and let both sides import it from there.
 */
const TYPE_EXPORT_CLAUSE = /^\s*export\s+type\s*\{/m;

/** `export { type Foo }` — the same hazard wearing an inline modifier. */
const INLINE_TYPE_EXPORT_CLAUSE = /^\s*export\s*\{[^}]*\btype\s+\w/m;

function isUseServer(source: string): boolean {
  // The directive is only a directive when it leads the file.
  const firstCode = source
    .split("\n")
    .find((l) => l.trim() !== "" && !l.trim().startsWith("//"));
  return (
    firstCode?.trim() === '"use server";' ||
    firstCode?.trim() === "'use server';"
  );
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe('"use server" modules', () => {
  const files = walk(join(process.cwd(), "src"));

  it("finds the server-action modules to check", () => {
    const useServer = files.filter((f) => isUseServer(readFileSync(f, "utf8")));
    // Guards the guard: if the detector silently matched nothing, every
    // assertion below would pass vacuously.
    expect(useServer.length).toBeGreaterThan(5);
  });

  it("never export a type-only clause", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      if (!isUseServer(source)) continue;
      if (
        TYPE_EXPORT_CLAUSE.test(source) ||
        INLINE_TYPE_EXPORT_CLAUSE.test(source)
      ) {
        offenders.push(file.replace(`${process.cwd()}/`, ""));
      }
    }
    expect(offenders).toEqual([]);
  });
});
