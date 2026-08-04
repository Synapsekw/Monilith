import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";
import {
  type SupabaseTargetLabel,
  allowsTier2Fixtures,
} from "@/lib/supabase/project-refs";

// ===========================================================================
// TIER 2 — the AUTHENTICATED half of the security boundary.
// ===========================================================================
//
// Support code for src/lib/supabase/tenant-isolation.fixtures.test.ts.
// Run: `pnpm test:fixtures` (also part of `pnpm test`).
//
// Tier 1 (`*.integration.test.ts`) PROVISIONS throwaway users and orgs, so it
// needs a service-role key and a sacrificial project — which is why all 70 of
// those suites have never run (decision-25, decision-30).
// Tier 3 (`*.conformance.test.ts`) asks a live project what a LOGGED-OUT
// visitor can reach, needing nothing but the publishable anon key.
//
// The gap between them was cross-tenant isolation between LOGGED-IN users. This
// tier closes it with the same trick that made Tier 3 possible — decouple the
// assertion from the provisioning:
//
//   * Two PERMANENT tenants are seeded ONCE into DEV by a versioned migration
//     and never mutated. Isolation therefore becomes a READ-ONLY assertion:
//     sign in as tenant A, ask for tenant B's rows, expect nothing.
//   * The process holds only the publishable anon key and two fixture
//     passwords. It never obtains a privileged key, never calls the GoTrue
//     admin API, and provisions nothing. tenant-fixtures.test.ts fails if this
//     module or the suite so much as names one of those. That absence IS the
//     safety property, exactly as for the conformance tier.
//   * It does NOT use `integrationTargetReady()`, and the destructive
//     `@example.com` teardown is taught to exempt these two accounts by name
//     (src/test/global-teardown.ts) — otherwise the age-based purge would
//     delete the permanent fixtures 30 minutes after they were seeded.
//
// THE ONE HONEST CAVEAT
// Three assertions are write ATTEMPTS that RLS must refuse (a stranger writing
// into someone else's conversation, forging a conversation as another user,
// updating another tenant's row). A refused write leaves nothing behind, and
// each is followed by a re-read proving the fixture is unchanged. If one ever
// DID land, the suite fails loudly — and that failure is the emergency this
// tier exists to surface, not a reason to weaken the probe.

/** Shared by every fixture account. Deliberately committed: these two accounts
 *  exist only on DEV, hold no elevated role, and can reach nothing but their
 *  own fixture org. The DEV anon key needed to use them is NOT committed. */
export const TIER2_FIXTURE_PASSWORD = "Tier2-Fixture-Read-Only-2026!";

export type FixtureTenant = {
  /** Stable short name used in test titles and the seed migration. */
  label: "a" | "b";
  email: string;
  orgId: string;
  orgName: string;
  orgSlug: string;
  workspaceId: string;
  boardId: string;
  boardName: string;
  groupId: string;
  conversationId: string;
  conversationTitle: string;
};

// Deterministic UUIDs, spelled identically in the seed migration. They make the
// seed idempotent (`on conflict (id) do nothing`) and let the suite assert on
// exact ids instead of looking rows up — a lookup would go empty and silently
// vacuous the moment the seed was lost. tenant-fixtures.test.ts pins the SQL
// and this file together so they cannot drift.
export const TIER2_FIXTURE_TENANTS = [
  {
    label: "a",
    email: "pulse-tier2-fixture-a@example.com",
    orgId: "aaaa0000-0000-4000-8000-000000000001",
    orgName: "Tier-2 Fixture Alpha",
    orgSlug: "tier2-fixture-alpha",
    workspaceId: "aaaa0000-0000-4000-8000-000000000002",
    boardId: "aaaa0000-0000-4000-8000-000000000003",
    boardName: "Alpha Fixture Board",
    groupId: "aaaa0000-0000-4000-8000-000000000004",
    conversationId: "aaaa0000-0000-4000-8000-000000000005",
    conversationTitle: "Alpha fixture thread",
  },
  {
    label: "b",
    email: "pulse-tier2-fixture-b@example.com",
    orgId: "bbbb0000-0000-4000-8000-000000000001",
    orgName: "Tier-2 Fixture Beta",
    orgSlug: "tier2-fixture-beta",
    workspaceId: "bbbb0000-0000-4000-8000-000000000002",
    boardId: "bbbb0000-0000-4000-8000-000000000003",
    boardName: "Beta Fixture Board",
    groupId: "bbbb0000-0000-4000-8000-000000000004",
    conversationId: "bbbb0000-0000-4000-8000-000000000005",
    conversationTitle: "Beta fixture thread",
  },
] as const satisfies readonly FixtureTenant[];

