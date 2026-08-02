#!/usr/bin/env node
/**
 * check-hover-tokens.mjs
 *
 * Fails when an OPAQUE surface token (--accent / --muted / --secondary) is used
 * as an interaction STATE. Against a gradient those read as rectangular
 * patches; the --state-* tokens are alpha-on-parent and adapt to whatever is
 * underneath. The same tokens remain correct as resting FILLS, so only state
 * prefixes are flagged.
 *
 * Exit 0 clean, 1 with findings. Written in node so the matcher is unit-
 * testable in the same `pnpm test` gate as everything else (AGENTS.md #4).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const STATE_PREFIX = String.raw`(?:hover|focus|focus-visible|active|data-open|aria-expanded|aria-selected|data-\[[^\]]+\])`;
const OPAQUE = String.raw`(?:accent|muted|secondary)`;
const RE = new RegExp(`${STATE_PREFIX}:bg-${OPAQUE}\\b`, "g");

/** @param {{path: string, source: string}[]} files */
export function findOpaqueHoverStates(files) {
  const hits = [];
  for (const { path, source } of files) {
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
    path: relative(root, path),
    source: readFileSync(path, "utf8"),
  }));
  const hits = findOpaqueHoverStates(files);
  for (const h of hits) {
    console.error(`${h.path}:${h.line}  ${h.klass} → use the --state-* token`);
  }
  if (hits.length) {
    console.error(`\n${hits.length} opaque interaction state(s).`);
    process.exit(1);
  }
  console.log("check-hover-tokens: clean");
}
