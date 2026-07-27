import { beforeAll, describe, expect, it } from "vitest";
import {
  ANON_REACHABLE_FUNCTION_ALLOWLIST,
  ANON_REACHABLE_TABLE_ALLOWLIST,
  type FunctionSignature,
  type FunctionVerdict,
  type TableVerdict,
  classifyFunctionProbe,
  classifyTableProbe,
  collectPublicFunctionSignatures,
  loadConformanceEnv,
  mapWithConcurrency,
  parsePublicTableNames,
  readDatabaseTypesSource,
  readMigrationSources,
  resolveConformanceTarget,
} from "@/test/anon-conformance";

// ===========================================================================
// CONFORMANCE PROBES — "anon can reach nothing", proven against a LIVE project.
// ===========================================================================
//
// Run: `pnpm test:conformance` (also part of `pnpm test`).
// Aim at production: set CONFORMANCE_TARGET_URL + CONFORMANCE_TARGET_ANON_KEY.
//
// WHY THIS EXISTS
// Eight SECURITY DEFINER functions shipped to production callable by `anon`
// off the REST API; two of them dropped rows from vault.secrets. The lockdown
// migration (20260725102610_definer_acl_lockdown.sql) closed it and asserts the
// invariant at apply time — but only for migrations that are actually applied,
// and only for SECURITY DEFINER functions. This suite is the standing gate: it
// asks the live REST API, as a logged-out visitor, what it can reach.
//
// WHY IT IS SAFE TO POINT AT PRODUCTION
//   1. Every probe is a READ that is expected to be refused or empty. Nothing
//      is provisioned, nothing is torn down.
//   2. The process holds only the publishable anon key — the same key that
//      already ships to every browser. It never obtains a privileged key, and
//      src/test/anon-conformance.test.ts fails if this file so much as names
//      one. That absence is the safety property.
//   3. It does not run the destructive `@example.com` teardown, and does not
//      use the integration suites' readiness gate (which demands a privileged
//      key and a throwaway project — the coupling that left the only previous
//      test of this invariant permanently skipped).
//
// THE ONE HONEST CAVEAT
// The function probe is `POST /rest/v1/rpc/<name>` with every declared argument
// set to null. Postgres checks EXECUTE *before* the body runs, so in the
// passing state — which is the state this suite asserts — no function body ever
// executes. If a probe ever DID reach a mutating function, that call would run
// with null arguments. That is not a reason to weaken the probe: reaching that
// branch means a logged-out visitor could already call it at will, which is the
// emergency the suite is built to surface.

loadConformanceEnv();

const resolution = resolveConformanceTarget(process.env);

if (!resolution.ok) {
  console.info(`[conformance] skipped — ${resolution.reason}`);
}

// Bounded so a ~180-call sweep does not trip Supabase rate limiting and report
// throttling as a security finding.
const CONCURRENCY = 6;

type FunctionProbe = {
  signature: string;
  verdict: FunctionVerdict;
  status: number;
  code: string | null;
  body: string;
};

type TableProbe = {
  table: string;
  verdict: TableVerdict;
  status: number;
  code: string | null;
  rows: number | null;
  body: string;
};