/** The assistant turn in tenant A's thread carrying a Phase-2 `proposedActions`
 *  trace. Its invisibility to tenant B is one of the two Ask Pulse Phase 2 RLS
 *  assertions that had never executed. */
export const TIER2_PROPOSAL_MESSAGE_ID = "aaaa0000-0000-4000-8000-000000000007";

/** Exact seeded turn counts per thread. The live suite asserts these BEFORE and
 *  AFTER its refused-write probes, so a write that leaked through is caught. */
export const TIER2_FIXTURE_MESSAGE_COUNTS = { a: 2, b: 1 } as const;

// ---------------------------------------------------------------------------
// Board-thread fixtures (Phase 2 board dock)
// ---------------------------------------------------------------------------
//
// The two tenants above share NOTHING, which is exactly what makes them useless
// for the board-thread widening: `public.can_read_board()` demands ACTIVE ORG
// MEMBERSHIP *and* creator-or-board-member, so a reader in a different org can
// never satisfy it. Proving "a board member CAN read a shared thread" therefore
// needs a THIRD principal — a second, non-owning member of the Alpha org.
//
// GAMMA is that principal. It is deliberately NOT a member of
// TIER2_FIXTURE_TENANTS: that array's own unit test asserts "exactly two tenants
// that share nothing", and gamma's whole purpose is to SHARE Alpha's org. It
// owns nothing, holds no elevated role, and reaches nothing outside Alpha.
export const TIER2_BOARD_MEMBER_FIXTURE = {
  label: "gamma",
  email: "pulse-tier2-fixture-c@example.com",
  userId: "aaaa0000-0000-4000-8000-0000000000c1",
  fullName: "Tier-2 Fixture C",
} as const;

/**
 * The board-scoped Ask Pulse threads, all inside the Alpha org.
 *
 * Two boards, because "shared to a board" has two distinct negatives:
 *   - `sharedBoardId` (the pre-existing Alpha fixture board) — gamma IS granted
 *     it via `board_members`, so gamma must SEE the thread shared to it.
 *   - `offBoardId` (a second Alpha board) — gamma is an active member of the
 *     same ORG but is neither its creator nor a board member, so gamma must NOT
 *     see the thread shared to it. That is the assertion that separates
 *     can_read_board()'s board check from its org check; without it, "gamma can
 *     read a board thread" would be indistinguishable from "any org member can".
 *
 * The private counterpart is the pre-existing `ALPHA.conversationId`, which
 * keeps `board_id = null` / `visibility = 'private'` — the regression subject.
 *
 * `dockedPrivateConversationId` is the row that makes the `visibility = 'board'`
 * conjunct visible to the suite at all. It sits on `sharedBoardId` — the board
 * gamma DOES hold — and differs from the readable `sharedConversationId` in
 * exactly one column. Without it, `board_id is not null` and `can_read_board()`
 * between them refuse every other row in the corpus, so deleting the visibility
 * check from either policy would change nothing observable. It is also the row
 * class the feature produces most: `visibility` is NOT NULL DEFAULT 'private'
 * and nothing couples it to `board_id`, so a thread docked to a board and not
 * yet shared lands here BY DEFAULT, holding private conversation content.
 */
