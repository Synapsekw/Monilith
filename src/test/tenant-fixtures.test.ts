import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { allowsTier2Fixtures } from "@/lib/supabase/project-refs";
import { selectPurgeableUserIds } from "@/test/global-teardown";
import {
  TIER2_BOARD_MEMBER_FIXTURE,
  TIER2_BOARD_THREAD_FIXTURE,
  TIER2_FIXTURE_EMAILS,
  TIER2_FIXTURE_MESSAGE_COUNTS,
  TIER2_FIXTURE_TENANTS,
  TIER2_PROPOSAL_MESSAGE_ID,
  resolveFixtureTarget,
} from "@/test/tenant-fixtures";

const DEV_URL = "https://hjqcahbbbdaknbbnfnvl.supabase.co";
const PROD_URL = "https://jzsyqhxynswolgijkktn.supabase.co";

describe("allowsTier2Fixtures", () => {
  // The INVERSE of the Tier-1 deny-list: DEV is forbidden to the destructive
  // integration teardown and is the ONLY project Tier 2 may aim at.
  it("allows the known DEV project", () => {
    expect(allowsTier2Fixtures(DEV_URL)).toBe(true);
  });

  it("refuses PROD", () => {
    expect(allowsTier2Fixtures(PROD_URL)).toBe(false);
  });

  it("refuses an unknown project (a throwaway/test ref has no fixtures seeded)", () => {
    expect(allowsTier2Fixtures("https://pulse-test.supabase.co")).toBe(false);
  });

  it("refuses an absent URL", () => {
    expect(allowsTier2Fixtures(undefined)).toBe(false);
  });
});

describe("resolveFixtureTarget", () => {
  it("resolves the ambient DEV pair", () => {
    expect(
      resolveFixtureTarget({
        NEXT_PUBLIC_SUPABASE_URL: DEV_URL,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "dev-key",
      }),
    ).toEqual({
      ok: true,
      target: { url: DEV_URL, anonKey: "dev-key", label: "dev" },
    });
  });

  it("refuses PROD outright — the fixtures deliberately do not exist there", () => {
    const resolution = resolveFixtureTarget({
      NEXT_PUBLIC_SUPABASE_URL: PROD_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "prod-key",
    });
    expect(resolution.ok).toBe(false);
    if (!resolution.ok) expect(resolution.reason).toMatch(/DEV/);
  });

  it("skips cleanly with no credentials at all (CI without secrets)", () => {
    const resolution = resolveFixtureTarget({});
    expect(resolution.ok).toBe(false);
    if (!resolution.ok) {
      expect(resolution.reason).toContain("NEXT_PUBLIC_SUPABASE_URL");
    }
  });

  it("never treats the jsdom setup placeholder as a real target", () => {
    expect(
      resolveFixtureTarget({
        NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key",
      }).ok,
    ).toBe(false);
  });
});

describe("the fixture identities are internally consistent", () => {
  it("describes exactly two tenants that share nothing", () => {
    expect(TIER2_FIXTURE_TENANTS).toHaveLength(2);
    const [a, b] = TIER2_FIXTURE_TENANTS;
    expect(a.email).not.toBe(b.email);
    expect(a.orgId).not.toBe(b.orgId);
    expect(a.conversationId).not.toBe(b.conversationId);
  });

  it("exposes every fixture email for the teardown exemption", () => {
    // Gamma is NOT a tenant — it deliberately shares Alpha's org — but it is
    // just as permanent, so the age-based purge must exempt it too or the
    // board-thread suite loses its only non-owning reader 30 minutes in.
    expect([...TIER2_FIXTURE_EMAILS].sort()).toEqual(
      [
        ...TIER2_FIXTURE_TENANTS.map((t) => t.email),
        TIER2_BOARD_MEMBER_FIXTURE.email,
      ].sort(),
    );
  });

  it("uses the RFC-reserved @example.com test domain", () => {
    // Deliberate: it is the domain the whole test estate already uses, which is
    // exactly why the age-based purge has to know about these two by name.
    for (const email of TIER2_FIXTURE_EMAILS) {
      expect(email).toMatch(/@example\.com$/);
    }
  });
});

