import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { config } from "dotenv";
import {
  type SupabaseTargetLabel,
  labelSupabaseTarget,
} from "@/lib/supabase/project-refs";

// Support code for the anon-reachability CONFORMANCE probes
// (src/lib/supabase/anon-reachability.conformance.test.ts).
//
// Conformance probes answer one question against a LIVE project: can the `anon`
// role reach anything? They are deliberately NOT integration tests:
//
//   * They perform only denied/empty READS. No row is written, no user is
//     created, nothing is torn down — which is what makes them safe to aim at
//     DEV and at PROD.
//   * They hold only the publishable anon key, never a privileged one. That
//     absence IS the safety property, and anon-conformance.test.ts pins it.
//   * They therefore do NOT use the integration suites' readiness gate, which
//     requires a privileged key AND a dedicated throwaway project — the exact
//     coupling that left the only test of this invariant permanently skipped.
//
// Regression gate for: 8 SECURITY DEFINER functions that were anon-executable
// in production, two of them able to delete from vault.secrets. Fixed by
// supabase/migrations/20260725102610_definer_acl_lockdown.sql.

export type FunctionSignature = { name: string; args: string[] };

/**
 * Functions a logged-out visitor is ALLOWED to call. Empty is the correct
 * state: Pulse has no public/anonymous surface — the browser client only acts
 * as `anon` while signed out, and every route behind auth. An entry here is a
 * reviewed claim that a function must be callable by the whole internet; it
 * needs a comment saying why, and it must not be SECURITY DEFINER.
 */
export const ANON_REACHABLE_FUNCTION_ALLOWLIST: readonly string[] = [];

/**
 * Tables a logged-out visitor is ALLOWED to read rows from. Empty is the
 * correct state: RLS is default-deny and org-scoped. An entry here is a
 * reviewed claim that the table's contents are public data.
 */
export const ANON_REACHABLE_TABLE_ALLOWLIST: readonly string[] = [];

// ---------------------------------------------------------------------------
// Probe corpus: derived, never hand-maintained.
// ---------------------------------------------------------------------------

/**
 * Split a parameter list on TOP-LEVEL commas only, so `numeric(10, 2)` and
 * `default coalesce(a, b)` stay in one piece.
 */
function splitTopLevel(params: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of params) {
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    if (ch === "," && depth === 0) {
      out.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) out.push(current);
  return out;
}

/** Index just past the `)` matching an opening paren at `openIndex - 1`. */
function findMatchingParen(sql: string, openIndex: number): number {
  let depth = 1;
  let i = openIndex;
  while (i < sql.length && depth > 0) {
    if (sql[i] === "(") depth++;
    else if (sql[i] === ")") depth--;
    i++;
  }
  return i - 1;
}

const CREATE_FUNCTION_RE =
  /create\s+(?:or\s+replace\s+)?function\s+public\.("?)([a-z0-9_]+)\1\s*\(/gi;

/**
 * Extract every `public` function declared in one migration's SQL, with the
 * NAMES of its callable parameters.
 *
 * The names matter: PostgREST resolves `POST /rest/v1/rpc/<name>` by the set of
 * keys in the JSON body. Post an empty body at a function that takes arguments
 * and you get PGRST202 ("no matches in the schema cache") whether or not anon
 * holds EXECUTE — a false pass. Posting the right keys makes the privilege
 * check actually fire, which is why 109 of the 129 probes come back as a hard
 * 42501 instead of an ambiguous 404.
 */
export function parsePublicFunctionSignatures(
  sql: string,
): FunctionSignature[] {
  // `--` comments are prose and sometimes contain example DDL.
  const stripped = sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");

  const signatures: FunctionSignature[] = [];
  CREATE_FUNCTION_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CREATE_FUNCTION_RE.exec(stripped)) !== null) {
    const name = match[2];
    const close = findMatchingParen(stripped, CREATE_FUNCTION_RE.lastIndex);
    const inner = stripped.slice(CREATE_FUNCTION_RE.lastIndex, close).trim();

    const args: string[] = [];
    for (const param of inner ? splitTopLevel(inner) : []) {
      const tokens = param.trim().split(/\s+/);
      // OUT parameters are results, not inputs — never sent in an RPC body.
      if (/^out$/i.test(tokens[0])) continue;
      const nameIndex = /^(in|inout|variadic)$/i.test(tokens[0]) ? 1 : 0;
      const argName = tokens[nameIndex];
      if (argName && /^[a-z_][a-z0-9_]*$/i.test(argName)) args.push(argName);
    }
    signatures.push({ name, args });
  }
  return signatures;
}

