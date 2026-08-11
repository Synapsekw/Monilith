import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AI_FEATURES } from "@/lib/ai/model-map";

/**
 * Cross-cutting guards that no single call site's test can enforce.
 *
 * These are SOURCE SCANS on purpose. Both defects they cover are invisible to
 * a per-file unit test, to `tsc`, and to `next build`:
 *
 *  1. A raw Anthropic `messages.*` call that omits `thinking`. Omission is not
 *     "no thinking" on a Sonnet-tier model — it means ADAPTIVE thinking at
 *     effort "high", and `max_tokens` caps thinking PLUS response text. A
 *     tight budget then yields stop_reason "max_tokens" with no text/tool_use
 *     block, which every call site here treats as an empty-but-successful
 *     result. Redefining the shared model constant silently switched six call
 *     sites into that state at once.
 *
 *  2. A `feature:` string handed to runAi that the model map does not route.
 *     model-map.test.ts iterates the map's OWN keys, so it can only prove the
 *     map is internally consistent — it cannot see a feature the map claims to
 *     route but that no call site ever asks for, nor a call site metering a
 *     feature the map has never heard of.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
      continue;
    }
    if (!entry.endsWith(".ts") && !entry.endsWith(".tsx")) continue;
    if (entry.includes(".test.")) continue;
    out.push(full);
  }
  return out;
}

const SOURCE_FILES = walk(SRC).map((f) => ({
  path: relative(SRC, f).split(sep).join("/"),
  text: readFileSync(f, "utf8"),
}));

/**
 * Span of the object literal that starts at `open` (the index of its `{`),
 * found by brace matching. Good enough for these call sites — none of them
 * pass a string literal containing an unbalanced brace.
 */
function balancedFrom(
  text: string,
  open: number,
  opener: string,
  closer: string,
): string {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === opener) depth++;
    else if (text[i] === closer) {
      depth--;
      if (depth === 0) return text.slice(open, i + 1);
    }
  }
  return text.slice(open);
}

function objectLiteralAt(text: string, open: number): string {
  return balancedFrom(text, open, "{", "}");
}

describe("every raw Anthropic message call states `thinking` explicitly", () => {
  // Only files that actually talk to the Anthropic SDK.
  const anthropicFiles = SOURCE_FILES.filter((f) =>
    f.text.includes("@anthropic-ai/sdk"),
  );

  it("finds the known Anthropic call sites (guards the scan itself)", () => {
    // If this drops to zero the scan below would pass vacuously.
    const found = anthropicFiles.flatMap((f) =>
      [...f.text.matchAll(/\.(?:create|stream|parse)\(\{/g)].map(() => f.path),
    );
    expect(found.length).toBeGreaterThanOrEqual(9);
    expect(new Set(found)).toContain("lib/ai/ask/ask-stream.ts");
    expect(new Set(found)).toContain("lib/ai/ask/context.ts");
  });

  it("passes `thinking` on every create/stream/parse request", () => {
    const offenders: string[] = [];
    for (const file of anthropicFiles) {
      for (const m of file.text.matchAll(/\.(create|stream|parse)\(\{/g)) {
        const open = m.index! + m[0].length - 1;
        const params = objectLiteralAt(file.text, open);
        // Only request bodies — an object literal with no `model` key is some
        // other `.create(`/`.parse(` (e.g. a Supabase or Zod call). `[:,]`
        // covers the shorthand `{ model, max_tokens: … }` form too.
        if (!/\bmodel\s*[:,]/.test(params)) continue;
        if (!/\bthinking:/.test(params))
          offenders.push(`${file.path} (.${m[1]})`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("every feature string reaching runAi is routed by the model map", () => {
  /** `feature: "x"` inside the first argument of each runAi(...) call. */
  function featuresIn(text: string): string[] {
    const out: string[] = [];
    for (const m of text.matchAll(/\brunAi\s*(?:<[^>]*>)?\s*\(\s*\{/g)) {
      const open = m.index! + m[0].length - 1;
      const arg = objectLiteralAt(text, open);
      const literal = arg.match(/\bfeature:\s*"([^"]+)"/);
      if (literal) {
        out.push(literal[1]);
        continue;
      }
      // `feature: FEATURE` — resolve the module-level constant.
      const ident = arg.match(/\bfeature:\s*([A-Za-z_$][\w$]*)/);
      if (!ident) continue;
      const decl = text.match(
        new RegExp(`\\b(?:const|let)\\s+${ident[1]}\\s*=\\s*"([^"]+)"`),
      );
      if (decl) out.push(decl[1]);
    }
    return out;
  }

  const callSites = SOURCE_FILES.flatMap((f) =>
    featuresIn(f.text).map((feature) => ({ feature, path: f.path })),
  );

  it("finds the runAi call sites (guards the scan itself)", () => {
    // 13 metered call sites today; the floor guards against a vacuous pass.
    expect(callSites.length).toBeGreaterThanOrEqual(13);
  });

  it("has a tier-map entry for each one", () => {
    const unrouted = callSites
      .filter((c) => !AI_FEATURES.includes(c.feature))
      .map((c) => `${c.feature} (${c.path})`);
    expect(unrouted).toEqual([]);
  });

  // The other direction: a map entry no call site meters is dead weight.
  it("has no unmetered map entries — every routed feature reaches runAi", () => {
    const used = new Set(callSites.map((c) => c.feature));
    expect(AI_FEATURES.filter((f) => !used.has(f))).toEqual([]);
  });

  // The direction that actually bit, in its current form. It used to be "the
  // feature reaches runAi but nothing calls modelFor for it", so it silently
  // landed on the default model. `modelFor` is gone — runAi itself resolves the
  // model from the feature's tier — so the inert case moved: a callback that
  // never READS the resolved model still gets metered against it while sending
  // whatever id it hardcoded. Every callback must destructure `model`.
  it("has no inert call sites — every runAi callback reads the resolved model", () => {
    const offenders: string[] = [];
    let scanned = 0;
    for (const file of SOURCE_FILES) {
      // `({` — the same anchor the scan above uses, so prose mentioning runAi
      // in a doc comment is not mistaken for a call site.
      for (const m of file.text.matchAll(/\brunAi\s*(?:<[^>]*>)?\s*\(\s*\{/g)) {
        scanned++;
        const openParen = m.index! + m[0].lastIndexOf("(");
        const call = balancedFrom(file.text, openParen, "(", ")");
        const argsOpen = call.indexOf("{");
        const args = objectLiteralAt(call, argsOpen);
        const callback = call.slice(argsOpen + args.length);
        if (!/\bmodel\b/.test(callback))
          offenders.push(`${file.path} (${args.match(/feature:\s*\S+/)?.[0]})`);
      }
    }
    expect(offenders).toEqual([]);
    // Guards the scan itself: a regex that matched nothing would pass silently.
    expect(scanned).toBeGreaterThanOrEqual(13);
  });
});
