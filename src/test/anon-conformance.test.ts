import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ANON_REACHABLE_FUNCTION_ALLOWLIST,
  ANON_REACHABLE_TABLE_ALLOWLIST,
  classifyFunctionProbe,
  classifyTableProbe,
  collectPublicFunctionSignatures,
  mapWithConcurrency,
  parsePublicFunctionSignatures,
  parsePublicTableNames,
  readDatabaseTypesSource,
  readMigrationSources,
  resolveConformanceTarget,
} from "./anon-conformance";

describe("parsePublicFunctionSignatures", () => {
  it("extracts the name and argument names of a public function", () => {
    const sql = `create function public.create_organization(p_name text, p_slug text)
returns uuid language plpgsql security definer as $$ begin end $$;`;
    expect(parsePublicFunctionSignatures(sql)).toEqual([
      { name: "create_organization", args: ["p_name", "p_slug"] },
    ]);
  });

  it("handles `create or replace`, zero args, and multi-line parameter lists", () => {
    const sql = `create or replace function public.tg_log_item_activity()
returns trigger as $$ begin end $$;

CREATE OR REPLACE FUNCTION public.set_goal_links(
  p_goal_id uuid,
  p_links   jsonb
) RETURNS void AS $$ BEGIN END $$;`;
    expect(parsePublicFunctionSignatures(sql)).toEqual([
      { name: "tg_log_item_activity", args: [] },
      { name: "set_goal_links", args: ["p_goal_id", "p_links"] },
    ]);
  });

  it("does not split on commas nested inside a parameter's type or default", () => {
    const sql = `create function public.f(p_amount numeric(10, 2), p_ids uuid[] default array[]::uuid[], p_when timestamptz default now())
returns void as $$ begin end $$;`;
    expect(parsePublicFunctionSignatures(sql)).toEqual([
      { name: "f", args: ["p_amount", "p_ids", "p_when"] },
    ]);
  });

  it("skips OUT parameters (they are never sent in an RPC body) but keeps IN/VARIADIC", () => {
    const sql = `create function public.f(in p_a uuid, out p_b text, variadic p_rest text[])
returns record as $$ begin end $$;`;
    expect(parsePublicFunctionSignatures(sql)).toEqual([
      { name: "f", args: ["p_a", "p_rest"] },
    ]);
  });

  it("ignores `create function` text that only appears in a `--` comment", () => {
    const sql = `-- create function public.not_real(p_x uuid) is only prose
create function public.real_one() returns void as $$ begin end $$;`;
    expect(parsePublicFunctionSignatures(sql)).toEqual([
      { name: "real_one", args: [] },
    ]);
  });

  it("ignores functions created in a schema other than public", () => {
    const sql = `create function private.hidden(p_x uuid) returns void as $$ begin end $$;
create function public.shown() returns void as $$ begin end $$;`;
    expect(parsePublicFunctionSignatures(sql)).toEqual([
      { name: "shown", args: [] },
    ]);
  });
});

describe("collectPublicFunctionSignatures", () => {
  it("deduplicates identical signatures across migrations but keeps overloads", () => {
    const a = `create function public.f(p_a uuid) returns void as $$ begin end $$;`;
    const b = `create or replace function public.f(p_a uuid) returns void as $$ begin end $$;
create or replace function public.f(p_a uuid, p_b text) returns void as $$ begin end $$;`;
    expect(collectPublicFunctionSignatures([a, b])).toEqual([
      { name: "f", args: ["p_a"] },
      { name: "f", args: ["p_a", "p_b"] },
    ]);
  });
});

describe("parsePublicTableNames", () => {
  it("reads the keys of the public Tables block and stops at Views", () => {
    const source = `export type Database = {
  public: {
    Tables: {
      admin_audit_log: {
        Row: {
          id: string;
        };
      };
      organizations: {
        Row: {
          id: string;
        };
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      some_fn: {
        Args: Record<string, never>;
      };
    };
  };
};`;
    expect(parsePublicTableNames(source)).toEqual([
      "admin_audit_log",
      "organizations",
    ]);
  });

  it("throws rather than silently probing nothing when the Tables block is missing", () => {
    expect(() => parsePublicTableNames("export type Database = {};")).toThrow(
      /Tables/,
    );
  });
});

describe("classifyFunctionProbe", () => {
  // Once EXECUTE is revoked, PostgREST answers either 42501 (the privilege
  // check fires) or PGRST202 (the function is not in the anon schema cache at
  // all — the answer for every `returns trigger` function). Anything else means
  // the call actually reached the function body.
  it("treats 42501 as denied", () => {
    expect(classifyFunctionProbe({ status: 401, code: "42501" })).toBe(
      "denied",
    );
  });

  it("treats PGRST202 as not-exposed", () => {
    expect(classifyFunctionProbe({ status: 404, code: "PGRST202" })).toBe(
      "not-exposed",
    );
  });

  it("treats a 200 as REACHABLE — the failure this suite exists to catch", () => {
    expect(classifyFunctionProbe({ status: 200, code: null })).toBe(
      "reachable",
    );
  });

  it("treats an unrelated Postgres error as reachable (the body executed)", () => {
    // 22P02 = invalid text representation: only raised once the call is past
    // the privilege check, so anon CAN execute it.
    expect(classifyFunctionProbe({ status: 400, code: "22P02" })).toBe(
      "reachable",
    );
  });
});

describe("classifyTableProbe", () => {
  it("treats an empty array as denied-by-RLS", () => {
    expect(classifyTableProbe({ status: 200, code: null, rows: 0 })).toBe(
      "empty",
    );
  });

  it("treats 42501 as denied", () => {
    expect(classifyTableProbe({ status: 401, code: "42501", rows: null })).toBe(
      "denied",
    );
  });

  it("treats any returned row as READABLE — a live data leak", () => {
    expect(classifyTableProbe({ status: 200, code: null, rows: 1 })).toBe(
      "readable",
    );
  });
});