/** Union of every distinct public function signature across all migrations. */
export function collectPublicFunctionSignatures(
  sources: readonly string[],
): FunctionSignature[] {
  const seen = new Map<string, FunctionSignature>();
  for (const source of sources) {
    for (const signature of parsePublicFunctionSignatures(source)) {
      const key = `${signature.name}(${signature.args.join(",")})`;
      if (!seen.has(key)) seen.set(key, signature);
    }
  }
  return [...seen.values()];
}

/**
 * Read the table names out of the generated `Database` type. Hand-maintaining
 * this list would guarantee it goes stale; the generated types are regenerated
 * with every migration, so a new table is probed automatically.
 */
export function parsePublicTableNames(databaseTypesSource: string): string[] {
  const lines = databaseTypesSource.split("\n");
  const start = lines.findIndex((line) => /^ {4}Tables: \{$/.test(line));
  if (start === -1) {
    throw new Error(
      "Could not find the `    Tables: {` block in database.types.ts — the " +
        "generated shape changed and the conformance probe would silently " +
        "cover nothing.",
    );
  }
  const names: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^ {4}\};$/.test(lines[i])) break; // end of the Tables block
    const key = lines[i].match(/^ {6}([a-z0-9_]+): \{$/);
    if (key) names.push(key[1]);
  }
  if (names.length === 0) {
    throw new Error("Parsed 0 tables out of the `Tables` block.");
  }
  return names;
}

export function readMigrationSources(repoRoot = process.cwd()): string[] {
  const dir = resolve(repoRoot, "supabase/migrations");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(join(dir, f), "utf8"));
}

export function readDatabaseTypesSource(repoRoot = process.cwd()): string {
  return readFileSync(resolve(repoRoot, "src/types/database.types.ts"), "utf8");
}

// ---------------------------------------------------------------------------
// Verdicts
// ---------------------------------------------------------------------------

export type FunctionVerdict = "denied" | "not-exposed" | "reachable";
export type TableVerdict = "denied" | "empty" | "readable";

/**
 * Two outcomes prove a function is out of anon's reach:
 *   42501   — Postgres refused: anon holds no EXECUTE.
 *   PGRST202 — PostgREST has no such function in the anon schema cache. Every
 *              `returns trigger` function answers this (PostgREST never exposes
 *              trigger functions at all), as does a signature dropped by a later
 *              migration.
 * Anything else — above all a 200 — means the call reached the function body.
 * An unrelated Postgres error (a cast failure on our null arguments, say) is
 * still a FAILURE: it can only be raised *after* the privilege check passed.
 * Same reasoning the pre-existing grants test documents.
 */
export function classifyFunctionProbe(outcome: {
  status: number;
  code: string | null;
}): FunctionVerdict {
  if (outcome.code === "42501") return "denied";
  if (outcome.code === "PGRST202") return "not-exposed";
  return "reachable";
}

/**
 * `[]` is what default-deny RLS looks like over the REST API: the table grant
 * exists, but no policy admits anon, so zero rows come back. 42501 is the
 * harder denial (no grant at all, or a policy expression calling a function
 * anon cannot execute). One or more rows is a live data leak.
 */