describe("selectPurgeableUserIds exempts the permanent Tier-2 fixtures", () => {
  const NOW = 1_700_000_000_000;
  const MIN_AGE = 30 * 60 * 1000;
  const ancient = new Date(NOW - MIN_AGE * 1000).toISOString();

  it("never purges a fixture user, however old", () => {
    const users = TIER2_FIXTURE_EMAILS.map((email, i) => ({
      id: `fixture-${i}`,
      email,
      created_at: ancient,
    }));
    expect(selectPurgeableUserIds(users, NOW, MIN_AGE)).toEqual([]);
  });

  it("exempts case-insensitively", () => {
    const users = [
      {
        id: "shouty",
        email: TIER2_FIXTURE_EMAILS[0].toUpperCase(),
        created_at: ancient,
      },
    ];
    expect(selectPurgeableUserIds(users, NOW, MIN_AGE)).toEqual([]);
  });

  it("still purges an ordinary aged @example.com user alongside them", () => {
    const users = [
      { id: "fixture", email: TIER2_FIXTURE_EMAILS[0], created_at: ancient },
      {
        id: "throwaway",
        email: "rls-ask-alice@example.com",
        created_at: ancient,
      },
    ];
    expect(selectPurgeableUserIds(users, NOW, MIN_AGE)).toEqual(["throwaway"]);
  });
});

describe("the seed migration and the TypeScript identities cannot drift", () => {
  // The fixture UUIDs are spelled twice — once in SQL (the seed) and once in TS
  // (the assertions). A silent divergence would make every isolation assertion
  // pass vacuously against rows that no longer exist, so pin them together.
  const migrationsDir = resolve(process.cwd(), "supabase/migrations");
  const seedFile = readdirSync(migrationsDir).find((f) =>
    f.endsWith("_seed_tier2_tenant_fixtures.sql"),
  );
  const seedSql = seedFile
    ? readFileSync(join(migrationsDir, seedFile), "utf8")
    : "";

  it("ships a seed migration", () => {
    expect(
      seedFile,
      "expected a *_seed_tier2_tenant_fixtures.sql migration",
    ).toBeDefined();
  });

  it("spells every fixture UUID and email that the suite asserts on", () => {
    // TENANT emails only — gamma is seeded by the board-thread migration below,
    // not this one, so pinning it here would be pinning the wrong file.
    const expected = [
      ...TIER2_FIXTURE_TENANTS.map((t) => t.email),
      TIER2_PROPOSAL_MESSAGE_ID,
      ...TIER2_FIXTURE_TENANTS.flatMap((t) => [
        t.orgId,
        t.workspaceId,
        t.boardId,
        t.groupId,
        t.conversationId,
      ]),
    ];
    const missing = expected.filter((token) => !seedSql.includes(token));
    expect(missing).toEqual([]);
  });

  it("no-ops instead of seeding where the fixture accounts do not exist (PROD)", () => {
    // The seed_platform_admin_info pattern: the migration never CREATES an auth
    // user, it only attaches rows to one that already exists. That is what makes
    // it safe for `supabase db push` to carry it to production.
    expect(seedSql).not.toMatch(/insert\s+into\s+auth\.users/i);
    expect(seedSql).toMatch(/from\s+auth\.users/i);
  });

  it("agrees with the message counts the live suite asserts", () => {
    const [a, b] = TIER2_FIXTURE_TENANTS;
    expect(TIER2_FIXTURE_MESSAGE_COUNTS[a.label]).toBeGreaterThan(0);
    expect(TIER2_FIXTURE_MESSAGE_COUNTS[b.label]).toBeGreaterThan(0);
  });
});

