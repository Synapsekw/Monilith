import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const SRC = join(process.cwd(), "src");

/**
 * Static import/re-export edges of one file. Deferred `dynamic(() => import())`
 * / bare `import()` calls have no `from` clause and are intentionally NOT
 * matched — that is exactly the code-split boundary we want to stop following.
 * Type-only edges (`import type … from`) are erased at build, so they carry no
 * runtime dependency and are skipped.
 */
export function staticEdges(file: string): string[] {
  const src = readFileSync(file, "utf8");
  const edges: string[] = [];
  const fromRe =
    /(?:^|\n)\s*(?:import|export)\b([^;'"]*?)\bfrom\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = fromRe.exec(src))) {
    if (/^\s*type\b/.test(m[1])) continue; // erased at build
    edges.push(m[2]);
  }
  const sideRe = /(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g;
  while ((m = sideRe.exec(src))) edges.push(m[1]);
  return edges;
}

export function resolveSpec(spec: string, fromFile: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = join(dirname(fromFile), spec);
  else return null; // bare specifier → node_modules, not a first-party file
  const candidates = [
    `${base}.tsx`,
    `${base}.ts`,
    join(base, "index.tsx"),
    join(base, "index.ts"),
  ];
  return candidates.find((c) => existsSync(c)) ?? null;
}

/** First-party files + bare specifiers reachable via STATIC edges from `entry`. */
export function reachable(entry: string): {
  files: Set<string>;
  bare: Set<string>;
} {
  const files = new Set<string>();
  const bare = new Set<string>();
  const stack = [entry];
  while (stack.length) {
    const file = stack.pop() as string;
    if (files.has(file)) continue;
    files.add(file);
    for (const spec of staticEdges(file)) {
      if (spec.startsWith("@/") || spec.startsWith(".")) {
        const resolved = resolveSpec(spec, file);
        if (resolved) stack.push(resolved);
      } else {
        bare.add(spec);
      }
    }
  }
  return { files, bare };
}