describe.skipIf(!resolution.ok)("anon reachability (live project)", () => {
  const target = resolution.ok ? resolution.target : null;

  const headers = (): Record<string, string> => ({
    apikey: target!.anonKey,
    Authorization: `Bearer ${target!.anonKey}`,
    "Content-Type": "application/json",
  });

  const signatures: FunctionSignature[] = collectPublicFunctionSignatures(
    readMigrationSources(),
  );
  const tables: string[] = parsePublicTableNames(readDatabaseTypesSource());

  let functionProbes: FunctionProbe[] = [];
  let tableProbes: TableProbe[] = [];

  beforeAll(async () => {
    console.info(
      `[conformance] probing ${target!.label.toUpperCase()} (${target!.source}) — ` +
        `${signatures.length} function signatures, ${tables.length} tables`,
    );

    functionProbes = await mapWithConcurrency(
      signatures,
      CONCURRENCY,
      async (signature) => {
        const args: Record<string, null> = {};
        for (const argName of signature.args) args[argName] = null;
        const response = await fetch(
          `${target!.url}/rest/v1/rpc/${signature.name}`,
          { method: "POST", headers: headers(), body: JSON.stringify(args) },
        );
        const body = await response.text();
        return {
          signature: `${signature.name}(${signature.args.join(", ")})`,
          verdict: classifyFunctionProbe({
            status: response.status,
            code: errorCode(body),
          }),
          status: response.status,
          code: errorCode(body),
          body: body.slice(0, 200),
        };
      },
    );

    tableProbes = await mapWithConcurrency(
      tables,
      CONCURRENCY,
      async (table) => {
        // `select=*` so a leak of ANY column is caught, `limit=1` so a leak stays
        // a single row rather than a table dump in the failure output.
        const response = await fetch(
          `${target!.url}/rest/v1/${table}?select=*&limit=1`,
          { headers: headers() },
        );
        const body = await response.text();
        const rows = rowCount(body);
        return {
          table,
          verdict: classifyTableProbe({
            status: response.status,
            code: errorCode(body),
            rows,
          }),
          status: response.status,
          code: errorCode(body),
          rows,
          body: body.slice(0, 200),
        };
      },
    );

    console.info(
      `[conformance] functions: ${count(functionProbes, "denied")} denied (42501), ` +
        `${count(functionProbes, "not-exposed")} not exposed (PGRST202), ` +
        `${count(functionProbes, "reachable")} REACHABLE — ` +
        `tables: ${count(tableProbes, "denied")} denied, ` +
        `${count(tableProbes, "empty")} empty, ` +
        `${count(tableProbes, "readable")} READABLE`,
    );
  });

  it("probes every public function declared in the migrations", () => {
    // A floor, not an equality: the point is that the corpus is derived, so a
    // new function is probed automatically. If this drops, parsing broke.
    expect(functionProbes.length).toBe(signatures.length);
    expect(functionProbes.length).toBeGreaterThan(100);
  });

  it("exposes no public function to anon", () => {
    const reachable = functionProbes.filter(
      (probe) =>
        probe.verdict === "reachable" &&
        !ANON_REACHABLE_FUNCTION_ALLOWLIST.includes(probe.signature),
    );
    expect(
      reachable.map((p) => `${p.signature} → ${p.status} ${p.code} ${p.body}`),
      "anon must not be able to execute ANY public function",
    ).toEqual([]);
  });

  it("hard-denies the majority of functions with 42501, not just a 404", () => {
    // PGRST202 is a weaker proof than 42501: it also means "PostgREST does not
    // expose this shape", which is the permanent answer for `returns trigger`
    // functions. If the 42501 share collapsed, argument-name parsing has broken
    // and the suite would be passing vacuously.
    expect(count(functionProbes, "denied")).toBeGreaterThan(
      functionProbes.length / 2,
    );
  });

  it("names the two vault.secrets functions from the incident in the corpus", () => {
    const probed = functionProbes.map((p) => p.signature);
    expect(probed).toContain("ai_credential_delete_vault_secret()");
    expect(probed).toContain("org_ai_settings_delete_vault_secret()");
  });

  it("probes every public table in the generated types", () => {
    expect(tableProbes.length).toBe(tables.length);
    expect(tableProbes.length).toBeGreaterThan(40);
  });

  it("returns no row from any public table to anon", () => {
    const readable = tableProbes.filter(
      (probe) =>
        probe.verdict === "readable" &&
        !ANON_REACHABLE_TABLE_ALLOWLIST.includes(probe.table),
    );
    expect(
      readable.map((p) => `${p.table} → ${p.status} rows=${p.rows} ${p.body}`),
      "anon must not be able to read rows from ANY public table",
    ).toEqual([]);
  });
});

function errorCode(body: string): string | null {
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const code = (parsed as { code?: unknown }).code;
      return typeof code === "string" ? code : null;
    }
  } catch {
    // Non-JSON body (e.g. an HTML gateway error) — no code to read.
  }
  return null;
}

function rowCount(body: string): number | null {
  try {
    const parsed: unknown = JSON.parse(body);
    return Array.isArray(parsed) ? parsed.length : null;
  } catch {
    return null;
  }
}

function count<T extends { verdict: string }>(
  probes: T[],
  verdict: string,
): number {
  return probes.filter((probe) => probe.verdict === verdict).length;
}