describe("the board-thread seed and the TypeScript identities cannot drift", () => {
  // Same pinning contract as above, for the corpus that proves the board-thread
  // RLS widening (src/lib/ai/ask/board-threads.fixtures.test.ts). A silent
  // divergence would make "a non-owner sees nothing" pass against rows that do
  // not exist — which is precisely the failure mode this whole tier exists to
  // avoid.
  const migrationsDir = resolve(process.cwd(), "supabase/migrations");
  const seedFile = readdirSync(migrationsDir).find((f) =>
    f.endsWith("_seed_tier2_board_thread_fixtures.sql"),
  );
  const seedSql = seedFile
    ? readFileSync(join(migrationsDir, seedFile), "utf8")
    : "";

  it("ships a board-thread seed migration", () => {
    expect(
      seedFile,
      "expected a *_seed_tier2_board_thread_fixtures.sql migration",
    ).toBeDefined();
  });

  it("spells every board-thread UUID and the gamma address", () => {
    const F = TIER2_BOARD_THREAD_FIXTURE;
    const expected = [
      TIER2_BOARD_MEMBER_FIXTURE.email,
      F.orgId,
      F.sharedBoardId,
      F.sharedConversationId,
      F.sharedConversationTitle,
      ...F.sharedMessageIds,
      F.offBoardId,
      F.offBoardConversationId,
      F.offBoardConversationTitle,
      F.offBoardMessageId,
    ];
    const missing = expected.filter((token) => !seedSql.includes(token));
    expect(missing).toEqual([]);
  });

  it("shares the two board threads and hangs each off a DIFFERENT board", () => {
    // The pair is the experiment: same org, same owner, same visibility, one
    // board gamma holds and one it does not. Collapse them onto one board and
    // the off-board negative silently stops testing anything.
    const F = TIER2_BOARD_THREAD_FIXTURE;
    expect(F.sharedBoardId).not.toBe(F.offBoardId);
    expect(F.sharedConversationId).not.toBe(F.offBoardConversationId);
    expect(seedSql).toContain("'board'");
  });

  it("never creates an auth user (no-ops off DEV, like its sibling)", () => {
    expect(seedSql).not.toMatch(/insert\s+into\s+auth\.users/i);
    expect(seedSql).toMatch(/from\s+auth\.users/i);
  });

  it("is purely additive — no update, delete or truncate against live data", () => {
    // It extends the permanent fixture on a database that holds real
    // user-facing data (decision-32). Inserts with `on conflict do nothing`
    // only; anything else has no business in a seed.
    expect(seedSql).not.toMatch(/^\s*(update|delete|truncate|drop)\s/im);
    expect(seedSql).toMatch(/on conflict/i);
  });

  it("keeps gamma out of the two-tenant array it would contradict", () => {
    // TIER2_FIXTURE_TENANTS' premise is two tenants that share NOTHING; gamma's
    // premise is sharing Alpha's org. Merging them would quietly invalidate
    // every cross-tenant isolation assertion in the sibling suite.
    const emails = TIER2_FIXTURE_TENANTS.map((t) => t.email);
    expect(emails).not.toContain(TIER2_BOARD_MEMBER_FIXTURE.email);
    expect(TIER2_BOARD_THREAD_FIXTURE.orgId).toBe(
      TIER2_FIXTURE_TENANTS[0].orgId,
    );
  });
});

// Drop whole-line comments (line comments, block openers, JSDoc continuations)
// so the safety scan below is about what the tier DOES, not what its prose
// mentions — both files necessarily explain which key they refuse to hold.
// Trailing comments on code lines are kept, so nothing executable hides here.
function codeOnly(source: string): string {
  return source
    .split(/\r?\n/)
    .filter((line) => {
      const t = line.trim();
      return !(
        t.startsWith("//") ||
        t.startsWith("/*") ||
        t.startsWith("*") ||
        t.startsWith("*/")
      );
    })
    .join("\n");
}

describe("safety properties of the Tier-2 suite", () => {
  const sources = [
    "src/lib/ai/ask/board-threads.fixtures.test.ts",
    "src/lib/supabase/tenant-isolation.fixtures.test.ts",
    "src/test/tenant-fixtures.ts",
  ].map((p) => codeOnly(readFileSync(resolve(process.cwd(), p), "utf8")));

  // THE safety property, exactly as for the conformance tier: Tier 2 is
  // non-privileged. It signs in as two ordinary users and asserts what RLS
  // refuses them. A future edit that reaches for the service role has to delete
  // this test, which is a visible act.
  it("never references the privileged Postgres key", () => {
    for (const source of sources) {
      expect(source).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
      expect(source).not.toContain("service_role");
    }
  });

  it("never uses the GoTrue admin API (no provisioning, no teardown)", () => {
    for (const source of sources) {
      expect(source).not.toContain("auth.admin");
      expect(source).not.toContain("createUser");
      expect(source).not.toContain("deleteUser");
    }
  });

  it("never loads .env.test — repointing Tier 2 at a throwaway proves nothing", () => {
    for (const source of sources) {
      expect(source).not.toContain(".env.test");
    }
  });
});