export function classifyTableProbe(outcome: {
  status: number;
  code: string | null;
  rows: number | null;
}): TableVerdict {
  if (outcome.rows !== null) return outcome.rows === 0 ? "empty" : "readable";
  if (outcome.code === "42501") return "denied";
  return "readable";
}

// ---------------------------------------------------------------------------
// Target resolution
// ---------------------------------------------------------------------------

export type ConformanceTarget = {
  url: string;
  anonKey: string;
  label: SupabaseTargetLabel;
  source: "override" | "ambient";
};

export type TargetResolution =
  | { ok: true; target: ConformanceTarget }
  | { ok: false; reason: string };

const OVERRIDE_URL = "CONFORMANCE_TARGET_URL";
const OVERRIDE_KEY = "CONFORMANCE_TARGET_ANON_KEY";

// vitest.setup.ts seeds these so app modules import cleanly under jsdom.
// Probing them would pass vacuously.
const PLACEHOLDER_KEYS = new Set(["test-anon-key"]);

/**
 * Resolve which live project to probe.
 *
 * Default: whatever the ambient env points at — i.e. `.env.local`, which is
 * DEV. There is deliberately no way to reach PROD by default; `/promote` and
 * `/sync-prod` aim the probes at production by setting the explicit override
 * pair, which has to name both the URL and the key.
 *
 * Returns a reason instead of throwing so the suite can SKIP (not fail) when
 * no credentials exist — CI without secrets stays green.
 */
export function resolveConformanceTarget(
  env: Record<string, string | undefined>,
): TargetResolution {
  const overrideUrl = env[OVERRIDE_URL];
  const overrideKey = env[OVERRIDE_KEY];

  if (overrideUrl || overrideKey) {
    // Half-set is a typo, not an intent. Refusing beats quietly probing DEV
    // while the operator believes they are probing PROD.
    if (!overrideUrl || !overrideKey) {
      return {
        ok: false,
        reason: `${OVERRIDE_URL} and ${OVERRIDE_KEY} must be set together; got only ${
          overrideUrl ? OVERRIDE_URL : OVERRIDE_KEY
        }.`,
      };
    }
    return finalize(overrideUrl, overrideKey, "override");
  }

  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return {
      ok: false,
      reason:
        "No target: set NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY " +
        `(or the ${OVERRIDE_URL}/${OVERRIDE_KEY} pair).`,
    };
  }
  return finalize(url, anonKey, "ambient");
}

function finalize(
  url: string,
  anonKey: string,
  source: ConformanceTarget["source"],
): TargetResolution {
  if (!url.startsWith("https://")) {
    return {
      ok: false,
      reason: `Not a live Supabase project URL: ${url}`,
    };
  }
  if (PLACEHOLDER_KEYS.has(anonKey)) {
    return { ok: false, reason: "Anon key is the test placeholder." };
  }
  return {
    ok: true,
    target: { url, anonKey, label: labelSupabaseTarget(url), source },
  };
}

/**
 * Load `.env.local` so a plain `pnpm test` finds the ambient target.
 *
 * Deliberately narrower than the integration suites' loader: it never layers
 * `.env.test` on top, because repointing these probes at a throwaway project
 * would prove nothing about the projects that actually serve users. `override`
 * is required because vitest.setup.ts seeds placeholders first.
 */
export function loadConformanceEnv(repoRoot = process.cwd()): void {
  const envLocal = resolve(repoRoot, ".env.local");
  if (existsSync(envLocal))
    config({ path: envLocal, override: true, quiet: true });
}

// ---------------------------------------------------------------------------
// Bounded parallelism
// ---------------------------------------------------------------------------

/**
 * Map over `items` with at most `limit` promises in flight, preserving input
 * order. The probes are ~180 network calls; unbounded they trip Supabase rate
 * limiting and the run reports throttling as a security finding.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await fn(items[index], index);
      }
    },
  );
  await Promise.all(workers);
  return results;
}