export const TIER2_BOARD_THREAD_FIXTURE = {
  orgId: "aaaa0000-0000-4000-8000-000000000001",
  /** Alpha Fixture Board — gamma is a board member here. */
  sharedBoardId: "aaaa0000-0000-4000-8000-000000000003",
  sharedConversationId: "aaaa0000-0000-4000-8000-000000000008",
  sharedConversationTitle: "Alpha shared board thread",
  sharedMessageIds: [
    "aaaa0000-0000-4000-8000-000000000009",
    "aaaa0000-0000-4000-8000-00000000000a",
  ],
  /**
   * Docked to `sharedBoardId` but NOT shared: `visibility = 'private'`. The sole
   * discriminator for the second conjunct of both new policies.
   */
  dockedPrivateConversationId: "aaaa0000-0000-4000-8000-00000000000e",
  dockedPrivateConversationTitle: "Alpha docked unshared thread",
  dockedPrivateMessageId: "aaaa0000-0000-4000-8000-00000000000f",
  /** Alpha Off-Limits Board — same org, gamma is NOT a board member. */
  offBoardId: "aaaa0000-0000-4000-8000-00000000000b",
  offBoardName: "Alpha Off-Limits Board",
  offBoardConversationId: "aaaa0000-0000-4000-8000-00000000000c",
  offBoardConversationTitle: "Alpha off-limits board thread",
  offBoardMessageId: "aaaa0000-0000-4000-8000-00000000000d",
} as const;

/** Every permanent fixture address, for the teardown purge exemption. */
export const TIER2_FIXTURE_EMAILS: readonly string[] = [
  ...TIER2_FIXTURE_TENANTS.map((tenant) => tenant.email),
  TIER2_BOARD_MEMBER_FIXTURE.email,
];

const FIXTURE_EMAIL_SET = new Set(
  TIER2_FIXTURE_EMAILS.map((email) => email.toLowerCase()),
);

/**
 * True for a permanent Tier-2 fixture account.
 *
 * These use the same `@example.com` domain as every throwaway integration user,
 * so the age-based purge in `global-teardown.ts` would otherwise delete them 30
 * minutes after they were seeded — taking their orgs (and every fixture row) with
 * them by cascade, and leaving the isolation suite asserting against nothing.
 */
export function isPermanentFixtureEmail(
  email: string | null | undefined,
): boolean {
  return Boolean(email) && FIXTURE_EMAIL_SET.has(email!.toLowerCase());
}

// ---------------------------------------------------------------------------
// Target resolution
// ---------------------------------------------------------------------------

export type FixtureTarget = {
  url: string;
  anonKey: string;
  label: SupabaseTargetLabel;
};

export type FixtureTargetResolution =
  | { ok: true; target: FixtureTarget }
  | { ok: false; reason: string };

// vitest.setup.ts seeds these so app modules import cleanly under jsdom.
// Signing in against them would fail confusingly rather than skip.
const PLACEHOLDER_KEYS = new Set(["test-anon-key"]);

/**
 * Resolve the project to assert against — DEV, or nothing.
 *
 * This is the deliberate INVERSE of the Tier-1 deny-list. DEV is *forbidden* to
 * the integration teardown because that purge is destructive; it is the *only*
 * project Tier 2 may aim at, because Tier 2 writes nothing and DEV is the one
 * project where the permanent fixtures are seeded. There is no override pair:
 * PROD must never grow a pair of known-password accounts, and repointing at a
 * throwaway project would prove nothing about the project that serves users.
 *
 * Returns a reason instead of throwing so the suite SKIPS (not fails) with no
 * credentials — CI without secrets stays green.
 */
export function resolveFixtureTarget(
  env: Record<string, string | undefined>,
): FixtureTargetResolution {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return {
      ok: false,
      reason:
        "No target: set NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    };
  }
  if (PLACEHOLDER_KEYS.has(anonKey)) {
    return { ok: false, reason: "Anon key is the test placeholder." };
  }
  if (!allowsTier2Fixtures(url)) {
    return {
      ok: false,
      reason:
        `Tier 2 runs against the DEV project only; ${url} is not it. The permanent ` +
        "fixtures are seeded on DEV and deliberately nowhere else.",
    };
  }
  return { ok: true, target: { url, anonKey, label: "dev" } };
}

/**
 * Load `.env.local` so a plain `pnpm test` finds DEV.
 *
 * Narrower than the integration loader on purpose: it never layers `.env.test`
 * on top. Same reasoning as the conformance tier.
 */
export function loadFixtureEnv(repoRoot = process.cwd()): void {
  const envLocal = resolve(repoRoot, ".env.local");
  if (existsSync(envLocal))
    config({ path: envLocal, override: true, quiet: true });
}