describe("resolveConformanceTarget", () => {
  it("uses the override pair when both are set", () => {
    const resolution = resolveConformanceTarget({
      NEXT_PUBLIC_SUPABASE_URL: "https://dev.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "dev-key",
      CONFORMANCE_TARGET_URL: "https://jzsyqhxynswolgijkktn.supabase.co",
      CONFORMANCE_TARGET_ANON_KEY: "prod-key",
    });
    expect(resolution).toEqual({
      ok: true,
      target: {
        url: "https://jzsyqhxynswolgijkktn.supabase.co",
        anonKey: "prod-key",
        label: "prod",
        source: "override",
      },
    });
  });

  it("falls back to the ambient NEXT_PUBLIC_* pair", () => {
    const resolution = resolveConformanceTarget({
      NEXT_PUBLIC_SUPABASE_URL: "https://hjqcahbbbdaknbbnfnvl.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "dev-key",
    });
    expect(resolution).toEqual({
      ok: true,
      target: {
        url: "https://hjqcahbbbdaknbbnfnvl.supabase.co",
        anonKey: "dev-key",
        label: "dev",
        source: "ambient",
      },
    });
  });

  it("skips (rather than silently aiming elsewhere) on a half-set override", () => {
    const resolution = resolveConformanceTarget({
      NEXT_PUBLIC_SUPABASE_URL: "https://dev.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "dev-key",
      CONFORMANCE_TARGET_URL: "https://prod.supabase.co",
    });
    expect(resolution.ok).toBe(false);
    if (!resolution.ok) {
      expect(resolution.reason).toContain("CONFORMANCE_TARGET_ANON_KEY");
    }
  });

  it("skips cleanly when no credentials are present at all (CI without secrets)", () => {
    const resolution = resolveConformanceTarget({});
    expect(resolution.ok).toBe(false);
    if (!resolution.ok) {
      expect(resolution.reason).toContain("NEXT_PUBLIC_SUPABASE_URL");
    }
  });

  it("never treats the jsdom setup placeholder as a real target", () => {
    // vitest.setup.ts seeds http://localhost:54321 / test-anon-key so that app
    // modules import cleanly. Probing that would pass vacuously.
    const resolution = resolveConformanceTarget({
      NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key",
    });
    expect(resolution.ok).toBe(false);
  });
});

describe("mapWithConcurrency", () => {
  it("returns results in input order", async () => {
    const out = await mapWithConcurrency(
      [1, 2, 3, 4, 5],
      2,
      async (n) => n * 2,
    );
    expect(out).toEqual([2, 4, 6, 8, 10]);
  });

  it("never runs more than `limit` tasks at once", async () => {
    let inFlight = 0;
    let peak = 0;
    await mapWithConcurrency(
      Array.from({ length: 20 }, (_, i) => i),
      3,
      async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 1));
        inFlight--;
      },
    );
    expect(peak).toBeLessThanOrEqual(3);
  });
});

describe("the probe corpus is real", () => {
  it("parses a substantial number of public functions out of the migrations", () => {
    const signatures = collectPublicFunctionSignatures(readMigrationSources());
    const names = new Set(signatures.map((s) => s.name));
    expect(signatures.length).toBeGreaterThan(100);
    // Spot-check the two the security incident was actually about.
    expect(names).toContain("ai_credential_delete_vault_secret");
    expect(names).toContain("org_ai_settings_delete_vault_secret");
    expect(names).toContain("is_platform_admin");
  });

  it("parses every public table out of the generated types", () => {
    const tables = parsePublicTableNames(readDatabaseTypesSource());
    expect(tables.length).toBeGreaterThan(40);
    expect(tables).toContain("organizations");
    expect(tables).toContain("items");
  });
});

describe("safety properties of the conformance suite", () => {
  const suitePath = resolve(
    process.cwd(),
    "src/lib/supabase/anon-reachability.conformance.test.ts",
  );
  const helperPath = resolve(process.cwd(), "src/test/anon-conformance.ts");
  const sources = [suitePath, helperPath].map((p) => readFileSync(p, "utf8"));

  // THE safety property: what makes these probes safe to point at PROD is that
  // the process never holds a privileged key. Pin it — a future edit that
  // reaches for one has to delete this test, which is a visible act.
  it("never references the privileged Postgres key", () => {
    for (const source of sources) {
      expect(source).not.toMatch(/SERVICE_ROLE/i);
    }
  });

  it("never performs a write", () => {
    for (const source of sources) {
      expect(source).not.toMatch(/\.(insert|update|upsert|delete)\(/);
      expect(source).not.toMatch(/method:\s*"(PUT|PATCH|DELETE)"/);
      expect(source).not.toMatch(/createUser|admin\.auth/);
    }
  });

  // integration-env's gate demands a dedicated, non-DEV/PROD test project. The
  // whole point of the conformance suite is to run without one.
  it("does not depend on the integration-suite env gate", () => {
    for (const source of sources) {
      expect(source).not.toMatch(/integration-env|integrationTargetReady/);
    }
  });
});

describe("allow-lists", () => {
  // Empty is the correct state. An entry here is a deliberate, reviewed claim
  // that something MUST be reachable by a logged-out visitor.
  it("are empty — nothing in this product is anon-reachable", () => {
    expect(ANON_REACHABLE_FUNCTION_ALLOWLIST).toEqual([]);
    expect(ANON_REACHABLE_TABLE_ALLOWLIST).toEqual([]);
  });
});
