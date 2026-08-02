#!/usr/bin/env node
/**
 * check-px-text.mjs
 *
 * Fails on arbitrary pixel text sizes (`text-[13px]`). They fragment the type
 * scale -- the repo carried 130 of them across 16 distinct values before this
 * guard -- and they do not respond to the user's browser font-size setting.
 * Use a token; the scale runs text-3xs (0.625rem) through text-5xl.
 *
 * ALLOWLIST is for genuinely decorative type whose size is part of a mark or
 * an icon, not part of the reading hierarchy. Add a path only with a comment
 * saying why.
 *
 * Exit 0 clean, 1 with findings.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/** Decorative exceptions — path, plus why it is exempt. */
export const ALLOWLIST = [
  // (empty at introduction — Task 5 left no unavoidable sites)
];

const RE = /text-\[[0-9]+(?:\.[0-9]+)?px\]/g;

/**
 * @param {{path: string, source: string}[]} files
 * @param {string[]} allowlist
 */
export function findPxText(files, allowlist = ALLOWLIST) {
  const exempt = new Set(allowlist.map((p) => p.replace(/\\/g, "/")));
  const hits = [];
  for (const { path, source } of files) {
    if (exempt.has(path.replace(/\\/g, "/"))) continue;
    source.split("\n").forEach((text, i) => {
      for (const m of text.matchAll(RE)) {
        hits.push({ path, line: i + 1, klass: m[0] });
      }
    });
  }
  return hits;
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

// Cross-platform "is this the entry module" check: on Windows,
// `file://${process.argv[1]}` never matches import.meta.url because
// argv[1] uses backslashes and lacks the file:/// prefix.
const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  const root = process.cwd();
  const files = walk(join(root, "src")).map((path) => ({
    path: relative(root, path).replace(/\\/g, "/"),
    source: readFileSync(path, "utf8"),
  }));
  const hits = findPxText(files);
  for (const h of hits) {
    console.error(`${h.path}:${h.line}  ${h.klass} → use a text-* token`);
  }
  if (hits.length) {
    console.error(`\n${hits.length} arbitrary pixel text size(s).`);
    process.exit(1);
  }
  console.log("check-px-text: clean");
}
